/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/llm/factory.ts
 * Role    : Returns ILLMClient instance based on LLM_PROVIDER env var. Singleton pattern.
 * Exports : getLLMClient()
 * DO NOT  : Instantiate clients directly in apps/ — always use this factory.
 */
import type { ILLMClient } from './ILLMClient';
import { GrokClient } from './GrokClient';

let instance: ILLMClient | null = null;

export function getLLMClient(): ILLMClient {
  if (!instance) {
    const provider = process.env.LLM_PROVIDER ?? 'xai';
    if (provider === 'xai') {
      instance = new GrokClient();
    } else {
      throw new Error(`Unknown LLM_PROVIDER: ${provider}. Only 'xai' is supported.`);
    }
  }
  return instance;
}

export function resetLLMClient(): void {
  instance = null;
}
