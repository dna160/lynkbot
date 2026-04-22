/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/index.ts
 * Role    : Public API re-exports for @lynkbot/ai package
 * Exports : All public interfaces, clients, and pipeline functions
 */
export type { ILLMClient, ChatMessage, LLMResponse, ChatOptions } from './llm/ILLMClient';
export { GrokClient } from './llm/GrokClient';
export { getLLMClient, resetLLMClient } from './llm/factory';
export { embed, batchEmbed } from './rag/embeddings';
export { extractPdfText, chunkText } from './rag/chunker';
export type { TextChunk, PageText } from './rag/chunker';
export { retrieveTopK } from './rag/retriever';
export type { RetrievedChunk } from './rag/retriever';
export { ingest, query } from './rag/pipeline';
export { buildSystemPrompt } from './prompts/system';
export type { SystemPromptContext } from './prompts/system';
export { SALES_DIRECTIVES, BUY_INTENT_KEYWORDS, OBJECTION_KEYWORDS, DISENGAGEMENT_KEYWORDS, STOP_KEYWORDS, AGENT_KEYWORDS } from './prompts/sales';
export { STATE_PROMPTS } from './prompts/statePrompts';
