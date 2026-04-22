/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/__tests__/pipeline.test.ts
 * Role    : Unit tests for RAG ingest and query pipeline. Mocks all external deps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'Chapter One\nThis is sample book content for testing.\nIt has multiple sentences.' }),
}));

vi.mock('../embeddings', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
  batchEmbed: vi.fn().mockResolvedValue([Array(1536).fill(0.1)]),
}));

vi.mock('@lynkbot/db', () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    execute: vi.fn().mockResolvedValue({ rows: [{ content_text: 'Sample chunk', chapter_title: 'Chapter One', page_number: 1, similarity: 0.95 }] }),
    query: { products: { findFirst: vi.fn().mockResolvedValue({ id: 'prod-1', name: 'Test Book' }) } },
  },
  products: { id: 'id', knowledgeStatus: 'knowledgeStatus', bookPersonaPrompt: 'bookPersonaPrompt', updatedAt: 'updatedAt' },
  productChunks: { productId: 'productId', chunkIndex: 'chunkIndex' },
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
  eq: vi.fn(),
}));

vi.mock('../llm/factory', () => ({
  getLLMClient: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({ content: 'AI persona for test book', tokensUsed: 100, modelId: 'grok-test', latencyMs: 50 }),
  }),
}));

import { chunkText, extractPdfText } from '../chunker';
import { query } from '../pipeline';
import { embed } from '../embeddings';

describe('chunker', () => {
  it('chunks text into segments under 512 tokens', () => {
    const pages = [{ pageNumber: 1, text: 'Hello world. '.repeat(100) }];
    const chunks = chunkText(pages, { maxTokens: 50, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach(c => expect(c.tokenCount).toBeLessThanOrEqual(60));
  });

  it('detects chapter titles', () => {
    const pages = [{ pageNumber: 1, text: 'CHAPTER ONE\nSome content here' }];
    const chunks = chunkText(pages);
    expect(chunks[0].chapterTitle).toBe('CHAPTER ONE');
  });
});

describe('query', () => {
  it('returns joined chunk content', async () => {
    const result = await query('prod-1', 'tenant-1', 'What is this book about?');
    expect(result).toContain('Sample chunk');
    expect(embed).toHaveBeenCalledWith('What is this book about?');
  });
});
