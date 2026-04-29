import { describe, it, expect } from 'vitest';
import { evaluateConditionGroup } from '../conditionEvaluator';
import type { ConditionGroup, ExecutionContext } from '../types';

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
      totalOrders: 3,
      tags: ['vip', 'loyal'],
      lastOrderAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      doNotContact: false,
      preferredLanguage: 'id',
      notes: null,
      activeFlowCount: 0,
    },
    trigger: {
      type: 'button_click',
      buttonPayload: 'flow:abc:0',
      messageText: 'ya',
    },
    variables: {
      counter: 5,
      flag: 'active',
    },
    executionLog: [],
    ...overrides,
  };
}

describe('evaluateConditionGroup — operator tests', () => {
  it('equals: matches when values are equal', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.phone', operator: 'equals', value: '6281234567890' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('equals: fails when values differ', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.phone', operator: 'equals', value: '000' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('not_equals: passes when values differ', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.phone', operator: 'not_equals', value: '000' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('not_equals: fails when values are equal', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.phone', operator: 'not_equals', value: '6281234567890' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('contains: passes when field includes value (case-insensitive)', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.name', operator: 'contains', value: 'budi' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('contains: fails when field does not include value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.name', operator: 'contains', value: 'siti' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('not_contains: passes when field does not include value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.name', operator: 'not_contains', value: 'siti' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('not_contains: fails when field includes value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.name', operator: 'not_contains', value: 'Budi' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('greater_than: passes when field > value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.totalOrders', operator: 'greater_than', value: 2 }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('greater_than: fails when field <= value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.totalOrders', operator: 'greater_than', value: 3 }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('less_than: passes when field < value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.totalOrders', operator: 'less_than', value: 10 }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('less_than: fails when field >= value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.totalOrders', operator: 'less_than', value: 3 }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('is_set: passes when field has a value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.name', operator: 'is_set' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('is_set: fails when field is empty', () => {
    const ctx = makeCtx();
    ctx.buyer.displayName = null;
    ctx.buyer.name = '';
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.name', operator: 'is_set' }],
    };
    expect(evaluateConditionGroup(group, ctx)).toBe(false);
  });

  it('is_not_set: passes when field is empty', () => {
    const ctx = makeCtx();
    ctx.buyer.notes = null;
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.notes', operator: 'is_not_set' }],
    };
    // 'buyer.notes' isn't a predefined field so resolves to undefined
    expect(evaluateConditionGroup(group, ctx)).toBe(true);
  });

  it('is_not_set: fails when field has a value', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.phone', operator: 'is_not_set' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('days_since: passes when date is older than specified days', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.lastOrderAt', operator: 'days_since', value: 5 }],
    };
    // lastOrderAt is 10 days ago, >= 5 days → true
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('days_since: fails when date is newer than specified days', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.lastOrderAt', operator: 'days_since', value: 30 }],
    };
    // lastOrderAt is 10 days ago, not >= 30 days → false
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('includes_tag: passes when buyer has the tag', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.tags', operator: 'includes_tag', value: 'vip' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('includes_tag: fails when buyer does not have the tag', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.tags', operator: 'includes_tag', value: 'premium' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('not_includes_tag: passes when buyer does not have the tag', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.tags', operator: 'not_includes_tag', value: 'premium' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('not_includes_tag: fails when buyer has the tag', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'buyer.tags', operator: 'not_includes_tag', value: 'vip' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });
});

describe('evaluateConditionGroup — AND logic', () => {
  it('AND: returns true when all conditions pass', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [
        { field: 'buyer.totalOrders', operator: 'greater_than', value: 0 },
        { field: 'buyer.tags', operator: 'includes_tag', value: 'vip' },
      ],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('AND: returns false when any condition fails', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [
        { field: 'buyer.totalOrders', operator: 'greater_than', value: 0 },
        { field: 'buyer.tags', operator: 'includes_tag', value: 'premium' }, // fails
      ],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('AND: empty conditions → true', () => {
    const group: ConditionGroup = { logic: 'AND', conditions: [] };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });
});

describe('evaluateConditionGroup — OR logic', () => {
  it('OR: returns true when any condition passes', () => {
    const group: ConditionGroup = {
      logic: 'OR',
      conditions: [
        { field: 'buyer.tags', operator: 'includes_tag', value: 'premium' }, // fails
        { field: 'buyer.totalOrders', operator: 'greater_than', value: 0 }, // passes
      ],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('OR: returns false when all conditions fail', () => {
    const group: ConditionGroup = {
      logic: 'OR',
      conditions: [
        { field: 'buyer.tags', operator: 'includes_tag', value: 'premium' },
        { field: 'buyer.totalOrders', operator: 'greater_than', value: 100 },
      ],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(false);
  });

  it('OR: empty conditions → true', () => {
    const group: ConditionGroup = { logic: 'OR', conditions: [] };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });
});

describe('evaluateConditionGroup — flow variables', () => {
  it('resolves flow.variable.X fields', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'flow.variable.counter', operator: 'greater_than', value: 3 }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('resolves trigger.type', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'trigger.type', operator: 'equals', value: 'button_click' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });

  it('resolves trigger.buttonPayload', () => {
    const group: ConditionGroup = {
      logic: 'AND',
      conditions: [{ field: 'trigger.buttonPayload', operator: 'contains', value: 'flow:' }],
    };
    expect(evaluateConditionGroup(group, makeCtx())).toBe(true);
  });
});
