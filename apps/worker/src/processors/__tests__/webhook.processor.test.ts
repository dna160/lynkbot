import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@lynkbot/db', () => ({
  db: {
    query: { webhookIngestLog: { findFirst: vi.fn() } },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
  webhookIngestLog: { id: 'id', status: 'status' },
  eq: vi.fn(),
}));

// Note: vi.mock path is resolved relative to the importer (webhook.processor.ts)
vi.mock('../services/webhookMessage.processor', () => ({
  processWebhookPayload: vi.fn(),
}));

describe('webhookProcessor', () => {
  let db: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const dbMod = await import('@lynkbot/db');
    db = dbMod.db;
  });

  it('skips duplicate completed log (idempotency)', async () => {
    db.query.webhookIngestLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'completed', payload: {} });
    const { webhookProcessor } = await import('../webhook.processor');

    await webhookProcessor({ data: { logId: 'log-1' } } as any);

    expect(db.update).not.toHaveBeenCalled();
  });

  it('processes pending log and marks completed', async () => {
    db.query.webhookIngestLog.findFirst.mockResolvedValue({ id: 'log-2', status: 'pending', payload: { entry: [{ id: 'test' }] } });
    const { webhookProcessor } = await import('../webhook.processor');
    const svc = await import('../../services/webhookMessage.processor');
    const spy = vi.spyOn(svc, 'processWebhookPayload').mockResolvedValue(undefined);

    await webhookProcessor({ data: { logId: 'log-2' } } as any);

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ entry: [{ id: 'test' }] });
  });

  it('marks failed and throws on error (for BullMQ retry)', async () => {
    db.query.webhookIngestLog.findFirst.mockResolvedValue({ id: 'log-3', status: 'pending', payload: {} });
    const { webhookProcessor } = await import('../webhook.processor');
    const svc = await import('../../services/webhookMessage.processor');
    const spy = vi.spyOn(svc, 'processWebhookPayload').mockRejectedValue(new Error('Meta API down'));

    await expect(webhookProcessor({ data: { logId: 'log-3' } } as any)).rejects.toThrow('Meta API down');

    expect(db.update).toHaveBeenCalledTimes(2);
  });
});
