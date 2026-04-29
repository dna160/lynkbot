import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @lynkbot/db before importing CooldownChecker
vi.mock('@lynkbot/db', () => {
  const mockDb = {
    query: {
      buyers: {
        findFirst: vi.fn(),
      },
      buyerBroadcastLog: {
        findFirst: vi.fn(),
      },
    },
  };
  return {
    db: mockDb,
    buyers: {},
    buyerBroadcastLog: {},
    eq: vi.fn((_field: unknown, _val: unknown) => `eq`),
    and: vi.fn((...args: unknown[]) => args.join('&')),
    gte: vi.fn((_field: unknown, _val: unknown) => `gte`),
  };
});

import { CooldownChecker } from '../cooldownChecker';
import { db } from '@lynkbot/db';

// Typed mock reference
const mockDb = db as {
  query: {
    buyers: { findFirst: ReturnType<typeof vi.fn> };
    buyerBroadcastLog: { findFirst: ReturnType<typeof vi.fn> };
  };
};

describe('CooldownChecker', () => {
  let checker: CooldownChecker;

  beforeEach(() => {
    checker = new CooldownChecker();
    vi.clearAllMocks();
  });

  it('returns do_not_contact when buyer.doNotContact is true', async () => {
    mockDb.query.buyers.findFirst.mockResolvedValue({ doNotContact: true });

    const result = await checker.check('buyer-1', 'promo_template', 'tenant-1');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('do_not_contact');
    // Should not check broadcast log if doNotContact
    expect(mockDb.query.buyerBroadcastLog.findFirst).not.toHaveBeenCalled();
  });

  it('returns 7d_same_template when same template sent within 7 days', async () => {
    mockDb.query.buyers.findFirst.mockResolvedValue({ doNotContact: false });
    mockDb.query.buyerBroadcastLog.findFirst
      .mockResolvedValueOnce({ id: 'log-1' }); // 7d same template check

    const result = await checker.check('buyer-1', 'promo_template', 'tenant-1');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('7d_same_template');
  });

  it('returns 24h_any_marketing when any marketing sent in last 24h', async () => {
    mockDb.query.buyers.findFirst.mockResolvedValue({ doNotContact: false });
    mockDb.query.buyerBroadcastLog.findFirst
      .mockResolvedValueOnce(null)        // 7d same template: clear
      .mockResolvedValueOnce({ id: 'log-2' }); // 24h any: blocked

    const result = await checker.check('buyer-1', 'promo_template', 'tenant-1');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('24h_any_marketing');
  });

  it('returns blocked: false when all checks pass', async () => {
    mockDb.query.buyers.findFirst.mockResolvedValue({ doNotContact: false });
    mockDb.query.buyerBroadcastLog.findFirst
      .mockResolvedValueOnce(null)  // 7d same template: clear
      .mockResolvedValueOnce(null); // 24h any: clear

    const result = await checker.check('buyer-1', 'promo_template', 'tenant-1');

    expect(result.blocked).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('returns blocked: false when buyer does not exist (no doNotContact)', async () => {
    mockDb.query.buyers.findFirst.mockResolvedValue(null);
    mockDb.query.buyerBroadcastLog.findFirst
      .mockResolvedValue(null);

    const result = await checker.check('buyer-new', 'promo_template', 'tenant-1');

    expect(result.blocked).toBe(false);
  });

  it('7d block takes priority over 24h when same template found first', async () => {
    mockDb.query.buyers.findFirst.mockResolvedValue({ doNotContact: false });
    // 7d check finds a row → should return 7d_same_template immediately
    mockDb.query.buyerBroadcastLog.findFirst
      .mockResolvedValueOnce({ id: 'log-3' }); // 7d same template hit

    const result = await checker.check('buyer-1', 'promo_template', 'tenant-1');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('7d_same_template');
    // 24h check should NOT be called (short-circuits on 7d hit)
    expect(mockDb.query.buyerBroadcastLog.findFirst).toHaveBeenCalledTimes(1);
  });

  it('do_not_contact blocks regardless of template history', async () => {
    mockDb.query.buyers.findFirst.mockResolvedValue({ doNotContact: true });

    const result = await checker.check('buyer-1', 'any_template', 'tenant-1');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('do_not_contact');
  });
});
