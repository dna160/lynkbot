/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/_meta.helper.ts
 * Role    : Per-tenant MetaClient loader. Reads the encrypted access token
 *           and phone number id off the tenant row, decrypts, and hands them
 *           to MetaClient.fromTenant.
 *           NEVER read config.META_ACCESS_TOKEN in flow-related code (PRD §4).
 * Imports : @lynkbot/db, @lynkbot/meta, ../utils/crypto, ../config
 * Exports : getTenantMetaClient
 */
import { db, tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';
import { decrypt } from '../utils/crypto';
import { config } from '../config';

/**
 * Build a MetaClient for the given tenant. Loads the tenant row, decrypts
 * `metaAccessToken` with WABA_POOL_ENCRYPTION_KEY, and returns the client.
 *
 * Throws if the tenant has no active WABA credentials — callers should let
 * this surface rather than swallow.
 */
export async function getTenantMetaClient(tenantId: string): Promise<MetaClient> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant?.metaAccessToken || !tenant?.metaPhoneNumberId) {
    throw new Error(`Tenant ${tenantId} has no active WABA credentials`);
  }
  const accessToken = decrypt(tenant.metaAccessToken, config.WABA_POOL_ENCRYPTION_KEY);
  return MetaClient.fromTenant({
    metaAccessToken: accessToken,
    metaPhoneNumberId: tenant.metaPhoneNumberId,
  });
}
