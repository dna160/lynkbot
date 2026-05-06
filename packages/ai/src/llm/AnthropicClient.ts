/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/llm/AnthropicClient.ts
 * Role    : ILLMClient implementation for Anthropic API (Claude 3 Haiku, Sonnet, Opus)
 * Exports : AnthropicClient
 */
import type { ILLMClient, ChatMessage, LLMResponse, ChatOptions } from './ILLMClient';

// Lazy-load anthropic SDK
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
function makeAnthropic(opts: any): any { return new (require('@anthropic-ai/sdk').default)(opts); }

export class AnthropicClient implements ILLMClient {
  private client: any;
  private defaultModel: string;
  private lastFailureAt: number | null = null;
  private readonly failureCooldownMs = 60_000;

  constructor(apiKey?: string, defaultModel?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
    this.client = makeAnthropic({ apiKey: key });
    this.defaultModel = defaultModel ?? 'claude-3-haiku-20240307';
  }

  supportsModel(model: string): boolean {
    const anthropicModels = ['claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus', 'claude-3-5-sonnet'];
    return anthropicModels.some(m => model.toLowerCase().startsWith(m));
  }

  isHealthy(): boolean {
    if (!this.lastFailureAt) return true;
    return Date.now() - this.lastFailureAt > this.failureCooldownMs;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<LLMResponse> {
    const start = Date.now();
    const model = opts.model ?? this.defaultModel;

    try {
      // Anthropic uses system param separately, not as a message
      const systemContent = opts.system ?? '';
      const conversationMessages = messages.filter(m => m.role !== 'system');

      const res = await this.client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        system: systemContent || undefined,
        messages: conversationMessages.map(m => ({ role: m.role, content: m.content })),
      });

      const content = res.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('') ?? '';

      const tokensUsed = (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);

      return {
        content,
        tokensUsed,
        modelId: model,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      this.lastFailureAt = Date.now();
      throw err;
    }
  }

  async stream(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<void> {
    const stream = await this.client.messages.create({
      model: this.defaultModel,
      max_tokens: 1024,
      messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
      stream: true,
    });
    for await (const chunk of stream) {
      const text = chunk.delta?.text;
      if (text) onChunk(text);
    }
  }
}
