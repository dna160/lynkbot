/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/retriever.ts
 * Role    : pgvector cosine similarity search for RAG retrieval.
 *           Queries product_chunks using <=> distance operator via raw postgres.js.
 * Exports : retrieveTopK(), RetrievedChunk
 * DO NOT  : Import from apps/*, wati, payments
 */
import { pgClient } from '@lynkbot/db';
import { embed } from './embeddings';

export interface RetrievedChunk {
  contentText: string;
  chapterTitle: string | null;
  pageNumber: number | null;
  similarity: number;
}

export async function retrieveTopK(
  productId: string,
  tenantId: string,
  question: string,
  topK = 5,
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embed(question);
  const embeddingStr = JSON.stringify(queryEmbedding);

  const rows = await pgClient<{
    content_text: string;
    chapter_title: string | null;
    page_number: number | null;
    similarity: number;
  }[]>`
    SELECT
      content_text,
      chapter_title,
      page_number,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM product_chunks
    WHERE product_id = ${productId}
      AND tenant_id = ${tenantId}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${topK}
  `;

  return rows.map((r) => ({
    contentText: r.content_text,
    chapterTitle: r.chapter_title,
    pageNumber: r.page_number,
    similarity: r.similarity,
  }));
}
