import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      tenants: { findFirst: vi.fn() },
      flowDefinitions: { findMany: vi.fn() },
      flowTemplates: { findMany: vi.fn() },
      buyers: { findMany: vi.fn() },
      products: { findMany: vi.fn() },
    },
    select: vi.fn(),
  },
  tenants: { id: 'id', subscriptionTier: 'subscriptionTier' },
  flowDefinitions: { tenantId: 'tenantId' },
  flowTemplates: { tenantId: 'tenantId' },
  staff: { tenantId: 'tenantId' },
  products: { tenantId: 'tenantId' },
  eq: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { checkQuota } from '../tenantQuota';
import { db } from '@lynkbot/db';

const mockDb = db as unknown as {
  query: {
    tenants: { findFirst: ReturnType<typeof vi.fn> };
  };
  select: ReturnType<typeof vi.fn>;
};

function mockCount(count: number) {
  mockDb.select.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{ count }])),
    })),
  });
}

describe('checkQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks growth tenant at 10 flows from creating 11th', async () => {
    mockDb.query.tenants.findFirst.mockResolvedValue({ subscriptionTier: 'growth' });
    mockCount(10);

    await expect(checkQuota('t-1', 'flows')).rejects.toThrow('quota_exceeded');
  });

  it('allows scale tenant with unlimited flows', async () => {
    mockDb.query.tenants.findFirst.mockResolvedValue({ subscriptionTier: 'scale' });
    mockCount(9999);

    await expect(checkQuota('t-1', 'flows')).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it('blocks trial tenant with 0 staff from creating staff', async () => {
    mockDb.query.tenants.findFirst.mockResolvedValue({ subscriptionTier: 'trial' });
    mockCount(0);

    await expect(checkQuota('t-1', 'staff')).rejects.toThrow('quota_exceeded');
  });

  it('allows creation when under quota', async () => {
    mockDb.query.tenants.findFirst.mockResolvedValue({ subscriptionTier: 'growth' });
    mockCount(5);

    await expect(checkQuota('t-1', 'flows')).resolves.toEqual(expect.objectContaining({ ok: true }));
  });
});
