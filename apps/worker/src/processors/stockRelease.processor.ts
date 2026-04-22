/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/stockRelease.processor.ts
 * Role    : Releases reserved stock after checkout timeout (buyer abandoned flow).
 *           Uses raw SQL to safely decrement reservation.
 * Imports : @lynkbot/db
 * Exports : stockReleaseProcessor
 * Job data: { productId: string, tenantId: string, quantity: number }
 */
import type { Processor } from 'bullmq';
import { pgClient } from '@lynkbot/db';

export const stockReleaseProcessor: Processor = async (job) => {
  const { productId, tenantId, quantity = 1 } = job.data as {
    productId: string;
    tenantId: string;
    quantity: number;
  };

  await pgClient`
    UPDATE inventory
    SET quantity_available = quantity_available + ${quantity},
        quantity_reserved  = GREATEST(0, quantity_reserved - ${quantity}),
        updated_at = NOW()
    WHERE product_id = ${productId}
      AND tenant_id = ${tenantId}
  `;

  job.log(`✅ Released ${quantity} unit(s) for product ${productId}`);
};
