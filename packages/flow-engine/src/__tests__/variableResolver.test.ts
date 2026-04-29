import { describe, it, expect } from 'vitest';
import { resolveVariables } from '../variableResolver';
import type { ExecutionContext } from '../types';

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    executionId: 'exec-1',
    flowId: 'flow-1',
    tenantId: 'tenant-1',
    buyerId: 'buyer-1',
    buyer: {
      id: 'buyer-1',
      waPhone: '6281234567890',
      name: 'Budi Santoso',
      displayName: 'Budi',
      totalOrders: 5,
      tags: ['vip', 'reseller'],
      lastOrderAt: new Date('2024-01-01'),
      doNotContact: false,
      preferredLanguage: 'id',
      notes: 'Good customer',
      activeFlowCount: 0,
    },
    trigger: {
      type: 'button_click',
      buttonPayload: 'flow:abc:0',
      messageText: 'hello',
    },
    variables: {
      orderCode: 'ORD-999',
      customVar: 'myValue',
    },
    executionLog: [],
    ...overrides,
  };
}

describe('resolveVariables', () => {
  it('resolves {{buyer.name}} to displayName', () => {
    const ctx = makeCtx();
    expect(resolveVariables('Halo, {{buyer.name}}!', ctx)).toBe('Halo, Budi!');
  });

  it('resolves {{buyer.name}} to name when displayName is null', () => {
    const ctx = makeCtx();
    ctx.buyer.displayName = null;
    expect(resolveVariables('{{buyer.name}}', ctx)).toBe('Budi Santoso');
  });

  it('resolves {{buyer.phone}}', () => {
    const ctx = makeCtx();
    expect(resolveVariables('Phone: {{buyer.phone}}', ctx)).toBe('Phone: 6281234567890');
  });

  it('resolves {{buyer.totalOrders}}', () => {
    const ctx = makeCtx();
    expect(resolveVariables('Orders: {{buyer.totalOrders}}', ctx)).toBe('Orders: 5');
  });

  it('resolves {{buyer.tags}} as comma-separated', () => {
    const ctx = makeCtx();
    expect(resolveVariables('Tags: {{buyer.tags}}', ctx)).toBe('Tags: vip, reseller');
  });

  it('resolves {{buyer.language}}', () => {
    const ctx = makeCtx();
    expect(resolveVariables('Lang: {{buyer.language}}', ctx)).toBe('Lang: id');
  });

  it('resolves {{order.code}}', () => {
    const ctx = makeCtx();
    expect(resolveVariables('Order: {{order.code}}', ctx)).toBe('Order: ORD-999');
  });

  it('resolves {{flow.variable.X}}', () => {
    const ctx = makeCtx();
    expect(resolveVariables('Value: {{flow.variable.customVar}}', ctx)).toBe('Value: myValue');
  });

  it('resolves unknown flow variable to empty string', () => {
    const ctx = makeCtx();
    expect(resolveVariables('{{flow.variable.notExist}}', ctx)).toBe('');
  });

  it('resolves completely unknown variable to empty string — never throws', () => {
    const ctx = makeCtx();
    expect(resolveVariables('{{unknown.path.deep}}', ctx)).toBe('');
  });

  it('resolves missing nested buyer field to empty string', () => {
    const ctx = makeCtx();
    expect(resolveVariables('{{buyer.unknown}}', ctx)).toBe('');
  });

  it('handles multiple variables in one string', () => {
    const ctx = makeCtx();
    const result = resolveVariables(
      'Halo {{buyer.name}}, pesanan {{order.code}} sudah dikonfirmasi!',
      ctx,
    );
    expect(result).toBe('Halo Budi, pesanan ORD-999 sudah dikonfirmasi!');
  });

  it('returns plain string unchanged (no placeholders)', () => {
    const ctx = makeCtx();
    expect(resolveVariables('No variables here', ctx)).toBe('No variables here');
  });

  it('handles empty template', () => {
    const ctx = makeCtx();
    expect(resolveVariables('', ctx)).toBe('');
  });

  it('handles empty tags array', () => {
    const ctx = makeCtx();
    ctx.buyer.tags = [];
    expect(resolveVariables('{{buyer.tags}}', ctx)).toBe('');
  });

  it('resolves order.code to empty when not set in variables', () => {
    const ctx = makeCtx();
    ctx.variables = {};
    expect(resolveVariables('{{order.code}}', ctx)).toBe('');
  });
});
