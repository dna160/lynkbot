/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/constants/couriers.ts
 * Role    : Indonesian courier codes, names, and resi number regex patterns
 * Imports : nothing (zero deps)
 * Exports : COURIERS, CourierCode, getResiPattern
 * DO NOT  : Import from @lynkbot/* or apps/*
 */
export const COURIERS = {
  JNE: {
    code: 'jne',
    name: 'JNE',
    resiPattern: /^[A-Z]{2}\d{10,18}[A-Z]{2}$/i,
  },
  JNT: {
    code: 'jnt',
    name: 'J&T Express',
    resiPattern: /^\d{12,18}$/,
  },
  SICEPAT: {
    code: 'sicepat',
    name: 'SiCepat',
    resiPattern: /^\d{12,15}$/,
  },
  ANTERAJA: {
    code: 'anteraja',
    name: 'AnterAja',
    resiPattern: /^\d{12,16}$/,
  },
  POS: {
    code: 'pos',
    name: 'POS Indonesia',
    resiPattern: /^[A-Z]{2}\d{8}[A-Z]{2}$/i,
  },
  TIKI: {
    code: 'tiki',
    name: 'TIKI',
    resiPattern: /^\d{10,14}$/,
  },
} as const;

export type CourierCode = typeof COURIERS[keyof typeof COURIERS]['code'];

export function getResiPattern(courierCode: string): RegExp | null {
  const courier = Object.values(COURIERS).find(c => c.code === courierCode);
  return courier?.resiPattern ?? null;
}
