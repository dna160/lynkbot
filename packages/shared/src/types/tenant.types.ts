/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/types/tenant.types.ts
 * Role    : Tenant TypeScript types and enums
 * Imports : nothing (zero deps)
 * Exports : Tenant, WatiAccountStatus, SubscriptionTier
 * DO NOT  : Import from @lynkbot/* or apps/*
 */

export enum WatiAccountStatus {
  PENDING = 'pending',
  REGISTERING = 'registering',
  PENDING_VERIFICATION = 'pending_verification',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  MANUAL_REQUIRED = 'manual_required',
}

export enum SubscriptionTier {
  TRIAL = 'trial',
  GROWTH = 'growth',
  PRO = 'pro',
  SCALE = 'scale',
}

export interface Tenant {
  id: string;
  lynkUserId: string;
  storeName: string;
  wabaId: string | null;
  watiApiKeyEnc: string | null;
  watiAccountStatus: WatiAccountStatus;
  watiRegistrationMeta: Record<string, unknown> | null;
  originCityId: string | null;
  originCityName: string | null;
  paymentAccountId: string | null;
  subscriptionTier: SubscriptionTier;
  subscriptionExpiresAt: Date | null;
  metaBusinessId: string | null;
  displayPhoneNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingFormData {
  storeName: string;
  displayPhoneNumber: string;
  metaBusinessId: string;
  originCityId: string;
  originCityName: string;
  ownerName: string;
  ownerEmail: string;
  businessCategory: string;
  businessWebsite?: string;
}
