/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/conditionEvaluator.ts
 * Role    : Evaluates ConditionGroup against ExecutionContext.
 *           AND: all must pass. OR: at least one must pass.
 * Exports : evaluateConditionGroup
 */
import type { Condition, ConditionGroup, ExecutionContext } from './types';

/**
 * Resolves a field path from ExecutionContext.
 * Returns undefined if the path doesn't exist.
 */
function resolveField(field: string, ctx: ExecutionContext): unknown {
  switch (field) {
    case 'buyer.name':
      return ctx.buyer.displayName ?? ctx.buyer.name;
    case 'buyer.phone':
      return ctx.buyer.waPhone;
    case 'buyer.totalOrders':
      return ctx.buyer.totalOrders;
    case 'buyer.tags':
      return ctx.buyer.tags;
    case 'buyer.lastOrderAt':
      return ctx.buyer.lastOrderAt;
    case 'trigger.type':
      return ctx.trigger.type;
    case 'trigger.buttonPayload':
      return ctx.trigger.buttonPayload;
    default:
      if (field.startsWith('flow.variable.')) {
        const varName = field.slice('flow.variable.'.length);
        return ctx.variables[varName];
      }
      return undefined;
  }
}

/**
 * Evaluates a single condition.
 */
function evaluateCondition(condition: Condition, ctx: ExecutionContext): boolean {
  const fieldValue = resolveField(condition.field, ctx);
  const { operator, value } = condition;

  switch (operator) {
    case 'equals':
      return String(fieldValue ?? '') === String(value ?? '');

    case 'not_equals':
      return String(fieldValue ?? '') !== String(value ?? '');

    case 'contains':
      return String(fieldValue ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());

    case 'not_contains':
      return !String(fieldValue ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());

    case 'greater_than': {
      const numField = Number(fieldValue);
      const numValue = Number(value);
      return !isNaN(numField) && !isNaN(numValue) && numField > numValue;
    }

    case 'less_than': {
      const numField = Number(fieldValue);
      const numValue = Number(value);
      return !isNaN(numField) && !isNaN(numValue) && numField < numValue;
    }

    case 'is_set':
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';

    case 'is_not_set':
      return fieldValue === undefined || fieldValue === null || fieldValue === '';

    case 'days_since': {
      // fieldValue should be a date; value is number of days
      if (!fieldValue) return false;
      const date = fieldValue instanceof Date ? fieldValue : new Date(String(fieldValue));
      if (isNaN(date.getTime())) return false;
      const daysDiff = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
      const targetDays = Number(value);
      return !isNaN(targetDays) && daysDiff >= targetDays;
    }

    case 'includes_tag': {
      const tags = Array.isArray(fieldValue) ? fieldValue : [];
      return tags.includes(String(value ?? ''));
    }

    case 'not_includes_tag': {
      const tags = Array.isArray(fieldValue) ? fieldValue : [];
      return !tags.includes(String(value ?? ''));
    }

    default:
      // Unknown operator — fail safe (condition fails)
      return false;
  }
}

/**
 * Evaluates a ConditionGroup (AND/OR) against an ExecutionContext.
 * Returns true if the group's logic is satisfied, false otherwise.
 */
export function evaluateConditionGroup(group: ConditionGroup, ctx: ExecutionContext): boolean {
  if (!group.conditions || group.conditions.length === 0) {
    // Empty condition group — trivially true
    return true;
  }

  const results = group.conditions.map(c => evaluateCondition(c, ctx));

  if (group.logic === 'AND') {
    return results.every(Boolean);
  } else {
    // OR
    return results.some(Boolean);
  }
}
