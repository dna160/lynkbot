/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/llm/factory.ts
 * Role    : Provider-agnostic LLM factory with automatic fallback.
 *           Returns ILLMClient instance based on LLM_PRIMARY_PROVIDER env var.
 *           Singleton pattern per provider.
 * Exports : getLLMClient()
 * DO NOT  : Instantiate clients directly in apps/ — always use this factory.
 */
import type { ILLMClient } from './ILLMClient';
import { logger } from '@lynkbot/shared';
import { GrokClient } from './GrokClient';
import { OpenAIClient } from './OpenAIClient';
import { AnthropicClient } from './AnthropicClient';

interface ProviderEntry {
  name: string;
  client: ILLMClient;
}

let providers: ProviderEntry[] | null = null;
let primaryProvider: string | null = null;

function initProviders(): ProviderEntry[] {
  const list: ProviderEntry[] = [];

  if (process.env.XAI_API_KEY) {
    try {
      list.push({ name: 'xai', client: new GrokClient() });
    } catch (err) {
      logger.warn('Failed to initialize GrokClient', { error: String(err), context: 'LLMFactory' });
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      list.push({ name: 'openai', client: new OpenAIClient() });
    } catch (err) {
      logger.warn('Failed to initialize OpenAIClient', { error: String(err), context: 'LLMFactory' });
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      list.push({ name: 'anthropic', client: new AnthropicClient() });
    } catch (err) {
      logger.warn('Failed to initialize AnthropicClient', { error: String(err), context: 'LLMFactory' });
    }
  }

  if (list.length === 0) {
    throw new Error('No LLM providers configured. Set XAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.');
  }

  return list;
}

export function getLLMClient(preferred?: string): ILLMClient {
  if (!providers) {
    providers = initProviders();
    primaryProvider = process.env.LLM_PRIMARY_PROVIDER ?? 'xai';
  }

  const fallbackEnabled = process.env.LLM_FALLBACK_ENABLED !== 'false';

  // If a specific model is requested, find a provider that supports it
  if (preferred) {
    for (const p of providers) {
      if (p.client.supportsModel(preferred) && p.client.isHealthy()) {
        return p.client;
      }
    }
  }

  // Try primary provider first
  const primary = providers.find(p => p.name === primaryProvider);
  if (primary && primary.client.isHealthy()) {
    return primary.client;
  }

  if (!fallbackEnabled) {
    throw new Error(`Primary LLM provider ${primaryProvider} is unhealthy and fallback is disabled.`);
  }

  // Fallback: return first healthy provider
  for (const p of providers) {
    if (p.client.isHealthy()) {
      logger.warn(`Primary provider ${primaryProvider} unhealthy — falling back to ${p.name}`, { context: 'LLMFactory' });
      return p.client;
    }
  }

  // All providers unhealthy — return primary anyway (let it fail and retry)
  logger.error('All LLM providers unhealthy — returning primary and hoping for the best', { context: 'LLMFactory' });
  return primary?.client ?? providers[0].client;
}

export function resetLLMClient(): void {
  providers = null;
  primaryProvider = null;
}
