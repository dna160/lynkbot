/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/embeddings.ts
 * Role    : Text embedding via xAI API (OpenAI-compatible). Uses XAI_API_KEY + XAI_BASE_URL.
 *           Model from XAI_EMBEDDING_MODEL env var. NO OpenAI — same xAI endpoint for all AI.
 *           Batches 100 texts per API call to respect rate limits.
 * Exports : embed(), batchEmbed()
 * DO NOT  : Use api.openai.com. Import from apps/*, wati, payments.
 */
import type OpenAI from 'openai';

// Lazy-init: loading openai at module level causes slow startup via pnpm symlink resolution.
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAIClass = require('openai').default as typeof OpenAI;
    _client = new OpenAIClass({
      apiKey: process.env.XAI_API_KEY!,
      baseURL: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
    });
  }
  return _client;
}

const BATCH_SIZE = 100;

export async function embed(text: string): Promise<number[]> {
  const model = process.env.XAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
  const res = await getClient().embeddings.create({ model, input: text });
  return res.data[0].embedding;
}

export async function batchEmbed(texts: string[]): Promise<number[][]> {
  const model = process.env.XAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await getClient().embeddings.create({ model, input: batch });
    results.push(...res.data.map((d) => d.embedding));
  }
  return results;
}
