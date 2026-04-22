/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/shipping.service.ts
 * Role    : WA location share processing and Raja Ongkir shipping rate calculation.
 *           Reverse geocodes via Google Maps. Maps city → Raja Ongkir city_id.
 *           Caches shipping rates (TTL: 1hr) and geocoding results (TTL: 7 days).
 * Exports : ShippingService class
 */
import axios from 'axios';
import { db, pgClient, conversations } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { config } from '../config';
import type { WaLocation, CourierOption } from '@lynkbot/shared';

export interface LocationProcessingResult {
  status: 'success' | 'city_not_found' | 'geocode_failed';
  address?: ParsedIndonesianAddress;
  rawAddress?: string;
  error?: string;
}

interface ParsedIndonesianAddress {
  streetAddress: string;
  kelurahan: string;
  kecamatan: string;
  city: string;
  province: string;
  postalCode: string;
  rajaongkirCityId?: string;
  formattedAddress?: string;
}

interface RajaOngkirCity {
  city_id: string;
  province_id: string;
  province: string;
  type: string;
  city_name: string;
  postal_code: string;
}

// In-memory caches (production should use Redis)
const geocodeCache = new Map<string, { result: ParsedIndonesianAddress | null; expiresAt: number }>();
const rateCache = new Map<string, { result: CourierOption[]; expiresAt: number }>();

const GEOCODE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RATE_TTL_MS = 60 * 60 * 1000; // 1 hour

function roundCoord(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function geocodeCacheKey(lat: number, lng: number): string {
  return `${roundCoord(lat)},${roundCoord(lng)}`;
}

function rateCacheKey(origin: string, destination: string, weight: number): string {
  return `${origin}:${destination}:${weight}`;
}

export class ShippingService {
  async processLocationShare(
    conversationId: string,
    location: WaLocation,
  ): Promise<LocationProcessingResult> {
    const cacheKey = geocodeCacheKey(location.latitude, location.longitude);
    const cached = geocodeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.result) {
        return { status: 'geocode_failed', error: 'Geocoding previously failed for this location' };
      }
      if (!cached.result.rajaongkirCityId) {
        return { status: 'city_not_found', rawAddress: cached.result.formattedAddress };
      }
      await this.storeAddressDraft(conversationId, cached.result);
      return { status: 'success', address: cached.result };
    }

    // Call Google Maps Geocoding API
    let geocodeData: any;
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: {
            latlng: `${location.latitude},${location.longitude}`,
            language: 'id',
            result_type: 'street_address|sublocality|locality',
            key: config.GOOGLE_MAPS_API_KEY,
          },
          timeout: 10_000,
        },
      );
      geocodeData = response.data;
    } catch (err) {
      geocodeCache.set(cacheKey, { result: null, expiresAt: Date.now() + GEOCODE_TTL_MS });
      return { status: 'geocode_failed', error: 'Google Maps API request failed' };
    }

    if (!geocodeData.results || geocodeData.results.length === 0) {
      geocodeCache.set(cacheKey, { result: null, expiresAt: Date.now() + GEOCODE_TTL_MS });
      return { status: 'geocode_failed', error: 'No results returned from geocoding' };
    }

    const parsedAddress = this.parseIndonesianAddress(geocodeData.results[0]);
    const formattedAddress = geocodeData.results[0]?.formatted_address ?? '';
    parsedAddress.formattedAddress = formattedAddress;

    // Map city to Raja Ongkir city_id
    const roCity = await this.mapCityToRajaOngkir(parsedAddress.city);
    if (roCity) {
      parsedAddress.rajaongkirCityId = roCity.city_id;
    }

    geocodeCache.set(cacheKey, { result: parsedAddress, expiresAt: Date.now() + GEOCODE_TTL_MS });

    if (!parsedAddress.rajaongkirCityId) {
      return { status: 'city_not_found', rawAddress: formattedAddress };
    }

    await this.storeAddressDraft(conversationId, parsedAddress);
    return { status: 'success', address: parsedAddress };
  }

  private async storeAddressDraft(conversationId: string, address: ParsedIndonesianAddress): Promise<void> {
    await db
      .update(conversations)
      .set({
        addressDraft: {
          streetAddress: address.streetAddress,
          kelurahan: address.kelurahan,
          kecamatan: address.kecamatan,
          city: address.city,
          province: address.province,
          postalCode: address.postalCode,
          rajaongkirCityId: address.rajaongkirCityId ?? '',
          source: 'location_share',
          step: 5, // all steps complete when from location share
        },
      })
      .where(eq(conversations.id, conversationId));
  }

  async calculateShippingRates(
    originCityId: string,
    destinationCityId: string,
    weightGrams: number,
    couriers: string[] = ['jne', 'jnt', 'sicepat'],
  ): Promise<CourierOption[]> {
    const cacheKey = rateCacheKey(originCityId, destinationCityId, weightGrams);
    const cached = rateCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const isStale = cached && cached.expiresAt <= Date.now();
    const options: CourierOption[] = [];

    for (const courier of couriers) {
      try {
        const response = await axios.post(
          `${config.RAJAONGKIR_BASE_URL}/cost`,
          {
            origin: originCityId,
            destination: destinationCityId,
            weight: weightGrams,
            courier,
          },
          {
            headers: {
              key: config.RAJAONGKIR_API_KEY,
              'Content-Type': 'application/json',
            },
            timeout: 10_000,
          },
        );

        const rajaongkirData = response.data?.rajaongkir;
        if (!rajaongkirData?.results) continue;

        for (const result of rajaongkirData.results) {
          for (const cost of result.costs) {
            for (const costDetail of cost.cost) {
              let description = cost.description ?? '';
              if (isStale) description = `~${description}`;

              options.push({
                code: result.code?.toLowerCase() ?? courier,
                name: result.name ?? courier.toUpperCase(),
                service: cost.service,
                cost: costDetail.value,
                etaDays: parseInt(costDetail.etd?.replace(/\D.*/, '') ?? '3', 10) || 3,
                description,
              });
            }
          }
        }
      } catch (err) {
        // Individual courier failures are non-fatal — continue with others
        console.warn(`RajaOngkir request failed for courier ${courier}:`, err);
      }
    }

    // Sort by cost ascending, take top 3
    const sorted = options.sort((a, b) => a.cost - b.cost).slice(0, 3);
    rateCache.set(cacheKey, { result: sorted, expiresAt: Date.now() + RATE_TTL_MS });
    return sorted;
  }

  parseIndonesianAddress(geocodeResult: any): ParsedIndonesianAddress {
    const components: Array<{ long_name: string; short_name: string; types: string[] }> =
      geocodeResult?.address_components ?? [];

    const getComponent = (...types: string[]): string => {
      for (const type of types) {
        const comp = components.find(c => c.types.includes(type));
        if (comp) return comp.long_name;
      }
      return '';
    };

    const streetNumber = getComponent('street_number');
    const route = getComponent('route');
    const streetAddress = [route, streetNumber].filter(Boolean).join(' ') || getComponent('premise');

    return {
      streetAddress,
      kelurahan: getComponent('sublocality_level_2', 'sublocality_level_3', 'neighborhood'),
      kecamatan: getComponent('sublocality_level_1', 'sublocality'),
      city: getComponent('locality', 'administrative_area_level_2'),
      province: getComponent('administrative_area_level_1'),
      postalCode: getComponent('postal_code'),
    };
  }

  async mapCityToRajaOngkir(cityName: string): Promise<RajaOngkirCity | null> {
    if (!cityName) return null;
    try {
      const rows = await pgClient<RajaOngkirCity[]>`
        SELECT city_id, province_id, province, type, city_name, postal_code
        FROM rajaongkir_cities
        WHERE city_name ILIKE ${cityName}
        LIMIT 1
      `;
      return rows[0] ?? null;
    } catch {
      // Table may not exist — graceful degradation
      return null;
    }
  }
}
