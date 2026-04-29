/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/onboarding.service.ts
 * Role    : Lynker WABA registration. Invisible to Lynker — no BSP branding exposed.
 *           Meta Direct API — tenants connect their own WABA via Meta Business Manager.
 *           Manual fallback: ops team provisions and calls PUT /internal/tenants/:id/meta-activated.
 * Exports : OnboardingService class
 */
import { db, tenants, opsTickets } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { config } from '../config';
import { createCipheriv, randomBytes } from 'crypto';
import { encrypt } from '../utils/crypto';
import { MetaClient } from '@lynkbot/meta';
import type { OnboardingFormData } from '@lynkbot/shared';
import { WabaPoolService } from './wabaPool.service';

type TenantRow = typeof tenants.$inferSelect;

export type CompleteOnboardingInput =
  | { mode: 'pool' }
  | { mode: 'manual'; metaPhoneNumberId: string; wabaId: string; metaAccessToken: string };

export type CompleteOnboardingResult =
  | { success: true; displayPhone: string }
  | { success: false; reason: 'pool_exhausted' | 'invalid_credentials' | 'connection_failed'; message: string };

export class OnboardingService {
  private wabaPool = new WabaPoolService();

  /**
   * Two-path WABA connection (PRD §3.3 + user clarification):
   *   pool   — auto-assign from pre-provisioned waba_pool accounts
   *   manual — Lynker provides their own Meta WABA credentials
   */
  async completeOnboarding(
    tenantId: string,
    input: CompleteOnboardingInput,
  ): Promise<CompleteOnboardingResult> {
    if (input.mode === 'pool') {
      const result = await this.wabaPool.assignToTenant(tenantId);
      if (!result.assigned) {
        // Fall through to ops ticket — existing manual flow
        const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
        await db.insert(opsTickets).values({
          type: 'waba_assignment_required',
          tenantId,
          payload: { storeName: tenant?.storeName ?? '' },
          status: 'open',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return {
          success: false,
          reason: 'pool_exhausted',
          message: 'We are scaling up capacity. Our team will reach out within 24 hours to connect your WhatsApp.',
        };
      }
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
      return { success: true, displayPhone: tenant?.displayPhoneNumber ?? result.phoneNumberId };
    }

    // Manual mode: validate, encrypt, persist
    const { metaPhoneNumberId, wabaId, metaAccessToken } = input;
    if (!metaPhoneNumberId || !wabaId || !metaAccessToken) {
      return { success: false, reason: 'invalid_credentials', message: 'Phone Number ID, WABA ID, and Access Token are required.' };
    }

    // Optional connection test
    let displayPhone = metaPhoneNumberId;
    try {
      const client = new MetaClient(metaAccessToken, metaPhoneNumberId);
      const info = await client.getPhoneNumberInfo();
      displayPhone = (info as any)?.display_phone_number ?? metaPhoneNumberId;
    } catch {
      return { success: false, reason: 'connection_failed', message: 'Could not verify Meta credentials. Check your Phone Number ID and Access Token.' };
    }

    const encryptedToken = encrypt(metaAccessToken, config.WABA_POOL_ENCRYPTION_KEY);
    await db.update(tenants).set({
      metaPhoneNumberId,
      wabaId,
      metaAccessToken: encryptedToken,
      displayPhoneNumber: displayPhone,
      watiAccountStatus: 'active',
      updatedAt: new Date(),
    }).where(eq(tenants.id, tenantId));

    return { success: true, displayPhone };
  }

  /**
   * Called from the tenants route when a Lynker triggers onboarding.
   */
  async startOnboarding(tenant: TenantRow): Promise<void> {
    // Map tenant fields to OnboardingFormData shape with available info
    const formData: OnboardingFormData = {
      storeName: tenant.storeName,
      displayPhoneNumber: tenant.displayPhoneNumber ?? '',
      metaBusinessId: tenant.metaBusinessId ?? '',
      originCityId: tenant.originCityId ?? '',
      originCityName: tenant.originCityName ?? '',
      ownerName: tenant.storeName, // Placeholder — full form data comes via submitOnboarding
      ownerEmail: '',
      businessCategory: 'retail',
    };
    await this.submitOnboarding(tenant.id, formData);
  }

  async submitOnboarding(tenantId: string, formData: OnboardingFormData): Promise<void> {
    // Persist form data to tenant record
    await db.update(tenants)
      .set({
        storeName: formData.storeName,
        displayPhoneNumber: formData.displayPhoneNumber,
        metaBusinessId: formData.metaBusinessId,
        originCityId: formData.originCityId,
        originCityName: formData.originCityName,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    // Meta Direct: always use manual ops fallback —
    // ops provisions the WABA in Meta Business Manager and calls PUT /internal/tenants/:id/meta-activated
    await this.registerWABA_ManualFallback(tenantId, formData);
  }

  async registerWABA_ManualFallback(tenantId: string, formData: OnboardingFormData): Promise<void> {
    await db.update(tenants)
      .set({ watiAccountStatus: 'manual_required', updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    await db.insert(opsTickets).values({
      type: 'wati_registration',
      tenantId,
      payload: formData as unknown as Record<string, unknown>,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Called by ops via PUT /internal/tenants/:id/wati-activated
   * Encrypts the API key with AES-256-CBC before storing.
   */
  async activateWati(tenantId: string, wabaId: string, watiApiKey: string): Promise<void> {
    const encryptedKey = this.encryptApiKey(watiApiKey);

    await db.update(tenants)
      .set({
        wabaId,
        watiApiKeyEnc: encryptedKey,
        watiAccountStatus: 'active',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
  }

  private encryptApiKey(plaintext: string): string {
    const key = Buffer.from(config.JWT_SECRET.slice(0, 32), 'utf8');
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }
}
