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
  private lastFailureAt: number | null = null;
  private readonly failureCooldownMs = 60_000;

  constructor(apiKey?: string, baseURL?: string, model?: string, fallbackModel?: string) {
    const key = apiKey ?? process.env.XAI_API_KEY;
    if (!key) throw new Error('XAI_API_KEY is not set');
    this.client = makeOpenAI({
      apiKey: key,
      baseURL: baseURL ?? process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
      timeout: 120_000,
      maxRetries: 0,
    });
    this.model = model ?? process.env.LLM_MODEL ?? 'grok-4-1-fast-reasoning';
    this.fallbackModel = fallbackModel ?? process.env.LLM_FALLBACK_MODEL ?? 'grok-3';
  }

  supportsModel(model: string): boolean {
    const xaiModels = ['grok'];
    return xaiModels.some(m => model.toLowerCase().startsWith(m));
  }

  isHealthy(): boolean {
    if (!this.lastFailureAt) return true;
    return Date.now() - this.lastFailureAt > this.failureCooldownMs;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<LLMResponse> {
    const start = Date.now();
    // opts.model lets callers pin a specific model (e.g. a non-reasoning model for classification)
    const primaryModel = opts.model ?? this.model;
    try {
      return await this._chat(messages, primaryModel, opts, start);
    } catch (primaryErr) {
      this.lastFailureAt = Date.now();
      throw primaryErr;
    }
  }

  private async _chat(messages: ChatMessage[], model: string, opts: ChatOptions, start: number): Promise<LLMResponse> {
    // Prepend system message from opts.system if provided
    const fullMessages: ChatMessage[] = opts.system
      ? [{ role: 'system', content: opts.system }, ...messages]
      : messages;

    // Reasoning models (names containing "reasoning") do not accept a temperature
    // parameter — xAI returns an error if it is sent. Strip it for those models.
    const isReasoningModel = model.toLowerCase().includes('reasoning');
    const temperatureParam = (!isReasoningModel && opts.temperature !== undefined)
      ? { temperature: opts.temperature }
      : (!isReasoningModel ? { temperature: 0.7 } : {});

    const res = await this.client.chat.completions.create({
      model,
      messages: fullMessages,
      max_tokens: opts.maxTokens ?? 1024,
      ...temperatureParam,
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
