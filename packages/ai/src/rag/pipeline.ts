/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/pipeline.ts
 * Role    : Thin wrapper re-export for backward compatibility.
 *           All retrieval now goes through vectorPipeline (pgvector + FTS fallback).
 */
export { storeProductEmbeddings, vectorQuery as query } from './vectorPipeline';
