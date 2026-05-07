import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      tenants: {
        findFirst: vi.fn(),
      },
    },
  },
  tenants: { id: 'id', subscriptionTier: 'subscriptionTier' },
  eq: vi.fn(),
}));

import { requireFeature } from '../featureGate';
import { db } from '@lynkbot/db';

const mockDb = db as unknown as {
  query: { tenants: { findFirst: ReturnType<typeof vi.fn> } };
};

function mockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('requireFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks trial tenant from ai_flow_generator → 403', async () => {
    mockDb.query.tenants.findFirst.mockResolvedValue({ subscriptionTier: 'trial' });
    const req = { user: { tenantId: 't-1' } } as any;
    const reply = mockReply() as any;

    const handler = requireFeature('ai_flow_generator');
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'feature_not_available' }));
  });

  it('allows pro tenant to use scheduling feature', async () => {
    mockDb.query.tenants.findFirst.mockResolvedValue({ subscriptionTier: 'pro' });
    const req = { user: { tenantId: 't-1' } } as any;
    const reply = mockReply() as any;

    const handler = requireFeature('scheduling');
    await handler(req, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('returns 401 when tenantId is missing', async () => {
    const req = { user: {} } as any;
    const reply = mockReply() as any;

    const handler = requireFeature('flow_builder');
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
  });
});
