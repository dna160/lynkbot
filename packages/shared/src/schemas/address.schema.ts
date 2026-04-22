/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/schemas/address.schema.ts
 * Role    : Zod schema for shipping address data
 * Imports : zod only
 * Exports : ShippingAddressSchema, AddressDraftSchema
 * DO NOT  : Import from @lynkbot/* or apps/*
 */
import { z } from 'zod';

export const ShippingAddressSchema = z.object({
  streetAddress: z.string().min(5),
  kelurahan: z.string().min(2),
  kecamatan: z.string().min(2),
  city: z.string().min(2),
  province: z.string().min(2),
  postalCode: z.string().regex(/^\d{5}$/),
  rajaongkirCityId: z.string(),
  source: z.enum(['location_share', 'text_input']),
});

export const AddressDraftSchema = z.object({
  streetAddress: z.string().optional(),
  kelurahan: z.string().optional(),
  kecamatan: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  rajaongkirCityId: z.string().optional(),
  source: z.enum(['location_share', 'text_input']).optional(),
  step: z.number().min(0).max(5).optional(),
});

export type ShippingAddressInput = z.infer<typeof ShippingAddressSchema>;
export type AddressDraftInput = z.infer<typeof AddressDraftSchema>;
