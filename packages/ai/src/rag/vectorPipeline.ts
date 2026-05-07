/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/vectorPipeline.ts
 * Role    : pgvector semantic search for product RAG.
 *           Stores embeddings, performs cosine-similarity queries.
 *           Falls back to FTS if vector returns < 3 results.
 */
import { db, productEmbeddings, products, eq, sql } from '@lynkbot/db';

// Lazy-load embedding model
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embeddingModel: any = null;

async function getEmbedding(text: string): Promise<number[]> {
  try {
    if (!embeddingModel) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { OpenAI } = require('openai');
      embeddingModel = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 0,
      });
    }
    const res = await embeddingModel.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 768,
    });
    return res.data[0].embedding;
  } catch (err) {
    console.error('[vectorPipeline] Embedding generation failed:', err);
    throw err;
  }
}

/**
 * Store embeddings for a product's chunks.
 * Called after PDF ingestion or product update.
 */
export async function storeProductEmbeddings(
  tenantId: string,
  productId: string,
  chunks: string[],
): Promise<void> {
  // Delete existing embeddings for this product
  await db.delete(productEmbeddings).where(eq(productEmbeddings.productId, productId));

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i]);
    const embeddingStr = `[${embedding.join(',')}]`;
    await db.insert(productEmbeddings).values({
      productId,
      tenantId,
      chunkIndex: i,
      chunkText: chunks[i],
      embedding: sql`${embeddingStr}::vector`,
    });
  }
}

/**
 * Semantic search via pgvector cosine similarity.
 * Falls back to FTS if < 3 results.
 */
export async function vectorQuery(tenantId: string, question: string, limit = 5): Promise<string> {
  try {
    const embedding = await getEmbedding(question);
    // Validate embedding is a numeric array before parameterizing
    if (!Array.isArray(embedding) || !embedding.every(n => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error('Invalid embedding: expected finite numeric array');
    }
    const embeddingLiteral = sql.raw(JSON.stringify(embedding));

    const results = await db.execute(sql`
      SELECT pe.chunk_text, pe.product_id, p.name as product_name,
             1 - (pe.embedding <=> ${embeddingLiteral}::vector) as similarity
      FROM product_embeddings pe
      JOIN products p ON p.id = pe.product_id
      WHERE pe.tenant_id = ${tenantId}
        AND p.knowledge_status = 'ready'
        AND p.is_active = true
      ORDER BY pe.embedding <=> ${embeddingLiteral}::vector
      LIMIT ${limit}
    `);

    const rows = Array.isArray(results) ? results : [];

    if (rows.length < 3) {
      // Fallback to FTS
      const fts = await ftsQuery(tenantId, question);
      if (fts) return fts;
    }

    return rows
      .map((r: any) => `[Source: ${r.product_name}]\n${r.chunk_text}`)
      .join('\n\n---\n\n');
  } catch (err) {
    console.error('[vectorPipeline] Vector query failed, falling back to FTS:', err);
    return ftsQuery(tenantId, question);
  }
}

/** Full-text search fallback using product_chunks */
async function ftsQuery(tenantId: string, question: string): Promise<string> {
  const queryTerms = question
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .map(w => w.toLowerCase());

  if (queryTerms.length === 0) {
    const fallback = await db.execute(sql`
      SELECT pc.content_text, p.name AS product_name
      FROM product_chunks pc
      JOIN products p ON p.id = pc.product_id
      WHERE pc.tenant_id = ${tenantId}
        AND p.knowledge_status = 'ready'
        AND p.is_active = true
      ORDER BY p.updated_at DESC, pc.chunk_index ASC
      LIMIT 5
    `);
    return formatChunks(Array.isArray(fallback) ? fallback : []);
  }

  const safeQuery = queryTerms.join(' | ');

  const rows = await db.execute(sql`
    SELECT pc.content_text, p.name AS product_name,
           ts_rank(to_tsvector('simple', pc.content_text), to_tsquery('simple', ${safeQuery})) AS rank
    FROM product_chunks pc
    JOIN products p ON p.id = pc.product_id
    WHERE pc.tenant_id = ${tenantId}
      AND p.knowledge_status = 'ready'
      AND p.is_active = true
      AND to_tsvector('simple', pc.content_text) @@ to_tsquery('simple', ${safeQuery})
    ORDER BY rank DESC
    LIMIT 5
  `);

  const results = Array.isArray(rows) ? rows : [];

  if (results.length === 0) {
    const fallback = await db.execute(sql`
      SELECT pc.content_text, p.name AS product_name
      FROM product_chunks pc
      JOIN products p ON p.id = pc.product_id
      WHERE pc.tenant_id = ${tenantId}
        AND p.knowledge_status = 'ready'
        AND p.is_active = true
      ORDER BY p.updated_at DESC, pc.chunk_index ASC
      LIMIT 5
    `);
    return formatChunks(Array.isArray(fallback) ? fallback : []);
  }

  return formatChunks(results);
}

function formatChunks(rows: any[]): string {
  return rows
    .map(r => `[Source: ${r.product_name}]\n${r.chunk_text}`)
    .join('\n\n---\n\n');
}
