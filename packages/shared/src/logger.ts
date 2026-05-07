/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/logger.ts
 * Role    : Minimal structured logger for packages that don't have access to Fastify's pino.
 *           Outputs JSON lines to stderr/stdout for log aggregation.
 */

function log(level: string, message: string, meta?: Record<string, unknown>): void {
  const entry = { level, message, time: new Date().toISOString(), ...meta };
  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};
