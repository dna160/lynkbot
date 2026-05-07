import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track mock health states
let xaiHealthy = true;
let openaiHealthy = true;
let anthropicHealthy = true;

vi.mock('../GrokClient', () => ({
  GrokClient: vi.fn().mockImplementation(() => ({
    isHealthy: () => xaiHealthy,
    supportsModel: () => true,
    chat: vi.fn(),
  })),
}));

vi.mock('../OpenAIClient', () => ({
  OpenAIClient: vi.fn().mockImplementation(() => ({
    isHealthy: () => openaiHealthy,
    supportsModel: () => true,
    chat: vi.fn(),
  })),
}));

vi.mock('../AnthropicClient', () => ({
  AnthropicClient: vi.fn().mockImplementation(() => ({
    isHealthy: () => anthropicHealthy,
    supportsModel: () => true,
    chat: vi.fn(),
  })),
}));

import { getLLMClient, resetLLMClient } from '../factory';

describe('getLLMClient', () => {
  beforeEach(() => {
    resetLLMClient();
    xaiHealthy = true;
    openaiHealthy = true;
    anthropicHealthy = true;
    process.env.XAI_API_KEY = 'test-xai-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.LLM_FALLBACK_ENABLED = 'true';
  });

  it('returns primary provider when healthy', () => {
    const client = getLLMClient();
    expect(client).toBeDefined();
    expect(client.isHealthy()).toBe(true);
  });

  it('falls back to OpenAI when primary is unhealthy', () => {
    xaiHealthy = false;
    const client = getLLMClient();
    expect(client.isHealthy()).toBe(true);
  });

  it('falls back to Anthropic when primary and secondary fail', () => {
    xaiHealthy = false;
    openaiHealthy = false;
    const client = getLLMClient();
    expect(client.isHealthy()).toBe(true);
  });

  it('throws when all providers unhealthy and fallback disabled', () => {
    xaiHealthy = false;
    openaiHealthy = false;
    anthropicHealthy = false;
    process.env.LLM_FALLBACK_ENABLED = 'false';
    expect(() => getLLMClient()).toThrow('Primary LLM provider xai is unhealthy and fallback is disabled');
  });
});
