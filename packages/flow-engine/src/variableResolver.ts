/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/variableResolver.ts
 * Role    : Resolves {{variable}} placeholders in templates against ExecutionContext.
 *           Unknown variables → empty string (never throw).
 * Exports : resolveVariables
 */
import type { ExecutionContext } from './types';

/**
 * Resolves all {{variable}} placeholders in a template string.
 *
 * Supported variables:
 *   {{buyer.name}}         → ctx.buyer.name
 *   {{buyer.phone}}        → ctx.buyer.waPhone
 *   {{buyer.totalOrders}}  → ctx.buyer.totalOrders
 *   {{buyer.tags}}         → ctx.buyer.tags.join(', ')
 *   {{buyer.language}}     → ctx.buyer.preferredLanguage
 *   {{buyer.notes}}        → ctx.buyer.notes
 *   {{order.code}}         → ctx.variables['orderCode'] (convention)
 *   {{trigger.message}}    → ctx.trigger.messageText (inbound_keyword / WAIT_FOR_REPLY reply)
 *   {{flow.variable.X}}    → ctx.variables['X']
 *   anything else          → '' (empty string, never throw)
 */
export function resolveVariables(template: string, ctx: ExecutionContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const key = path.trim();

    if (key === 'buyer.name') {
      return String(ctx.buyer.displayName ?? ctx.buyer.name ?? '');
    }
    if (key === 'buyer.phone') {
      return String(ctx.buyer.waPhone ?? '');
    }
    if (key === 'buyer.totalOrders') {
      return String(ctx.buyer.totalOrders ?? '');
    }
    if (key === 'buyer.tags') {
      return Array.isArray(ctx.buyer.tags) ? ctx.buyer.tags.join(', ') : '';
    }
    if (key === 'buyer.language' || key === 'buyer.preferredLanguage') {
      return String(ctx.buyer.preferredLanguage ?? '');
    }
    if (key === 'buyer.notes') {
      return String(ctx.buyer.notes ?? '');
    }
    if (key === 'order.code') {
      return String(ctx.variables['orderCode'] ?? '');
    }
    if (key === 'trigger.message') {
      // Works for inbound_keyword trigger and WAIT_FOR_REPLY resume (both set messageText)
      return String((ctx.trigger as Record<string, unknown>)?.messageText ?? '');
    }
    if (key.startsWith('flow.variable.')) {
      const varName = key.slice('flow.variable.'.length);
      return String(ctx.variables[varName] ?? '');
    }

    // Unknown variable — return empty string per spec
    return '';
  });
}
