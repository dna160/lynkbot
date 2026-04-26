/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/buyerGenomes.ts
 * Role    : Drizzle ORM schema for buyer_genomes and genome_mutations tables.
 *           One genome per buyer+tenant. 18 integer parameters (1–100).
 *           Mutation log tracks every parameter change with evidence.
 * Exports : buyerGenomes, genomeMutations
 */
import {
  pgTable, pgEnum, uuid, integer, text, jsonb, timestamp, index, unique,
} from 'drizzle-orm/pg-core';
import { buyers } from './buyers';
import { tenants } from './tenants';

export const confidenceLevelEnum = pgEnum('confidence_level', ['HIGH', 'MEDIUM', 'LOW']);

export const buyerGenomes = pgTable('buyer_genomes', {
  id: uuid('id').primaryKey().defaultRandom(),
  buyerId: uuid('buyer_id').notNull().references(() => buyers.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  confidence: confidenceLevelEnum('confidence').notNull().default('LOW'),
  observationCount: integer('observation_count').notNull().default(0),

  // Cluster A: OCEAN
  openness: integer('openness').notNull().default(50),
  conscientiousness: integer('conscientiousness').notNull().default(50),
  extraversion: integer('extraversion').notNull().default(50),
  agreeableness: integer('agreeableness').notNull().default(50),
  neuroticism: integer('neuroticism').notNull().default(50),

  // Cluster B: Behavioral
  communicationStyle: integer('communication_style').notNull().default(50),
  decisionMaking: integer('decision_making').notNull().default(50),
  brandRelationship: integer('brand_relationship').notNull().default(50),
  influenceSusceptibility: integer('influence_susceptibility').notNull().default(50),
  emotionalExpression: integer('emotional_expression').notNull().default(50),
  conflictBehavior: integer('conflict_behavior').notNull().default(50),
  literacyArticulation: integer('literacy_articulation').notNull().default(50),
  socioeconomicFriction: integer('socioeconomic_friction').notNull().default(50),

  // Cluster C: Human Uniqueness
  identityFusion: integer('identity_fusion').notNull().default(50),
  chronesthesiaCapacity: integer('chronesthesia_capacity').notNull().default(50),
  tomSelfAwareness: integer('tom_self_awareness').notNull().default(50),
  tomSocialModeling: integer('tom_social_modeling').notNull().default(50),
  executiveFlexibility: integer('executive_flexibility').notNull().default(50),

  /** Formation invariants — trait keys that should not be mutated further */
  formationInvariants: jsonb('formation_invariants').$type<string[]>().default([]),

  /** Cached dialog options built by Grok — JSON blob of DialogCache */
  dialogCache: jsonb('dialog_cache').$type<Record<string, unknown>>(),
  dialogCacheBuiltAt: timestamp('dialog_cache_built_at'),

  /** Extracted OSINT summary — stored for display on dashboard */
  osintSummary: text('osint_summary'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  buyerUnique: unique('buyer_genomes_buyer_tenant_unique').on(t.buyerId, t.tenantId),
  tenantIdx: index('buyer_genomes_tenant_idx').on(t.tenantId),
}));

export const genomeMutations = pgTable('genome_mutations', {
  id: uuid('id').primaryKey().defaultRandom(),
  buyerId: uuid('buyer_id').notNull().references(() => buyers.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  traitName: text('trait_name').notNull(),
  oldScore: integer('old_score').notNull(),
  newScore: integer('new_score').notNull(),
  delta: integer('delta').notNull(),
  evidenceSummary: text('evidence_summary'),
  confidence: confidenceLevelEnum('confidence').notNull(),
  conversationId: uuid('conversation_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  buyerIdx: index('genome_mutations_buyer_idx').on(t.buyerId),
}));
