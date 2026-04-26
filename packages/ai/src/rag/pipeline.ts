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
import { db, pgClient, products, productChunks, eq, sql } from '@lynkbot/db';
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

  return res.content;
}

export async function query(productId: string, tenantId: string, question: string): Promise<string> {
  const embeddingModel = process.env.XAI_EMBEDDING_MODEL ?? '';

  if (embeddingModel) {
    // Vector similarity search (when embeddings are stored)
    try {
      const queryEmbedding = await embed(question);
      const embeddingStr = JSON.stringify(queryEmbedding);
      const chunks = await pgClient<{ content_text: string }[]>`
        SELECT content_text
        FROM product_chunks
        WHERE product_id = ${productId}
          AND tenant_id = ${tenantId}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingStr}::vector
        LIMIT 5
      `;
      if (chunks.length > 0) return chunks.map((r) => r.content_text).join('\n\n---\n\n');
    } catch (err) {
      console.warn('[query] Vector search failed, falling back to FTS:', (err as Error).message);
    }
  }

  // Full-text search fallback (no embeddings required)
  // Sanitise question for tsquery: keep only words and spaces
  const safeQuery = question.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).join(' & ');
  if (!safeQuery) {
    // No usable terms — return first 5 chunks as context
    const chunks = await pgClient<{ content_text: string }[]>`
      SELECT content_text FROM product_chunks
      WHERE product_id = ${productId} AND tenant_id = ${tenantId}
      ORDER BY chunk_index LIMIT 5
    `;
    return chunks.map((r) => r.content_text).join('\n\n---\n\n');
  }

  const chunks = await pgClient<{ content_text: string }[]>`
    SELECT content_text,
           ts_rank(to_tsvector('english', content_text), to_tsquery('english', ${safeQuery})) AS rank
    FROM product_chunks
    WHERE product_id = ${productId}
      AND tenant_id = ${tenantId}
      AND to_tsvector('english', content_text) @@ to_tsquery('english', ${safeQuery})
    ORDER BY rank DESC
    LIMIT 5
  `;

  if (chunks.length === 0) {
    // FTS found nothing — return first 5 chunks as broad context
    const fallback = await pgClient<{ content_text: string }[]>`
      SELECT content_text FROM product_chunks
      WHERE product_id = ${productId} AND tenant_id = ${tenantId}
      ORDER BY chunk_index LIMIT 5
    `;
    return fallback.map((r) => r.content_text).join('\n\n---\n\n');
  }

  return chunks.map((r) => r.content_text).join('\n\n---\n\n');
}
