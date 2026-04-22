/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/onboarding.service.ts
 * Role    : Lynker WABA registration. Invisible to Lynker — no WATI branding exposed.
 *           WATI_PARTNER_ENABLED=false → manual ops fallback (current mode).
 *           WATI_PARTNER_ENABLED=true → WATI Partner API (requires partner agreement).
 * Exports : OnboardingService class
 */
import { db, tenants, opsTickets } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { WatiPartnerClient } from '@lynkbot/wati';
import { Queue } from 'bullmq';
import { QUEUES } from '@lynkbot/shared';
import { config } from '../config';
import { createCipheriv, randomBytes } from 'crypto';
import type { OnboardingFormData } from '@lynkbot/shared';

type TenantRow = typeof tenants.$inferSelect;

export class OnboardingService {
  private watiStatusQueue: Queue;

  constructor() {
    this.watiStatusQueue = new Queue(QUEUES.WATI_STATUS, {
      connection: { url: config.REDIS_URL },
    });
  }

  /**
   * Called from the tenants route when a Lynker triggers onboarding.
   * Reads WATI_PARTNER_ENABLED to decide which path to take.
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

    if (config.WATI_PARTNER_ENABLED) {
      await this.registerWABA_Partner(tenantId, formData);
    } else {
      await this.registerWABA_ManualFallback(tenantId, formData);
    }
  }

  async registerWABA_Partner(tenantId: string, formData: OnboardingFormData): Promise<void> {
    await db.update(tenants)
      .set({ watiAccountStatus: 'registering', updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    const partnerClient = new WatiPartnerClient(config.WATI_API_KEY, config.WATI_BASE_URL);

    const account = await partnerClient.createAccount({
      phone: formData.displayPhoneNumber,
      name: formData.storeName,
      email: formData.ownerEmail,
      fbBusinessId: formData.metaBusinessId,
      category: formData.businessCategory,
      website: formData.businessWebsite,
    });

    await db.update(tenants)
      .set({
        wabaId: account.wabaId,
        watiAccountStatus: 'pending_verification',
        watiRegistrationMeta: {
          watiAccountId: account.accountId,
          registeredAt: new Date().toISOString(),
          formData,
        },
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    // Poll for status every 30 minutes, up to 48 hours (96 attempts)
    await this.watiStatusQueue.add(
      'poll-wati-status',
      { tenantId, watiAccountId: account.accountId, attempt: 0, maxAttempts: 96 },
      {
        jobId: `wati-status:${tenantId}`,
        delay: 30 * 60 * 1000,
        attempts: 96,
        backoff: { type: 'fixed', delay: 30 * 60 * 1000 },
      },
    );
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
