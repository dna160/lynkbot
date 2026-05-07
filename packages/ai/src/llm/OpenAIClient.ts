/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/llm/OpenAIClient.ts
 * Role    : ILLMClient implementation for OpenAI API (GPT-4o, GPT-4o-mini, etc.)
 * Exports : OpenAIClient
 */
import type OpenAI from 'openai';
import type { ILLMClient, ChatMessage, LLMResponse, ChatOptions } from './ILLMClient';

// Lazy-load openai to avoid hanging at module initialization via pnpm symlinks
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
function makeOpenAI(opts: any): OpenAI { return new (require('openai').default)(opts); }

export class OpenAIClient implements ILLMClient {
  private client: OpenAI;
  private defaultModel: string;
  private lastFailureAt: number | null = null;
  private readonly failureCooldownMs = 60_000;

  constructor(apiKey?: string, defaultModel?: string) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not set');
    this.client = makeOpenAI({
      apiKey: key,
      timeout: 120_000,
      maxRetries: 0,
    });
    this.defaultModel = defaultModel ?? 'gpt-4o-mini';
  }

  supportsModel(model: string): boolean {
    const openaiModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    return openaiModels.some(m => model.toLowerCase().startsWith(m));
  }

  isHealthy(): boolean {
    if (!this.lastFailureAt) return true;
    return Date.now() - this.lastFailureAt > this.failureCooldownMs;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<LLMResponse> {
    const start = Date.now();
    const model = opts.model ?? this.defaultModel;
    try {
      const fullMessages: ChatMessage[] = opts.system
        ? [{ role: 'system', content: opts.system }, ...messages]
        : messages;

      const res = await this.client.chat.completions.create({
        model,
        messages: fullMessages as any,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        ...(opts.responseFormat === 'json_object' && { response_format: { type: 'json_object' as const } }),
      });

      return {
        content: res.choices[0]?.message?.content ?? '',
        tokensUsed: res.usage?.total_tokens ?? 0,
        modelId: model,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      this.lastFailureAt = Date.now();
      throw err;
    }
  }

  async stream(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<void> {
    const stream = await this.client.chat.completions.create({
      model: this.defaultModel,
      messages: messages as any,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onChunk(delta);
    }
  }
}
