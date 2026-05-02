/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/_meta.helper.ts
 * Role    : Per-tenant MetaClient loader for background job processors.
 *           Mirrors apps/api/src/services/_meta.helper.ts — same logic,
 *           standalone copy so the worker has no import dependency on apps/api.
 *           Reads the tenant's encrypted metaAccessToken from DB, decrypts it
 *           with WABA_POOL_ENCRYPTION_KEY, and returns a MetaClient.
 * Exports : getTenantMetaClient
 * DO NOT  : Use process.env.META_ACCESS_TOKEN or process.env.META_PHONE_NUMBER_ID
 *           in processors — always call getTenantMetaClient(tenantId) instead.
 */
import { db, tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';
import { createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function decodeKey(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('_meta.helper: WABA_POOL_ENCRYPTION_KEY must be a hex string');
  }
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`_meta.helper: key must decode to ${KEY_BYTES} bytes (got ${buf.length})`);
  }
  return buf;
}

function decrypt(bundled: string, keyHex: string): string {
  const key = decodeKey(keyHex);
  const buf = Buffer.from(bundled, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error('_meta.helper: bundled ciphertext is too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Build a per-tenant MetaClient. Throws if the tenant has no WABA credentials
 * — callers (processors) should log and skip the job rather than crash.
 */
export async function getTenantMetaClient(tenantId: string): Promise<MetaClient> {
  const encKey = process.env.WABA_POOL_ENCRYPTION_KEY;
  if (!encKey) throw new Error('_meta.helper: WABA_POOL_ENCRYPTION_KEY env var is not set');

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant?.metaAccessToken || !tenant?.metaPhoneNumberId) {
    throw new Error(`Tenant ${tenantId} has no active WABA credentials`);
  }

  const accessToken = decrypt(tenant.metaAccessToken, encKey);
  return MetaClient.fromTenant({
    metaAccessToken: accessToken,
    metaPhoneNumberId: tenant.metaPhoneNumberId,
  });
}
