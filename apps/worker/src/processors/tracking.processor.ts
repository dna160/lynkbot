/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/tracking.processor.ts
 * Role    : Polls Raja Ongkir tracking API for resi status changes.
 *           Sends WA template via Meta Cloud API on status change.
 *           Terminates job on DELIVERED or 30 days elapsed.
 *           Runs on QUEUES.TRACKING as a repeatable job (every 2 hours by default).
 * Imports : @lynkbot/db, @lynkbot/meta, @lynkbot/shared
 * Exports : trackingProcessor (BullMQ Processor)
 * Job data: { shipmentId: string, tenantId: string, conversationId: string }
 * DO NOT  : Import from apps/api or apps/dashboard.
 */
import type { Processor } from 'bullmq';
import axios from 'axios';
import { db, shipments, orders, conversations, buyers } from '@lynkbot/db';
import { eq, sql } from '@lynkbot/db';
import { ShipmentStatus } from '@lynkbot/shared';
import { getTenantMetaClient } from '../_meta.helper';

export interface TrackingJobData {
  shipmentId: string;
  tenantId: string;
  conversationId: string;
}

// ---------------------------------------------------------------------------
// Raja Ongkir API response shapes (abbreviated)
// ---------------------------------------------------------------------------
interface RajaOngkirManifest {
  manifest_code: string;
  manifest_description: string;
  manifest_date: string;
  manifest_time: string;
  city_name: string;
}

interface RajaOngkirResult {
  delivered: boolean;
  summary: {
    status: string;
  };
  manifest: RajaOngkirManifest[];
}

interface RajaOngkirResponse {
  rajaongkir: {
    status: { code: number; description: string };
    result: RajaOngkirResult;
  };
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------
const CARRIER_STATUS_MAP: Record<string, ShipmentStatus> = {
  'manifest': ShipmentStatus.PENDING,
  'in transit': ShipmentStatus.IN_TRANSIT,
  'on process': ShipmentStatus.IN_TRANSIT,
  'on the way': ShipmentStatus.OUT_FOR_DELIVERY,
  'out for delivery': ShipmentStatus.OUT_FOR_DELIVERY,
  'delivered': ShipmentStatus.DELIVERED,
  'delivery failed': ShipmentStatus.EXCEPTION,
  'returned': ShipmentStatus.EXCEPTION,
  'exception': ShipmentStatus.EXCEPTION,
};

function mapCarrierStatus(raw: string): ShipmentStatus {
  const key = raw.toLowerCase().trim();
  if (key in CARRIER_STATUS_MAP) return CARRIER_STATUS_MAP[key]!;
  for (const [pattern, status] of Object.entries(CARRIER_STATUS_MAP)) {
    if (key.includes(pattern)) return status;
  }
  return ShipmentStatus.IN_TRANSIT;
}

// ---------------------------------------------------------------------------
// Meta template config per status — mapped to WABA-approved templates
// ---------------------------------------------------------------------------
interface TemplateConfig {
  name: string;
  buildParams: (args: {
    buyerName: string;
    orderCode: string;
    trackingUrl: string;
  }) => Array<{ type: 'text'; text: string }>;
}

function templateForStatus(status: ShipmentStatus): TemplateConfig | null {
  switch (status) {
    case ShipmentStatus.IN_TRANSIT:
      // "Hi {{1}}, Your order {{2}} has been shipped. Track the progress at {{3}}"
      return {
        name: 'zoko_shopify__shipping_confirmation_002',
        buildParams: ({ buyerName, orderCode, trackingUrl }) => [
          { type: 'text', text: buyerName },
          { type: 'text', text: orderCode },
          { type: 'text', text: trackingUrl },
        ],
      };
    case ShipmentStatus.OUT_FOR_DELIVERY:
    case ShipmentStatus.EXCEPTION:
      // "*Delivery Update* There is a shipping update for your order {{1}}. Track at {{2}}"
      return {
        name: 'zoko_shopify__shipping_update_002',
        buildParams: ({ orderCode, trackingUrl }) => [
          { type: 'text', text: orderCode },
          { type: 'text', text: trackingUrl },
        ],
      };
    case ShipmentStatus.DELIVERED:
      // "Hi {{1}}, Thank you for being a valuable customer. Would you consider giving us a review?"
      return {
        name: 'zoko_order_confirm_and_feedback_image',
        buildParams: ({ buyerName }) => [
          { type: 'text', text: buyerName },
        ],
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------
export const trackingProcessor: Processor = async (job) => {
  const { shipmentId, tenantId, conversationId } = job.data as TrackingJobData;

  job.log(`Polling tracking for shipment=${shipmentId}`);

  // 1. Load shipment
  const shipment = await db.query.shipments.findFirst({
    where: eq(shipments.id, shipmentId),
  });

  if (!shipment) {
    job.log(`Shipment ${shipmentId} not found — terminating job`);
    return { terminate: true };
  }

  // 2. Terminate if already delivered
  if (shipment.currentStatus === ShipmentStatus.DELIVERED) {
    job.log(`Shipment ${shipmentId} already delivered — terminating repeatable job`);
    return { terminate: true };
  }

  // 3. Terminate if shipment is older than 30 days
  const ageMs = Date.now() - new Date(shipment.createdAt).getTime();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  if (ageMs > THIRTY_DAYS_MS) {
    job.log(`Shipment ${shipmentId} is older than 30 days — terminating repeatable job`);
    return { terminate: true };
  }

  // 4. Call Raja Ongkir waybill API
  const rajaOngkirKey = process.env.RAJAONGKIR_API_KEY!;
  const waybillUrl = `${process.env.RAJAONGKIR_BASE_URL ?? 'https://pro.rajaongkir.com/api'}/waybill`;

  let roResult: RajaOngkirResult;
  try {
    const response = await axios.get<RajaOngkirResponse>(waybillUrl, {
      params: {
        waybill: shipment.resiNumber,
        courier: shipment.courierCode,
      },
      headers: { key: rajaOngkirKey },
      timeout: 15_000,
    });
    roResult = response.data.rajaongkir.result;
  } catch (err) {
    job.log(`Raja Ongkir API error for resi=${shipment.resiNumber}: ${String(err)}`);
    return { polled: false, error: String(err) };
  }

  // 5. Map carrier status string
  const carrierStatusRaw = roResult.delivered ? 'delivered' : roResult.summary.status;
  const newStatus = mapCarrierStatus(carrierStatusRaw);

  job.log(`Resi ${shipment.resiNumber}: carrier="${carrierStatusRaw}" → mapped="${newStatus}"`);

  // 6. If status unchanged, nothing to do
  if (newStatus === shipment.currentStatus) {
    job.log(`Status unchanged (${newStatus}) — skipping notification`);
    return { changed: false, status: newStatus };
  }

  // 7. Build tracking history entry from latest manifest
  const latestManifest = roResult.manifest?.[0];
  const historyEntry = {
    status: newStatus,
    description: latestManifest?.manifest_description ?? carrierStatusRaw,
    location: latestManifest?.city_name ?? '',
    timestamp: latestManifest
      ? `${latestManifest.manifest_date} ${latestManifest.manifest_time}`
      : new Date().toISOString(),
  };

  // 8. Update shipment in DB
  await db
    .update(shipments)
    .set({
      currentStatus: newStatus,
      trackingHistory: sql`${shipments.trackingHistory} || ${JSON.stringify([historyEntry])}::jsonb`,
      ...(newStatus === ShipmentStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, shipmentId));

  // 9. Send WA notification via Meta Cloud API
  const templateConfig = templateForStatus(newStatus);
  if (templateConfig) {
    const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
    const buyer = conversation?.buyerId
      ? await db.query.buyers.findFirst({ where: eq(buyers.id, conversation.buyerId) })
      : null;

    if (buyer?.waPhone) {
      const order = await db.query.orders.findFirst({ where: eq(orders.id, shipment.orderId) });
      const meta = await getTenantMetaClient(tenantId);
      const trackingUrl = `https://www.cekresi.com/?noresi=${shipment.resiNumber}`;

      try {
        const params = templateConfig.buildParams({
          buyerName: buyer.displayName ?? 'Kak',
          orderCode: order?.orderCode ?? shipment.resiNumber,
          trackingUrl,
        });
        await meta.sendTemplate({
          to: buyer.waPhone.replace(/^\+/, ''),
          templateName: templateConfig.name,
          languageCode: 'en',
          components: [{ type: 'body', parameters: params }],
        });
        job.log(`Sent ${templateConfig.name} to ${buyer.waPhone}`);
      } catch (err) {
        job.log(`Failed to send ${templateConfig.name}: ${(err as Error).message}`);
      }
    } else {
      job.log(`Could not send template: missing buyer phone`);
    }
  }

  // 10. Terminate repeatable job if delivered
  if (newStatus === ShipmentStatus.DELIVERED) {
    job.log(`Shipment ${shipmentId} delivered — terminating repeatable job`);
    return { terminate: true, status: newStatus };
  }

  return { changed: true, status: newStatus };
};
