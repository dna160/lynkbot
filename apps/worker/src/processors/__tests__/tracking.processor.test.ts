/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/__tests__/tracking.processor.test.ts
 * Role    : Unit tests for tracking processor
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      shipments: { findFirst: vi.fn() },
      tenants: { findFirst: vi.fn() },
      buyers: { findFirst: vi.fn() },
      orders: { findFirst: vi.fn() },
    },
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
  shipments: {}, tenants: {}, buyers: {}, orders: {}, conversations: {},
  eq: vi.fn(),
}));
vi.mock('@lynkbot/wati', () => ({
  WatiClient: vi.fn().mockImplementation(() => ({ sendTemplate: vi.fn().mockResolvedValue(undefined) })),
}));

const mockJob = {
  data: { shipmentId: 'ship-1', tenantId: 'tenant-1', conversationId: 'conv-1' },
  log: vi.fn(),
};

describe('trackingProcessor', () => {
  it('returns early if shipment not found', async () => {
    const { db } = await import('@lynkbot/db');
    (db.query.shipments.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { trackingProcessor } = await import('../tracking.processor');
    await trackingProcessor(mockJob as never, {} as never);
    expect(mockJob.log).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});
