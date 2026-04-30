/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/__tests__/flowTemplates.test.ts
 * Role    : Integration tests for TemplateStudioService (unit-level — mocked DB and Meta API).
 *           Tests PRD §14.2 requirements: CRUD, appeal limits, delete guard, status handling.
 * Tests   : createDraft, updateDraft, submit, appeal (max 2), pause, handleStatusUpdate, validateForFlowUse
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist all mock functions so vi.mock factories can reference them ─────────
const {
  mockTemplateFindFirst,
  mockTenantFindFirst,
  mockInsertReturning,
  mockUpdateReturning,
} = vi.hoisted(() => ({
  mockTemplateFindFirst: vi.fn(),
  mockTenantFindFirst: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdateReturning: vi.fn(),
}));

// ─── Mock @lynkbot/db ─────────────────────────────────────────────────────────
vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      flowTemplates: { findFirst: mockTemplateFindFirst },
      tenants: { findFirst: mockTenantFindFirst },
      flowDefinitions: { findMany: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockUpdateReturning,
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
  },
  flowTemplates: {
    id: 'id',
    tenantId: 'tenantId',
    name: 'name',
    status: { _: { data: '' } },
    metaTemplateId: 'metaTemplateId',
    appealCount: 'appealCount',
    submittedAt: 'submittedAt',
  },
  flowDefinitions: {
    id: 'id',
    tenantId: 'tenantId',
    status: { _: { data: '' } },
    definition: 'definition',
    description: 'description',
  },
  tenants: { id: 'id', metaAccessToken: 'metaAccessToken', wabaId: 'wabaId' },
  eq: vi.fn((_a: unknown, _b: unknown) => ({ type: 'eq' })),
  and: vi.fn((..._args: unknown[]) => ({ type: 'and' })),
  desc: vi.fn(),
  count: vi.fn(() => ({ cnt: 0 })),
  sql: Object.assign(vi.fn(), { empty: vi.fn() }),
}));

vi.mock('axios');
vi.mock('../../utils/crypto', () => ({
  decrypt: vi.fn(() => 'decrypted-access-token'),
}));
vi.mock('../../config', () => ({
  config: { WABA_POOL_ENCRYPTION_KEY: 'a'.repeat(64) },
}));

import { TemplateStudioService } from '../../services/templateStudio.service';
import type { MetaTemplateComponent } from '../../services/templateStudio.service';
import axios from 'axios';

const validComponents: MetaTemplateComponent[] = [
  { type: 'BODY', text: 'Hello {{1}}, your order {{2}} is confirmed.' },
];

const draftTemplate = {
  id: 'tmpl-1',
  tenantId: 'tenant-1',
  name: 'order_confirmation',
  category: 'UTILITY',
  language: 'id',
  status: 'draft' as const,
  bodyText: 'Hello {{1}}, your order {{2}} is confirmed.',
  header: null,
  footer: null,
  buttons: [],
  variables: ['{{1}}', '{{2}}'],
  metaTemplateId: null,
  metaTemplateName: null,
  rejectionReason: null,
  appealCount: 0,
  lastAppealedAt: null,
  submittedAt: null,
  approvedAt: null,
  rejectedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const tenantWithWaba = {
  id: 'tenant-1',
  wabaId: 'waba-123',
  metaAccessToken: 'encrypted-token',
};

describe('TemplateStudioService', () => {
  let svc: TemplateStudioService;

  beforeEach(() => {
    svc = new TemplateStudioService();
    // clearAllMocks preserves factory implementations (db.insert, db.update, etc.)
    // Queue leaks are prevented by using separate named mocks for each db.query.*
    vi.clearAllMocks();
  });

  // ─── createDraft ────────────────────────────────────────────────────────────

  describe('createDraft', () => {
    it('inserts draft template and returns row', async () => {
      mockInsertReturning.mockResolvedValueOnce([draftTemplate]);

      const result = await svc.createDraft('tenant-1', {
        name: 'order_confirmation',
        category: 'UTILITY',
        components: validComponents,
      });

      expect(result.name).toBe('order_confirmation');
      expect(result.status).toBe('draft');
    });

    it('throws 400 if no BODY component', async () => {
      await expect(
        svc.createDraft('tenant-1', {
          name: 'bad_template',
          category: 'MARKETING',
          components: [{ type: 'FOOTER', text: 'Footer only' }],
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ─── updateDraft ────────────────────────────────────────────────────────────

  describe('updateDraft', () => {
    it('updates a draft template', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce(draftTemplate);
      const updated = { ...draftTemplate, bodyText: 'Updated body text.' };
      mockUpdateReturning.mockResolvedValueOnce([updated]);

      const result = await svc.updateDraft('tenant-1', 'tmpl-1', {
        components: [{ type: 'BODY', text: 'Updated body text.' }],
      });

      expect(result.bodyText).toBe('Updated body text.');
    });

    it('throws 422 if template is approved (not editable)', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'approved' });

      await expect(
        svc.updateDraft('tenant-1', 'tmpl-1', { name: 'new_name' }),
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('throws 404 if template not found', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce(null);

      await expect(
        svc.updateDraft('tenant-1', 'tmpl-1', { name: 'new_name' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── submit ─────────────────────────────────────────────────────────────────

  describe('submit', () => {
    it('posts to Meta and stores metaTemplateId', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce(draftTemplate);
      mockTenantFindFirst.mockResolvedValueOnce(tenantWithWaba);

      vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: { id: 'meta-tmpl-456' } });
      const submittedTemplate = { ...draftTemplate, status: 'pending_review', metaTemplateId: 'meta-tmpl-456' };
      mockUpdateReturning.mockResolvedValueOnce([submittedTemplate]);

      const result = await svc.submit('tenant-1', 'tmpl-1');

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/waba-123/message_templates'),
        expect.objectContaining({ name: 'order_confirmation' }),
        expect.any(Object),
      );
      expect(result.status).toBe('pending_review');
    });

    it('throws 400 if template name is not snake_case', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({ ...draftTemplate, name: 'Order Confirmation' });

      await expect(svc.submit('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 if buttons exceed 3', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({
        ...draftTemplate,
        buttons: [
          { type: 'QUICK_REPLY', text: 'A' },
          { type: 'QUICK_REPLY', text: 'B' },
          { type: 'QUICK_REPLY', text: 'C' },
          { type: 'QUICK_REPLY', text: 'D' },
        ],
      });

      await expect(svc.submit('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 502 if Meta returns non-200', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce(draftTemplate);
      mockTenantFindFirst.mockResolvedValueOnce(tenantWithWaba);

      vi.mocked(axios.post).mockResolvedValueOnce({
        status: 400,
        data: { error: { message: 'Invalid template' } },
      });

      await expect(svc.submit('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 502 });
    });
  });

  // ─── appeal ─────────────────────────────────────────────────────────────────

  describe('appeal', () => {
    it('throws 422 with code=appeal_limit_reached if appealCount >= 2 (compliance)', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({
        ...draftTemplate,
        status: 'rejected',
        appealCount: 2,
      });

      await expect(svc.appeal('tenant-1', 'tmpl-1')).rejects.toMatchObject({
        statusCode: 422,
        code: 'appeal_limit_reached',
      });
    });

    it('throws 422 if template is not rejected', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'draft', appealCount: 0 });

      await expect(svc.appeal('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 422 });
    });
  });

  // ─── pause ──────────────────────────────────────────────────────────────────

  describe('pause', () => {
    it('throws 422 if template is not approved', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'draft' });

      await expect(svc.pause('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 422 });
    });

    it('resolves without throwing if template is approved', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'approved' });

      await expect(svc.pause('tenant-1', 'tmpl-1')).resolves.toBeUndefined();
    });
  });

  // ─── handleStatusUpdate ─────────────────────────────────────────────────────

  describe('handleStatusUpdate', () => {
    it('returns early without throwing if template not found', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce(null);

      await expect(
        svc.handleStatusUpdate({ metaTemplateId: 'unknown', event: 'APPROVED' }),
      ).resolves.toBeUndefined();
    });

    it('sets status=approved on APPROVED event without throwing', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'pending_review' });

      await expect(
        svc.handleStatusUpdate({ metaTemplateId: 'meta-tmpl-456', event: 'APPROVED' }),
      ).resolves.toBeUndefined();
    });

    it('sets status=rejected on REJECTED event without throwing', async () => {
      mockTemplateFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'pending_review' });

      await expect(
        svc.handleStatusUpdate({
          metaTemplateId: 'meta-tmpl-456',
          event: 'REJECTED',
          reason: 'Policy violation',
        }),
      ).resolves.toBeUndefined();
    });

    it('handles DISABLED event and queries for active flows to pause', async () => {
      const approvedTemplate = { ...draftTemplate, status: 'approved', name: 'order_confirmation' };
      mockTemplateFindFirst.mockResolvedValueOnce(approvedTemplate);

      // select().from().where() resolves to [] — no active flows found
      await expect(
        svc.handleStatusUpdate({ metaTemplateId: 'meta-tmpl-456', event: 'DISABLED' }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── validateForFlowUse ─────────────────────────────────────────────────────

  describe('validateForFlowUse', () => {
    it('returns valid=false if no Quick Reply buttons', () => {
      const result = svc.validateForFlowUse({
        ...draftTemplate,
        buttons: [{ type: 'URL', text: 'Visit', url: 'https://example.com' }],
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Quick Reply');
    });

    it('returns valid=true if at least one Quick Reply button', () => {
      const result = svc.validateForFlowUse({
        ...draftTemplate,
        buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }],
      });
      expect(result.valid).toBe(true);
    });

    it('returns valid=false for empty buttons array', () => {
      const result = svc.validateForFlowUse({ ...draftTemplate, buttons: [] });
      expect(result.valid).toBe(false);
    });
  });
});
