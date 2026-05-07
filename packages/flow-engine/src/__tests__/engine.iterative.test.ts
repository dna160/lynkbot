import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @lynkbot/db ──────────────────────────────────────────────────────────

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      tenants: { findFirst: vi.fn(() => Promise.resolve({ wabaId: 'test-waba' })) },
      flowDefinitions: { findFirst: vi.fn(), findMany: vi.fn(() => Promise.resolve([])) },
      flowExecutions: { findFirst: vi.fn(), findMany: vi.fn(() => Promise.resolve([])) },
      buyers: { findFirst: vi.fn(), findMany: vi.fn(() => Promise.resolve([])) },
      tenantRiskScores: { findFirst: vi.fn(() => Promise.resolve(null)) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'exec-new-1' }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    execute: vi.fn(() => Promise.resolve([])),
  },
  flowDefinitions: { id: 'id', tenantId: 'tenantId', status: 'status' },
  flowExecutions: {
    id: 'id',
    flowId: 'flowId',
    tenantId: 'tenantId',
    buyerId: 'buyerId',
    status: 'status',
    currentNodeId: 'currentNodeId',
    activeFlowCount: 'activeFlowCount',
  },
  buyers: { id: 'id', activeFlowCount: 'activeFlowCount', tenantId: 'tenantId', doNotContact: 'doNotContact', tags: 'tags', totalOrders: 'totalOrders', lastOrderAt: 'lastOrderAt', preferredLanguage: 'preferredLanguage' },
  tenants: { id: 'id', wabaId: 'wabaId' },
  tenantRiskScores: { id: 'id', tenantId: 'tenantId', score: 'score' },
  buyerBroadcastLog: { id: 'id' },
  eq: vi.fn(() => 'eq'),
  and: vi.fn(() => 'and'),
  or: vi.fn(() => 'or'),
  not: vi.fn(() => 'not'),
  sql: Object.assign(vi.fn(() => 'sql-expr'), { raw: vi.fn((s: string) => s) }),
  gte: vi.fn(() => 'gte'),
  lte: vi.fn(() => 'lte'),
  inArray: vi.fn(() => 'inArray'),
  desc: vi.fn(() => 'desc'),
  count: vi.fn(() => 'count'),
}));

// ── Mock bullmq ───────────────────────────────────────────────────────────────
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  })),
}));

// ── Mock @lynkbot/shared ──────────────────────────────────────────────────────
vi.mock('@lynkbot/shared', () => ({
  QUEUES: {
    FLOW_EXECUTION: 'lynkbot-flow-execution',
    BROADCAST_BATCH: 'lynkbot-broadcast-batch',
  },
}));

// ── Mock ../nodeProcessors ────────────────────────────────────────────────────
vi.mock('../nodeProcessors', () => ({
  processorRegistry: {} as Partial<Record<import('../types').NodeType, import('../nodeProcessors/types').NodeProcessor>>,
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { FlowEngine } from '../engine';
import type { FlowDefinition, ExecutionContext } from '../types';
import { db } from '@lynkbot/db';
import { Queue } from 'bullmq';
import { processorRegistry } from '../nodeProcessors';

// ── Typed mock DB refs ────────────────────────────────────────────────────────
type MockDB = {
  query: {
    flowDefinitions: { findFirst: ReturnType<typeof vi.fn> };
    flowExecutions: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    buyers: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    tenantRiskScores: { findFirst: ReturnType<typeof vi.fn> };
    tenants: { findFirst: ReturnType<typeof vi.fn> };
  };
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
};
const mockDb = db as unknown as MockDB;

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockGetMetaClient = vi.fn().mockResolvedValue({
  sendTemplate: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-1' }] }),
  sendText: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-2' }] }),
});

const mockRedisClient = {
  get: vi.fn().mockResolvedValue(null),
  incr: vi.fn().mockResolvedValue(1),
  incrby: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  set: vi.fn().mockResolvedValue('OK'),
};

const mockRedisConnection = { host: 'localhost', port: 6379 };

function makeEngine() {
  return new FlowEngine({
    getMetaClient: mockGetMetaClient,
    redisClient: mockRedisClient,
    redisConnection: mockRedisConnection,
  });
}

function makeBuyer() {
  return {
    id: 'buyer-1',
    waPhone: '6281234567890',
    displayName: 'Budi',
    totalOrders: 5,
    tags: ['vip'],
    lastOrderAt: null,
    doNotContact: false,
    preferredLanguage: 'id',
    notes: null,
    activeFlowCount: 0,
  };
}

function makeCtx(): ExecutionContext {
  return {
    executionId: 'exec-1',
    flowId: 'flow-1',
    tenantId: 'tenant-1',
    buyerId: 'buyer-1',
    buyer: makeBuyer(),
    trigger: { type: 'test' },
    variables: {},
    executionLog: [],
  };
}

function makeLinearFlow(nodeCount: number): FlowDefinition {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n-${i}`,
    type: 'SEND_TEXT' as const,
    config: { message: `Step ${i}` },
  }));
  const edges = Array.from({ length: nodeCount - 1 }, (_, i) => ({
    id: `e-${i}`,
    source: `n-${i}`,
    target: `n-${i + 1}`,
    sourcePort: 'default' as const,
  }));
  return { nodes, edges };
}

function makeCycleFlow(): FlowDefinition {
  return {
    nodes: [
      { id: 'n-a', type: 'SEND_TEXT', config: {} },
      { id: 'n-b', type: 'SEND_TEXT', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'n-a', target: 'n-b', sourcePort: 'default' },
      { id: 'e2', source: 'n-b', target: 'n-a', sourcePort: 'default' },
    ],
  };
}

function makeBranchingFlow(): FlowDefinition {
  return {
    nodes: [
      { id: 'n-if', type: 'IF_CONDITION', config: {} },
      { id: 'n-true', type: 'SEND_TEXT', config: {} },
      { id: 'n-false', type: 'SEND_TEXT', config: {} },
      { id: 'n-branch', type: 'SEND_TEXT', config: {} },
      { id: 'n-first', type: 'SEND_TEXT', config: {} },
      { id: 'n-second', type: 'SEND_TEXT', config: {} },
    ],
    edges: [
      { id: 'e-true', source: 'n-if', target: 'n-true', sourcePort: 'true' },
      { id: 'e-false', source: 'n-if', target: 'n-false', sourcePort: 'false' },
      { id: 'e-next', source: 'n-true', target: 'n-branch', sourcePort: 'default' },
      { id: 'e-b1', source: 'n-branch', target: 'n-first', sourcePort: 'default' },
      { id: 'e-b2', source: 'n-branch', target: 'n-second', sourcePort: 'default' },
    ],
  };
}

function setupFlowMock(flowDef: FlowDefinition) {
  mockDb.query.flowDefinitions.findFirst.mockResolvedValue({
    id: 'flow-1',
    tenantId: 'tenant-1',
    status: 'active',
    definition: flowDef,
  });
}

function captureSetMock() {
  const setMock = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
  mockDb.update.mockReturnValue({ set: setMock });
  return setMock;
}

function getCurrentNodeIdSequence(setMock: ReturnType<typeof vi.fn>): string[] {
  return setMock.mock.calls
    .filter((call) => call[0]?.currentNodeId)
    .map((call) => call[0].currentNodeId as string);
}

function findUpdateWithStatus(setMock: ReturnType<typeof vi.fn>, status: string) {
  return setMock.mock.calls.find((call) => call[0]?.status === status);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FlowEngine.executeNode — iterative execution', () => {
  let engine: FlowEngine;
  let setMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    engine = makeEngine();
    setMock = captureSetMock();
    vi.clearAllMocks();

    // Default processor behaviours
    Object.assign(processorRegistry, {
      SEND_TEXT: vi.fn().mockResolvedValue({ nextNodeId: 'default' }),
      END_FLOW: vi.fn().mockResolvedValue({ status: 'completed' }),
      IF_CONDITION: vi.fn().mockResolvedValue({ nextNodeId: 'true' }),
    });

    mockDb.insert.mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'exec-new-1' }])),
      })),
    });
  });

  it('completes a 50-node linear flow without stack overflow', async () => {
    const flowDef = makeLinearFlow(50);
    setupFlowMock(flowDef);

    await engine.executeNode('exec-1', 'n-0', makeCtx());

    const sequence = getCurrentNodeIdSequence(setMock);
    expect(sequence).toHaveLength(50);
    expect(sequence[0]).toBe('n-0');
    expect(sequence[49]).toBe('n-49');

    const completedUpdate = findUpdateWithStatus(setMock, 'completed');
    expect(completedUpdate).toBeDefined();
  });

  it('fails with max_depth_exceeded at MAX_FLOW_DEPTH+1 nodes', async () => {
    const originalDepth = process.env.MAX_FLOW_DEPTH;
    process.env.MAX_FLOW_DEPTH = '5';

    try {
      const flowDef = makeLinearFlow(6);
      setupFlowMock(flowDef);

      await engine.executeNode('exec-1', 'n-0', makeCtx());

      const failedUpdate = findUpdateWithStatus(setMock, 'failed');
      expect(failedUpdate).toBeDefined();

      // Only 5 nodes should have had their currentNodeId updated before the guard trips
      const sequence = getCurrentNodeIdSequence(setMock);
      expect(sequence).toHaveLength(5);
    } finally {
      process.env.MAX_FLOW_DEPTH = originalDepth;
    }
  });

  it('detects cycles and fails gracefully', async () => {
    const flowDef = makeCycleFlow();
    setupFlowMock(flowDef);

    await engine.executeNode('exec-1', 'n-a', makeCtx());

    const sequence = getCurrentNodeIdSequence(setMock);
    expect(sequence).toEqual(['n-a', 'n-b']);

    const failedUpdate = findUpdateWithStatus(setMock, 'failed');
    expect(failedUpdate).toBeDefined();
  });

  it('handles branching (IF_CONDITION) correctly with LIFO stack', async () => {
    const flowDef = makeBranchingFlow();
    setupFlowMock(flowDef);

    await engine.executeNode('exec-1', 'n-if', makeCtx());

    const sequence = getCurrentNodeIdSequence(setMock);
    // IF_CONDITION returns 'true' → n-true → n-branch
    // n-branch has two default edges: n-first, n-second
    // Engine pushes edges in reverse (LIFO), so n-first is processed before n-second
    expect(sequence).toEqual([
      'n-if',
      'n-true',
      'n-branch',
      'n-first',
      'n-second',
    ]);

    const completedUpdate = findUpdateWithStatus(setMock, 'completed');
    expect(completedUpdate).toBeDefined();
  });
});

describe('FlowEngine.broadcastToSegment', () => {
  let engine: FlowEngine;

  beforeEach(() => {
    engine = makeEngine();
    vi.clearAllMocks();

    mockDb.query.tenants.findFirst.mockResolvedValue({ wabaId: 'waba-1' });
    mockDb.query.buyers.findMany.mockResolvedValue([
      { id: 'buyer-1' },
      { id: 'buyer-2' },
    ]);
    mockDb.query.flowExecutions.findMany.mockResolvedValue([]);
    mockRedisClient.get.mockResolvedValue(null);
  });

  it('blocks broadcast when risk score > 80', async () => {
    mockDb.query.tenantRiskScores.findFirst.mockResolvedValue({
      id: 'rs-1',
      tenantId: 'tenant-1',
      score: 85,
    });

    await expect(
      engine.broadcastToSegment('tenant-1', 'flow-1', {}),
    ).rejects.toThrow('risk score 85 exceeds threshold');
  });

  it('allows broadcast when risk score ≤ 80', async () => {
    mockDb.query.tenantRiskScores.findFirst.mockResolvedValue({
      id: 'rs-1',
      tenantId: 'tenant-1',
      score: 80,
    });

    await expect(
      engine.broadcastToSegment('tenant-1', 'flow-1', {}),
    ).resolves.toBeUndefined();

    // Verify that the batch queue was created and at least one job added
    const queueCalls = vi.mocked(Queue).mock.calls;
    const broadcastBatchCalls = queueCalls.filter(
      (call) => call[0] === 'lynkbot-broadcast-batch',
    );
    expect(broadcastBatchCalls.length).toBeGreaterThan(0);
  });

  it('allows broadcast when no risk score is found', async () => {
    mockDb.query.tenantRiskScores.findFirst.mockResolvedValue(null);

    await expect(
      engine.broadcastToSegment('tenant-1', 'flow-1', {}),
    ).resolves.toBeUndefined();

    const queueCalls = vi.mocked(Queue).mock.calls;
    const broadcastBatchCalls = queueCalls.filter(
      (call) => call[0] === 'lynkbot-broadcast-batch',
    );
    expect(broadcastBatchCalls.length).toBeGreaterThan(0);
  });

  it('respects 1000/hour rate limit', async () => {
    mockDb.query.tenantRiskScores.findFirst.mockResolvedValue(null);
    mockRedisClient.get.mockResolvedValue('1000');

    await expect(
      engine.broadcastToSegment('tenant-1', 'flow-1', {}),
    ).resolves.toBeUndefined();

    // BROADCAST_BATCH queue should never be instantiated because rate limit halted early
    const queueCalls = vi.mocked(Queue).mock.calls;
    const broadcastBatchCalls = queueCalls.filter(
      (call) => call[0] === 'lynkbot-broadcast-batch',
    );
    expect(broadcastBatchCalls).toHaveLength(0);
  });
});
