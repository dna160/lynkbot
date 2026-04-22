/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/types/product.types.ts
 * Role    : Product and inventory TypeScript types
 * Imports : nothing (zero deps)
 * Exports : Product, Inventory, KnowledgeStatus
 * DO NOT  : Import from @lynkbot/* or apps/*
 */

export enum KnowledgeStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  description: string | null;
  tagline: string | null;
  targetReader: string | null;
  problemsSolved: string[] | null;
  keyOutcomes: string[] | null;
  faqPairs: Array<{ q: string; a: string }> | null;
  testimonials: string[] | null;
  priceIdr: number;
  weightGrams: number;
  dimensionsCm: { l: number; w: number; h: number } | null;
  coverImageUrl: string | null;
  pdfS3Key: string | null;
  knowledgeStatus: KnowledgeStatus;
  bookPersonaPrompt: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Inventory {
  id: string;
  productId: string;
  tenantId: string;
  quantityAvailable: number;
  quantityReserved: number;
  quantitySold: number;
  lowStockThreshold: number;
  updatedAt: Date;
}
