/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/tenants.ts
 * Role    : Drizzle ORM schema for tenants table and related enums
 * Imports : drizzle-orm/pg-core only
 * Exports : tenants, watiStatusEnum, subscriptionTierEnum, BotTone
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
} from 'drizzle-orm/pg-core';

// Exported so buildSystemPrompt and API validation share the same type.
export type BotTone = 'friendly' | 'formal' | 'playful';

export const watiStatusEnum = pgEnum('wati_account_status', [
  'pending',
  'registering',
  'pending_verification',
  'active',
  'suspended',
  'manual_required',
]);

export const subscriptionTierEnum = pgEnum('subscription_tier', [
  'trial',
  'growth',
  'pro',
  'scale',
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  lynkUserId: varchar('lynk_user_id', { length: 255 }).notNull().unique(),
  storeName: varchar('store_name', { length: 255 }).notNull(),
  wabaId: varchar('waba_id', { length: 255 }),
  watiApiKeyEnc: text('wati_api_key_enc'),
  watiAccountStatus: watiStatusEnum('wati_account_status').default('pending'),
  watiRegistrationMeta: jsonb('wati_registration_meta'),
  originCityId: varchar('origin_city_id', { length: 50 }),
  originCityName: varchar('origin_city_name', { length: 100 }),
  paymentAccountId: varchar('payment_account_id', { length: 255 }),
  subscriptionTier: subscriptionTierEnum('subscription_tier').default('trial'),
  subscriptionExpiresAt: timestamp('subscription_expires_at'),
  metaBusinessId: varchar('meta_business_id', { length: 255 }),
  /** Meta phone_number_id — routes incoming Meta webhooks to this tenant */
  metaPhoneNumberId: varchar('meta_phone_number_id', { length: 50 }),
  displayPhoneNumber: varchar('display_phone_number', { length: 20 }),
  /** AES-256-GCM encrypted System User access token for this tenant's WABA */
  metaAccessToken: text('meta_access_token'),
  /** Meta messaging tier (1, 2, 3, or unlimited via 4) — drives daily template caps */
  messagingTier: integer('messaging_tier').notNull().default(1),
  /** Meta-reported quality rating: GREEN / YELLOW / RED */
  wabaQualityRating: varchar('waba_quality_rating', { length: 10 }),
  /** Last time tenant_risk_scores was computed for this tenant */
  lastRiskScoreAt: timestamp('last_risk_score_at'),
  /** Privacy notice text shown to buyers */
  privacyNoticeText: text('privacy_notice_text'),
  /** Contact info for privacy inquiries */
  contactInfo: varchar('contact_info', { length: 255 }),
  /** Keyword buyers use to opt out */
  optOutKeyword: varchar('opt_out_keyword', { length: 50 }),
  /** Data retention period in days */
  retentionDays: integer('retention_days').default(365),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),

  // ── Bot Persona (migration 0028) ─────────────────────────────────────────
  /** Display name of the bot shown to buyers. Falls back to storeName when null. */
  botName: varchar('bot_name', { length: 100 }),
  /** Tone/style injected into system prompt. One of: friendly | formal | playful */
  botTone: varchar('bot_tone', { length: 20 }).default('friendly'),
  /** Default language for new conversations: 'id' | 'en' */
  botDefaultLanguage: varchar('bot_default_language', { length: 5 }).default('id'),
  /** Opening line the bot uses when greeting a new buyer. Replaces generic greeting. */
  botGreetingStyle: text('bot_greeting_style'),
  /** Emoji or short character used as visual identity on the dashboard only — not injected into prompts. */
  botAvatarEmoji: varchar('bot_avatar_emoji', { length: 10 }),
  /** Freeform instructions appended to every system prompt for this tenant. */
  botCustomInstructions: text('bot_custom_instructions'),
  /** Default Meta template name for staff appointment confirmation requests. */
  staffConfirmationTemplateName: varchar('staff_confirmation_template_name', { length: 100 }),
});
