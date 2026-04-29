/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/types.ts
 * Role    : Shared types for all node processors.
 * Exports : NodeProcessor, NodeResult, ProcessorDeps
 */
import type { Queue } from 'bullmq';
import type { DB } from '@lynkbot/db';
import type { MetaClient } from '@lynkbot/meta';
import type { FlowNode, ExecutionContext } from '../types';

export interface NodeResult {
  /** Which edge port to follow: 'default'|'true'|'false'|keyword index|'outside'|'excluded' */
  nextNodeId?: string;
  /** Set when this node pauses or completes execution */
  status?: 'waiting_reply' | 'completed' | 'delayed';
  /** Set when compliance rule caused a skip (e.g. cooldown blocked) */
  skipReason?: string;
}

export interface ProcessorDeps {
  db: DB;
  getMetaClient: (tenantId: string) => Promise<MetaClient>;
  /** BullMQ FLOW_EXECUTION queue */
  queue: Queue;
  /** ioredis client for rate limit counters */
  redisClient: RedisClientLike;
}

/** Minimal ioredis interface needed by processors */
export interface RedisClientLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
}

export type NodeProcessor = (
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
) => Promise<NodeResult>;

/** Pause execution for ms milliseconds — rate-limiting between consecutive sends */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));
