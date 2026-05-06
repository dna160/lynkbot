/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/pipeline.ts
 * Role    : Public API for the RAG system.
 *           ingest(): PDF buffer → chunks → xAI embeddings → pgvector → book persona
 *           query(): question → xAI embedding → pgvector similarity → context string
 * Exports : ingest(), query()
 * DO NOT  : Import from apps/*, wati, payments
 */
import { db, pgClient, products, productChunks, eq, sql, and } from '@lynkbot/db';
import { extractPdfText, chunkText } from './chunker';
import { batchEmbed, embed } from './embeddings';
import { getLLMClient } from '../llm/factory';
import { buildSystemPrompt } from '../prompts/system';

export async function ingest(productId: string, tenantId: string, pdfBuffer: Buffer): Promise<void> {
  // 1. Extract text from PDF
  const pages = await extractPdfText(pdfBuffer);

  // 2. Chunk into 512-token segments with 50-token overlap
  const chunks = chunkText(pages, { maxTokens: 512, overlap: 50 });
  if (chunks.length === 0) throw new Error('PDF produced no text chunks — may be image-only');

  // 3. Try to embed via xAI. xAI currently has no embedding models on this account —
  //    fall back to storing chunks without embeddings (full-text search will be used for retrieval).
  let embeddings: (number[] | null)[] | null = null;
  const embeddingModel = process.env.XAI_EMBEDDING_MODEL ?? '';
  if (embeddingModel) {
    try {
      embeddings = await batchEmbed(chunks.map((c) => c.text));
    } catch (err) {
      console.warn('[ingest] Embedding API failed — falling back to FTS-only mode:', (err as Error).message);
    }
  } else {
    console.log('[ingest] XAI_EMBEDDING_MODEL not set — using FTS-only mode');
  }

  // 4. Upsert into product_chunks (embedding column nullable — omitted in FTS mode)
  const rows = chunks.map((c, i) => ({
    productId,
    tenantId,
    chunkIndex: c.chunkIndex,
    contentText: c.text,
    ...(embeddings ? { embedding: embeddings[i] } : {}),
    pageNumber: c.pageNumber,
    chapterTitle: c.chapterTitle,
    tokenCount: c.tokenCount,
  }));

  // Insert in batches of 50 to avoid large payloads
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    await db.insert(productChunks).values(batch).onConflictDoUpdate({
      target: [productChunks.productId, productChunks.chunkIndex],
      set: {
        contentText: sql`excluded.content_text`,
        tokenCount: sql`excluded.token_count`,
        ...(embeddings ? { embedding: sql`excluded.embedding` } : {}),
      },
    });
  }

  // 5. Generate book persona prompt using first ~2000 chars of content
  const sampleContent = chunks.slice(0, 10).map((c) => c.text).join('\n\n');
  const personaPrompt = await generateBookPersona(productId, sampleContent);

  // 6. Mark ready
  await db.update(products).set({
    bookPersonaPrompt: personaPrompt,
    knowledgeStatus: 'ready',
    updatedAt: new Date(),
  }).where(eq(products.id, productId));
}

async function generateBookPersona(productId: string, sampleContent: string): Promise<string> {
  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
  if (!product) throw new Error(`Product ${productId} not found`);

  const llm = getLLMClient();
  const res = await llm.chat([
    {
      role: 'system',
      content: 'You are an AI persona generator for book sales bots. Generate a concise sales persona prompt (max 300 words) for a WhatsApp bot selling this book.',
    },
    {
      role: 'user',
      content: `Book: "${product.name}"\n\nSample content:\n${sampleContent.slice(0, 2000)}\n\nGenerate a persona prompt that makes the bot deeply knowledgeable about this book and able to answer questions about it convincingly.`,
    },
  ], { maxTokens: 400 });

  // Strip null bytes and C0/C1 control chars that Postgres UTF8 rejects
  // eslint-disable-next-line no-control-regex
  return res.content.replace(/\x00/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Search ALL trained products for this tenant and return the most relevant chunks.
 *
 * Searching tenant-wide (not scoped to a single productId) means the bot answers
 * questions about ANY product it has been trained on, picking the contextually
 * correct information based on what the user actually asked.
 *
 * Each returned chunk is labelled with its product name so the LLM knows which
 * product the knowledge belongs to.
 */
export async function query(tenantId: string, question: string): Promise<string> {
  const embeddingModel = process.env.XAI_EMBEDDING_MODEL ?? '';

  if (embeddingModel) {
    // Vector similarity search across all tenant products
    try {
      const queryEmbedding = await embed(question);
      const embeddingStr = JSON.stringify(queryEmbedding);
      const rows = await pgClient<{ content_text: string; product_name: string }[]>`
        SELECT pc.content_text, p.name AS product_name
        FROM product_chunks pc
        JOIN products p ON p.id = pc.product_id
        WHERE pc.tenant_id = ${tenantId}
          AND pc.embedding IS NOT NULL
          AND p.knowledge_status = 'ready'
        ORDER BY pc.embedding <=> ${embeddingStr}::vector
        LIMIT 5
      `;
      if (rows.length > 0) return formatChunks(rows);
    } catch (err) {
      console.log('[query] Vector search unavailable, using FTS:', (err as Error).message);
    }
  }

  // Full-text search fallback — tenant-wide, 'simple' config, OR operator.
  //
  // 'simple': no language-specific stop words or stemming — correct for Indonesian,
  //   English, or any mixed content. 'english' would mangle Indonesian roots.
  //
  // OR ( | ): any chunk matching ANY query term is scored and returned ranked
  //   by ts_rank. AND ( & ) requires ALL terms in the same chunk — too strict
  //   for natural-language questions ("apa itu Aria" with AND skips chunks that
  //   have "Aria" but not "apa" or "itu").
  const queryTerms = question
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .map(w => w.toLowerCase());

  if (queryTerms.length === 0) {
    // No usable terms — return first 5 chunks from the most recently trained product
    const rows = await pgClient<{ content_text: string; product_name: string }[]>`
      SELECT pc.content_text, p.name AS product_name
      FROM product_chunks pc
      JOIN products p ON p.id = pc.product_id
      WHERE pc.tenant_id = ${tenantId}
        AND p.knowledge_status = 'ready'
        AND p.is_active = true
      ORDER BY p.updated_at DESC, pc.chunk_index ASC
      LIMIT 5
    `;
    return formatChunks(rows);
  }

  const safeQuery = queryTerms.join(' | ');

  const rows = await pgClient<{ content_text: string; product_name: string }[]>`
    SELECT pc.content_text,
           p.name AS product_name,
           ts_rank(to_tsvector('simple', pc.content_text), to_tsquery('simple', ${safeQuery})) AS rank
    FROM product_chunks pc
    JOIN products p ON p.id = pc.product_id
    WHERE pc.tenant_id = ${tenantId}
      AND p.knowledge_status = 'ready'
      AND p.is_active = true
      AND to_tsvector('simple', pc.content_text) @@ to_tsquery('simple', ${safeQuery})
    ORDER BY rank DESC
    LIMIT 5
  `;

  if (rows.length === 0) {
    // FTS found nothing — return first 5 chunks from most recently trained product
    const fallback = await pgClient<{ content_text: string; product_name: string }[]>`
      SELECT pc.content_text, p.name AS product_name
      FROM product_chunks pc
      JOIN products p ON p.id = pc.product_id
      WHERE pc.tenant_id = ${tenantId}
        AND p.knowledge_status = 'ready'
        AND p.is_active = true
      ORDER BY p.updated_at DESC, pc.chunk_index ASC
      LIMIT 5
    `;
    return formatChunks(fallback);
  }

  return formatChunks(rows);
}

/** Format retrieved chunks with their source product name for LLM context. */
function formatChunks(rows: { content_text: string; product_name: string }[]): string {
  return rows
    .map(r => `[Source: ${r.product_name}]\n${r.content_text}`)
    .join('\n\n---\n\n');
}
