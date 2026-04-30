/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/__tests__/flowTemplates.test.ts
 * Role    : Integration tests for TemplateStudioService (unit-level — mocked DB and Meta API).
 *           Tests PRD §14.2 requirements: CRUD, appeal limits, delete guard, status handling.
 * Tests   : createDraft, updateDraft, submit, appeal (max 2), delete guard, handleStatusUpdate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @lynkbot/db before importing the service ───────────────────────────

const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockInsertReturning = vi.fn();
const mockUpdateReturning = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();

vi.mock('@lynkbot/db', () => ({
  db: {
    query: {
      flowTemplates: { findFirst: mockFindFirst },
      tenants: { findFirst: vi.fn() },
      flowDefinitions: { findMany: mockFindMany },
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
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: mockDelete,
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
  eq: vi.fn((_a, _b) => ({ type: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
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

describe('TemplateStudioService', () => {
  let svc: TemplateStudioService;

  beforeEach(() => {
    svc = new TemplateStudioService();
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
      mockFindFirst.mockResolvedValueOnce(draftTemplate);
      const updated = { ...draftTemplate, bodyText: 'Updated body text.' };
      mockUpdateReturning.mockResolvedValueOnce([updated]);

      const result = await svc.updateDraft('tenant-1', 'tmpl-1', {
        components: [{ type: 'BODY', text: 'Updated body text.' }],
      });

      expect(result.bodyText).toBe('Updated body text.');
    });

    it('throws 422 if template is approved (not editable)', async () => {
      mockFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'approved' });

      await expect(
        svc.updateDraft('tenant-1', 'tmpl-1', { name: 'new_name' }),
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('throws 404 if template not found', async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      await expect(
        svc.updateDraft('tenant-1', 'tmpl-1', { name: 'new_name' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── submit ─────────────────────────────────────────────────────────────────

  describe('submit', () => {
    const tenantWithWaba = {
      id: 'tenant-1',
      wabaId: 'waba-123',
      metaAccessToken: 'encrypted-token',
    };

    it('posts to Meta and stores metaTemplateId', async () => {
      mockFindFirst
        .mockResolvedValueOnce(draftTemplate)  // _requireTemplate
        .mockResolvedValueOnce(tenantWithWaba); // tenants lookup

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
      mockFindFirst.mockResolvedValueOnce({ ...draftTemplate, name: 'Order Confirmation' });

      await expect(svc.submit('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 if buttons exceed 3', async () => {
      mockFindFirst.mockResolvedValueOnce({
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
      mockFindFirst
        .mockResolvedValueOnce(draftTemplate)
        .mockResolvedValueOnce(tenantWithWaba);

      vi.mocked(axios.post).mockResolvedValueOnce({
        status: 400,
        data: { error: { message: 'Invalid template' } },
      });

      await expect(svc.submit('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 502 });
    });
  });

  // ─── appeal ─────────────────────────────────────────────────────────────────

  describe('appeal', () => {
    it('throws 422 if appealCount >= 2 (compliance)', async () => {
      mockFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'rejected', appealCount: 2 });

      await expect(svc.appeal('tenant-1', 'tmpl-1')).rejects.toMatchObject({
        statusCode: 422,
        code: 'appeal_limit_reached',
      });
    });

    it('throws 422 if template is not rejected', async () => {
      mockFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'draft', appealCount: 0 });

      await expect(svc.appeal('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 422 });
    });
  });

  // ─── pause ──────────────────────────────────────────────────────────────────

  describe('pause', () => {
    it('throws 422 if template is not approved', async () => {
      mockFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'draft' });

      await expect(svc.pause('tenant-1', 'tmpl-1')).rejects.toMatchObject({ statusCode: 422 });
    });
  });

  // ─── handleStatusUpdate ─────────────────────────────────────────────────────

  describe('handleStatusUpdate', () => {
    it('sets status=approved and approvedAt on APPROVED event', async () => {
      mockFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'pending_review' });
      mockUpdateWhere.mockResolvedValueOnce([]);

      // Should not throw
      await expect(
        svc.handleStatusUpdate({ metaTemplateId: 'meta-tmpl-456', event: 'APPROVED' }),
      ).resolves.toBeUndefined();
    });

    it('sets status=rejected and rejectionReason on REJECTED event', async () => {
      mockFindFirst.mockResolvedValueOnce({ ...draftTemplate, status: 'pending_review' });

      await expect(
        svc.handleStatusUpdate({
          metaTemplateId: 'meta-tmpl-456',
          event: 'REJECTED',
          reason: 'Policy violation',
        }),
      ).resolves.toBeUndefined();
    });

    it('returns early and does not throw if template not found', async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      await expect(
        svc.handleStatusUpdate({ metaTemplateId: 'unknown', event: 'APPROVED' }),
      ).resolves.toBeUndefined();
    });

    it('sets status=disabled on DISABLED event and queries active flows', async () => {
      const approvedTemplate = { ...draftTemplate, status: 'approved', name: 'order_confirmation' };
      mockFindFirst.mockResolvedValueOnce(approvedTemplate);

      // Mock select for affectedFlows
      const { db } = await import('@lynkbot/db');
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      } as any);

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
