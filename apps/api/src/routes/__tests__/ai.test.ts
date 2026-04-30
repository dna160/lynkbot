/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/__tests__/ai.test.ts
 * Role    : Integration tests for POST /v1/ai/generate-flow and POST /v1/ai/modify-flow (PRD §9.2/9.3).
 *           All external dependencies mocked; LLM client returns canned JSON.
 * Tests   : response shape, 400 on missing fields, 404 tenant guard, LLM error → 502,
 *           compliance warnings, markdown fence fallback, requireFeature applied.
 * Pattern : vi.hoisted + vi.mock + vi.clearAllMocks in beforeEach (same as flowTemplates.test.ts)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

// ─── Hoist mock fns so vi.mock factories can reference them ────────────────────
const {
  mockFindMany,
  mockFindFirst,
  mockSelectDistinct,
  mockLLMChat,
  mockBuildFlowGenPrompt,
  mockBuildFlowModPrompt,
  mockComputeRiskScore,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockSelectDistinct: vi.fn(),
  mockLLMChat: vi.fn(),
  mockBuildFlowGenPrompt: vi.fn(),
  mockBuildFlowModPrompt: vi.fn(),
  mockComputeRiskScore: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      flowTemplates: { findMany: mockFindMany },
      flowDefinitions: { findFirst: mockFindFirst },
    },
    selectDistinct: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
        catch: vi.fn().mockResolvedValue([]),
      })),
    })),
  },
  flowTemplates: { tenantId: 'tenantId' },
  flowDefinitions: { id: 'id', tenantId: 'tenantId' },
  buyers: { tenantId: 'tenantId', tags: 'tags' },
  eq: vi.fn((_a: unknown, _b: unknown) => ({ type: 'eq' })),
  and: vi.fn((..._args: unknown[]) => ({ type: 'and' })),
  sql: Object.assign(vi.fn(), { empty: vi.fn() }),
}));

vi.mock('@lynkbot/ai', () => ({
  getLLMClient: vi.fn(() => ({
    chat: mockLLMChat,
  })),
}));

vi.mock('@lynkbot/flow-engine', () => ({
  FLOW_GENERATION_SYSTEM_PROMPT: 'GENERATE_SYS_PROMPT',
  FLOW_MODIFICATION_SYSTEM_PROMPT: 'MODIFY_SYS_PROMPT',
  buildFlowGenPrompt: mockBuildFlowGenPrompt,
  buildFlowModPrompt: mockBuildFlowModPrompt,
  computeRiskScore: mockComputeRiskScore,
}));

vi.mock('../../middleware/featureGate', () => ({
  requireFeature: vi.fn(() => async () => { /* allow all */ }),
}));

// ─── Import route AFTER mocks ─────────────────────────────────────────────────
import { aiRoutes } from '../v1/ai';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-abc-123';

/** Minimal valid FlowDefinition JSON string the LLM "returns". */
const VALID_FLOW_JSON = JSON.stringify({
  nodes: [
    { id: 'n1', type: 'TRIGGER', label: 'Start', config: {} },
    { id: 'n2', type: 'SEND_TEXT', label: 'Greeting', config: { message: 'Hello!' } },
    { id: 'n3', type: 'DELAY', label: 'Wait', config: { delayMs: 3000 } },
    { id: 'n4', type: 'END_FLOW', label: 'End', config: {} },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4' },
  ],
});

async function buildApp() {
  const app = Fastify({ logger: false });

  // Stub authenticate decorator — sets request.user
  app.decorate('authenticate', async (request: any) => {
    request.user = { tenantId: TENANT_ID, id: 'user-1' };
  });

  await app.register(aiRoutes);
  await app.ready();
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /v1/ai/generate-flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    // Default: no templates, no tags
    mockFindMany.mockResolvedValue([]);
    mockBuildFlowGenPrompt.mockReturnValue('user-message-for-generate');
    mockLLMChat.mockResolvedValue({ content: VALID_FLOW_JSON });
    mockComputeRiskScore.mockReturnValue({ score: 15, breakdown: {} });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'prompt is required' });
  });

  it('returns 400 when prompt is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with correct response shape on valid prompt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: 'Send a welcome message to new buyers' },
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('flowDefinition');
    expect(body).toHaveProperty('missingTemplates');
    expect(body).toHaveProperty('warnings');
    expect(body).toHaveProperty('riskScoreEstimate');
    expect(Array.isArray(body.missingTemplates)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(typeof body.riskScoreEstimate).toBe('number');
  });

  it('returns parsed FlowDefinition with correct node count', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: 'Re-engagement flow for inactive buyers' },
    });
    const { flowDefinition } = JSON.parse(res.body);
    expect(flowDefinition.nodes).toHaveLength(4);
    expect(flowDefinition.edges).toHaveLength(3);
  });

  it('emits no warnings when DELAY and END_FLOW nodes are present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: 'Test flow' },
    });
    const { warnings } = JSON.parse(res.body);
    // VALID_FLOW_JSON has DELAY and END_FLOW — no warnings expected
    expect(warnings).toHaveLength(0);
  });

  it('emits compliance warnings when DELAY is absent from a multi-node flow', async () => {
    const noDelayFlow = JSON.stringify({
      nodes: [
        { id: 'n1', type: 'TRIGGER', config: {} },
        { id: 'n2', type: 'SEND_TEXT', config: { message: 'Hi' } },
        { id: 'n3', type: 'SEND_TEXT', config: { message: 'Follow-up' } },
      ],
      edges: [],
    });
    mockLLMChat.mockResolvedValue({ content: noDelayFlow });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: 'Broadcast' },
    });
    const { warnings } = JSON.parse(res.body);
    // Expect DELAY warning + END_FLOW warning
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w: string) => w.toLowerCase().includes('delay'))).toBe(true);
  });

  it('returns 502 when LLM throws', async () => {
    mockLLMChat.mockRejectedValue(new Error('LLM unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: 'Welcome flow' },
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('LLM unavailable') });
  });

  it('falls back to markdown fence extraction when LLM wraps JSON in code fences', async () => {
    const fenced = '```json\n' + VALID_FLOW_JSON + '\n```';
    mockLLMChat.mockResolvedValue({ content: fenced });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: 'Broadcast flow' },
    });
    expect(res.statusCode).toBe(200);
    const { flowDefinition, parseError } = JSON.parse(res.body);
    expect(parseError).toBeUndefined();
    expect(flowDefinition.nodes).toHaveLength(4);
  });

  it('passes tenant context to buildFlowGenPrompt', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/ai/generate-flow',
      payload: { prompt: 'Flash sale', audienceSegment: 'vip-buyers' },
    });
    expect(mockBuildFlowGenPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ audienceSegment: 'vip-buyers' }),
    );
  });
});

// ─── modify-flow ──────────────────────────────────────────────────────────────

describe('POST /v1/ai/modify-flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const EXISTING_FLOW = {
    tenantId: TENANT_ID,
    definition: { nodes: [{ id: 'n1', type: 'TRIGGER', config: {} }], edges: [] },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    mockFindFirst.mockResolvedValue(EXISTING_FLOW);
    mockBuildFlowModPrompt.mockReturnValue('user-message-for-modify');
    mockLLMChat.mockResolvedValue({ content: VALID_FLOW_JSON });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when flowId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/modify-flow',
      payload: { instruction: 'Add a delay' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'flowId is required' });
  });

  it('returns 400 when instruction is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/modify-flow',
      payload: { flowId: 'flow-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'instruction is required' });
  });

  it('returns 404 when flow is not found', async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/modify-flow',
      payload: { flowId: 'nonexistent', instruction: 'Add delay' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when flow belongs to a different tenant (tenant guard)', async () => {
    mockFindFirst.mockResolvedValue({
      tenantId: 'other-tenant-xyz',
      definition: { nodes: [], edges: [] },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/modify-flow',
      payload: { flowId: 'flow-owned-by-other', instruction: 'Add delay' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Flow not found' });
  });

  it('returns 200 with correct response shape on valid request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/modify-flow',
      payload: { flowId: 'flow-123', instruction: 'Add a 3s delay after the greeting' },
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('flowDefinition');
    expect(body).toHaveProperty('missingTemplates');
    expect(body).toHaveProperty('warnings');
    expect(body).toHaveProperty('riskScoreEstimate');
    expect(body.riskScoreEstimate).toBe(10); // conservative default for modifications
  });

  it('returns 502 when LLM throws', async () => {
    mockLLMChat.mockRejectedValue(new Error('Timeout'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ai/modify-flow',
      payload: { flowId: 'flow-123', instruction: 'Add delay' },
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('Timeout') });
  });

  it('calls buildFlowModPrompt with current flow definition', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/ai/modify-flow',
      payload: { flowId: 'flow-123', instruction: 'Add delay after greeting' },
    });
    expect(mockBuildFlowModPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'Add delay after greeting' }),
    );
  });
});
