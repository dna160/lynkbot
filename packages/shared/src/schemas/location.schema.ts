/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/schemas/location.schema.ts
 * Role    : Zod schema for WA location message payloads
 * Imports : zod only
 * Exports : WaLocationMessageSchema, LocationProcessingResult
 * DO NOT  : Import from @lynkbot/* or apps/*
 */
import { z } from 'zod';

export const WaLocationMessageSchema = z.object({
  waId: z.string(),
  messageType: z.literal('location'),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
  timestamp: z.string(),
});

export type WaLocationMessage = z.infer<typeof WaLocationMessageSchema>;

export interface GeocodeResult {
  streetAddress: string;
  kelurahan: string;
  kecamatan: string;
  city: string;
  province: string;
  postalCode: string;
}

export type LocationProcessingStatus = 'success' | 'city_not_found' | 'geocode_failed';

export interface LocationProcessingResult {
  status: LocationProcessingStatus;
  address?: GeocodeResult & { rajaongkirCityId: string };
  rawAddress?: GeocodeResult;
}
