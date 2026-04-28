/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/llm/GrokClient.ts
 * Role    : ILLMClient implementation for grok-4-1-fast-reasoning via xAI API.
 *           Uses OpenAI SDK pointed at XAI_BASE_URL (api.x.ai/v1).
 *           NEVER hardcode model name — always read from LLM_MODEL env var.
 *           Implements automatic fallback to LLM_FALLBACK_MODEL on failure.
 *           On dual failure sends Indonesian error message.
 * Exports : GrokClient
 * DO NOT  : Use api.openai.com. Import from apps/*, wati, payments.
 */
import type OpenAI from 'openai';
import type { ILLMClient, ChatMessage, LLMResponse, ChatOptions } from './ILLMClient';

// Lazy-load openai to avoid hanging at module initialization via pnpm symlinks
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
function makeOpenAI(opts: any): OpenAI { return new (require('openai').default)(opts); }

export class GrokClient implements ILLMClient {
  private client: OpenAI;
  private model: string;
  private fallbackModel: string;

  constructor() {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('XAI_API_KEY is not set');
    this.client = makeOpenAI({
      apiKey,
      baseURL: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
      timeout: 120_000, // 2 min — reasoning models can be slow; fail cleanly rather than hanging forever
      maxRetries: 0,    // BullMQ handles retries; don't double-retry inside the SDK
    });
    this.model = process.env.LLM_MODEL ?? 'grok-4-1-fast-reasoning';
    this.fallbackModel = process.env.LLM_FALLBACK_MODEL ?? 'grok-3';
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<LLMResponse> {
    const start = Date.now();
    try {
      return await this._chat(messages, this.model, opts, start);
    } catch (primaryErr) {
      console.error(`Primary model ${this.model} failed, trying fallback ${this.fallbackModel}:`, primaryErr);
      try {
        return await this._chat(messages, this.fallbackModel, opts, start);
      } catch (fallbackErr) {
        console.error(`Fallback model ${this.fallbackModel} also failed:`, fallbackErr);
        return {
          content: 'Sedang ada gangguan, mohon tunggu sebentar.',
          tokensUsed: 0,
          modelId: 'error',
          latencyMs: Date.now() - start,
        };
      }
    }
  }

  private async _chat(messages: ChatMessage[], model: string, opts: ChatOptions, start: number): Promise<LLMResponse> {
    // Prepend system message from opts.system if provided
    const fullMessages: ChatMessage[] = opts.system
      ? [{ role: 'system', content: opts.system }, ...messages]
      : messages;

    const res = await this.client.chat.completions.create({
      model,
      messages: fullMessages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      // Only send response_format when explicitly requesting JSON — sending
      // { type: 'text' } as a default causes xAI API to reject the request
      ...(opts.responseFormat === 'json_object' && { response_format: { type: 'json_object' as const } }),
    });
    return {
      content: res.choices[0]?.message?.content ?? '',
      tokensUsed: res.usage?.total_tokens ?? 0,
      modelId: model,
      latencyMs: Date.now() - start,
    };
  }

  async stream(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<void> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onChunk(delta);
    }
  }
}
