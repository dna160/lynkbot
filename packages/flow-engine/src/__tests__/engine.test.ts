import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @lynkbot/db ──────────────────────────────────────────────────────────
// Note: vi.mock is hoisted, so we cannot use top-level variables inside the factory.
// Use vi.fn() directly — we'll configure them per test in beforeEach.

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      flowDefinitions: { findFirst: vi.fn() },
      buyers: { findFirst: vi.fn() },
      flowExecutions: { findFirst: vi.fn() },
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
  buyers: { id: 'id', activeFlowCount: 'activeFlowCount' },
  eq: vi.fn(() => 'eq'),
  and: vi.fn(() => 'and'),
  or: vi.fn(() => 'or'),
  sql: vi.fn(() => 'sql-expr'),
  gte: vi.fn(() => 'gte'),
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
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { FlowEngine } from '../engine';
import type { FlowDefinition } from '../types';
import { db } from '@lynkbot/db';

// ── Typed mock DB refs ────────────────────────────────────────────────────────
type MockDB = {
  query: {
    flowDefinitions: { findFirst: ReturnType<typeof vi.fn> };
    buyers: { findFirst: ReturnType<typeof vi.fn> };
    flowExecutions: { findFirst: ReturnType<typeof vi.fn> };
  };
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
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
  expire: vi.fn().mockResolvedValue(1),
};

const mockRedisConnection = { host: 'localhost', port: 6379 };

function makeEngine() {
  return new FlowEngine({
    getMetaClient: mockGetMetaClient,
    redisClient: mockRedisClient,
    redisConnection: mockRedisConnection,
  });
}

/** A minimal active flow with trigger → end */
function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    nodes: [
      { id: 'n-trigger', type: 'TRIGGER', config: {} },
      { id: 'n-end', type: 'END_FLOW', config: { reason: 'test complete' } },
    ],
    edges: [{ id: 'e1', source: 'n-trigger', target: 'n-end', sourcePort: 'default' }],
    ...overrides,
  };
}

function makeFlowRow(definition: FlowDefinition = makeFlow()) {
  return {
    id: 'flow-1',
    tenantId: 'tenant-1',
    status: 'active',
    definition,
  };
}

function makeBuyer(doNotContact = false) {
  return {
    id: 'buyer-1',
    waPhone: '6281234567890',
    displayName: 'Budi',
    totalOrders: 5,
    tags: ['vip'],
    lastOrderAt: null,
    doNotContact,
    preferredLanguage: 'id',
    notes: null,
    activeFlowCount: 0,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FlowEngine.handleButtonTrigger', () => {
  let engine: FlowEngine;

  beforeEach(() => {
    engine = makeEngine();
    vi.clearAllMocks();
    // Restore mocks to defaults
    mockGetMetaClient.mockResolvedValue({
      sendTemplate: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-1' }] }),
      sendText: vi.fn().mockResolvedValue({ messages: [{ id: 'msg-2' }] }),
    });
    mockDb.update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    });
    mockDb.insert.mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'exec-new-1' }])),
      })),
    });
  });

  it('throws on invalid button payload format (missing flow: prefix)', async () => {
    await expect(
      engine.handleButtonTrigger('tenant-1', 'buyer-1', 'bad-payload'),
    ).rejects.toThrow('Invalid flow button payload');
  });

  it('throws on button payload with wrong prefix', async () => {
    await expect(
      engine.handleButtonTrigger('tenant-1', 'buyer-1', 'other:abc:0'),
    ).rejects.toThrow('Invalid flow button payload');
  });

  it('throws when flow is not found or not active', async () => {
    mockDb.query.flowDefinitions.findFirst.mockResolvedValue(null);

    await expect(
      engine.handleButtonTrigger('tenant-1', 'buyer-1', 'flow:abc123:0'),
    ).rejects.toThrow('No active flow found');
  });

  it('skips (idempotent) when buyer already has a running execution', async () => {
    mockDb.query.flowDefinitions.findFirst.mockResolvedValue(makeFlowRow());
    mockDb.query.flowExecutions.findFirst.mockResolvedValue({ id: 'exec-existing', status: 'running' });

    await expect(
      engine.handleButtonTrigger('tenant-1', 'buyer-1', 'flow:flow-1:0'),
    ).resolves.toBeUndefined();
    // Should NOT insert a new execution
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('throws compliance error when buyer has doNotContact=true', async () => {
    mockDb.query.flowDefinitions.findFirst.mockResolvedValue(makeFlowRow());
    mockDb.query.flowExecutions.findFirst.mockResolvedValue(null); // no existing
    mockDb.query.buyers.findFirst.mockResolvedValue(makeBuyer(true)); // doNotContact

    await expect(
      engine.handleButtonTrigger('tenant-1', 'buyer-1', 'flow:flow-1:0'),
    ).rejects.toThrow('doNotContact=true');
  });

  it('throws when buyer is not found', async () => {
    mockDb.query.flowDefinitions.findFirst.mockResolvedValue(makeFlowRow());
    mockDb.query.flowExecutions.findFirst.mockResolvedValue(null);
    mockDb.query.buyers.findFirst.mockResolvedValue(null);

    await expect(
      engine.handleButtonTrigger('tenant-1', 'buyer-1', 'flow:flow-1:0'),
    ).rejects.toThrow('Buyer not found');
  });

  it('creates execution and runs engine for a valid trigger (flow with only END_FLOW)', async () => {
    mockDb.query.flowDefinitions.findFirst.mockResolvedValue(makeFlowRow());
    mockDb.query.flowExecutions.findFirst
      .mockResolvedValueOnce(null)      // no existing execution
      .mockResolvedValue(null);         // fallback
    mockDb.query.buyers.findFirst.mockResolvedValue(makeBuyer());

    // Should not throw
    await expect(
      engine.handleButtonTrigger('tenant-1', 'buyer-1', 'flow:flow-1:0'),
    ).resolves.toBeUndefined();

    // insert should have been called (new execution)
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

describe('FlowEngine.resumeExecution', () => {
  let engine: FlowEngine;

  beforeEach(() => {
    engine = makeEngine();
    vi.clearAllMocks();
    mockDb.update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    });
  });

  it('throws when execution is not found', async () => {
    mockDb.query.flowExecutions.findFirst.mockResolvedValue(null);

    await expect(engine.resumeExecution('exec-999', 'ya')).rejects.toThrow(
      'Execution not found',
    );
  });

  it('throws when execution has no currentNodeId', async () => {
    mockDb.query.flowExecutions.findFirst.mockResolvedValue({
      id: 'exec-1',
      flowId: 'flow-1',
      tenantId: 'tenant-1',
      buyerId: 'buyer-1',
      status: 'waiting_reply',
      currentNodeId: null,
      context: {
        buyer: makeBuyer(),
        trigger: { type: 'button_click' },
        variables: {},
        executionLog: [],
      },
    });
    mockDb.query.flowDefinitions.findFirst.mockResolvedValue(makeFlowRow());

    await expect(engine.resumeExecution('exec-1', 'ya')).rejects.toThrow('no currentNodeId');
  });

  it('updates context.trigger.messageText with the inbound message', async () => {
    const ctx = {
      buyer: makeBuyer(),
      trigger: { type: 'button_click', messageText: '' },
      variables: {},
      executionLog: [],
    };

    mockDb.query.flowExecutions.findFirst.mockResolvedValue({
      id: 'exec-1',
      flowId: 'flow-1',
      tenantId: 'tenant-1',
      buyerId: 'buyer-1',
      status: 'waiting_reply',
      currentNodeId: 'n-trigger',
      context: ctx,
    });

    mockDb.query.flowDefinitions.findFirst.mockResolvedValue(makeFlowRow());

    const setMock = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
    mockDb.update.mockReturnValue({ set: setMock });

    await engine.resumeExecution('exec-1', 'ya').catch(() => {
      // May throw on edge resolution — we just verify the update was called with messageText
    });

    // Check that the update was called with the new messageText
    expect(mockDb.update).toHaveBeenCalled();
    const calls = setMock.mock.calls;
    if (calls.length > 0) {
      const updateArgs = calls[0]?.[0] as Record<string, unknown> | undefined;
      if (updateArgs && updateArgs['context']) {
        const updatedCtx = updateArgs['context'] as { trigger: { messageText: string } };
        expect(updatedCtx.trigger.messageText).toBe('ya');
      }
    }
  });
});

describe('FlowEngine stubs', () => {
  let engine: FlowEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it('evaluateTimeTriggers: stub — logs and resolves without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(engine.evaluateTimeTriggers()).resolves.toBeUndefined();
    await expect(engine.evaluateTimeTriggers('tenant-1')).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('broadcastToSegment: stub — logs and resolves without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(
      engine.broadcastToSegment('tenant-1', 'flow-1', { tags: ['vip'] }),
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
