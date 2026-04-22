/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/__tests__/paymentExpiry.processor.test.ts
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      orders: { findFirst: vi.fn() },
      tenants: { findFirst: vi.fn() },
      buyers: { findFirst: vi.fn() },
      products: { findFirst: vi.fn() },
    },
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  },
  orders: {}, conversations: {}, inventory: {}, buyers: {}, products: {}, tenants: {}, auditLogs: {},
  eq: vi.fn(), and: vi.fn(),
  pgClient: vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve()),
}));
vi.mock('@lynkbot/wati', () => ({
  WatiClient: vi.fn().mockImplementation(() => ({ sendTemplate: vi.fn().mockResolvedValue(undefined) })),
}));

const mockJob = {
  data: { orderId: 'order-1', tenantId: 'tenant-1', conversationId: 'conv-1' },
  log: vi.fn(),
};

describe('paymentExpiryProcessor', () => {
  it('skips already-paid orders', async () => {
    const { db } = await import('@lynkbot/db');
    (db.query.orders.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'order-1', status: 'payment_confirmed', productId: 'prod-1', buyerId: 'buyer-1',
    });
    const { paymentExpiryProcessor } = await import('../paymentExpiry.processor');
    await paymentExpiryProcessor(mockJob as never, {} as never);
    expect(mockJob.log).toHaveBeenCalledWith(expect.stringContaining('already handled'));
    expect(db.update).not.toHaveBeenCalled();
  });
});
