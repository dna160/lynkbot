/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/llm/ILLMClient.ts
 * Role    : Interface contract for all LLM clients. Always use factory, never instantiate directly in apps/.
 * Exports : ILLMClient, ChatMessage, LLMResponse, ChatOptions
 * DO NOT  : Import from apps/*, packages/wati, packages/payments
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  modelId: string;
  latencyMs: number;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json_object';
  system?: string;
}

export interface ILLMClient {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<LLMResponse>;
  stream(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<void>;
}
