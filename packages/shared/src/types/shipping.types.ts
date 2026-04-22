/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/types/shipping.types.ts
 * Role    : Shipping and courier TypeScript types
 * Imports : nothing (zero deps)
 * Exports : CourierOption, RajaOngkirCity, ShippingRate
 * DO NOT  : Import from @lynkbot/* or apps/*
 */

export interface CourierOption {
  code: string;
  name: string;
  service: string;
  cost: number;
  etaDays: number;
  description: string;
}

export interface RajaOngkirCity {
  cityId: string;
  provinceId: string;
  province: string;
  type: string;
  cityName: string;
  postalCode: string;
}

export interface ShippingRateRequest {
  origin: string;
  destination: string;
  weight: number;
  courier: string;
}
