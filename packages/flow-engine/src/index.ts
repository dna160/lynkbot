/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/index.ts
 * Role    : Public API surface of @lynkbot/flow-engine.
 * Exports : FlowEngine, all types, computeRiskScore, CooldownChecker,
 *           evaluateConditionGroup, resolveVariables
 */
export { FlowEngine } from './engine';
export type { FlowEngineOptions } from './engine';
export * from './types';
export { computeRiskScore } from './riskScoreCalculator';
export type { RiskScoreInputs } from './riskScoreCalculator';
export { CooldownChecker } from './cooldownChecker';
export type { CooldownResult, CooldownBlockReason } from './cooldownChecker';
export { evaluateConditionGroup } from './conditionEvaluator';
export { resolveVariables } from './variableResolver';
export {
  FLOW_GENERATION_SYSTEM_PROMPT,
  FLOW_MODIFICATION_SYSTEM_PROMPT,
  buildFlowGenPrompt,
  buildFlowModPrompt,
} from './prompts/flowGeneration';
