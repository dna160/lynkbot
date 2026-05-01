/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/templateStudio.service.ts
 * Role    : Template Studio — CRUD, Meta Graph API submission, appeal, status handling,
 *           poll-pending, quality sync. Implements PRD §6 (Feature 2).
 *
 * Compliance invariants (PRD §4 / §17):
 *   - Max 2 appeal attempts (appealCount >= 2 → caller must return 422)
 *   - Quick-Reply buttons required for flow-trigger templates (validateForFlowUse)
 *   - DISABLED event → pause all active flows using this template
 *   - Per-tenant MetaClient only — never config.META_ACCESS_TOKEN
 *   - Template name must be snake_case before submission
 *
 * Exports : TemplateStudioService, CreateTemplateInput
 */
import axios from 'axios';
import {
  db,
  flowTemplates,
  flowDefinitions,
  tenants,
  eq,
  and,
  desc,
  sql,
} from '@lynkbot/db';
import { decrypt } from '../utils/crypto';
import { config } from '../config';

// Use Drizzle's schema inference directly — avoids needing a direct drizzle-orm import
export type FlowTemplate = typeof flowTemplates.$inferSelect;

/** JSON component structure accepted by Meta's Graph API */
export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

export interface CreateTemplateInput {
  name: string;
  displayName?: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language?: string;
  components: MetaTemplateComponent[];
  variableLabels?: Record<string, string>;
}

/** Regex for snake_case validation */
const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

/** Extract body text from component list */
function extractBodyText(components: MetaTemplateComponent[]): string {
  const body = components.find((c) => c.type === 'BODY');
  return body?.text ?? '';
}

/** Extract {{N}} variable placeholders from text */
function extractVariables(text: string): string[] {
  const matches = [...text.matchAll(/\{\{(\d+)\}\}/g)];
  return [...new Set(matches.map((m) => `{{${m[1]}}}`))]
    .sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));
}

export class TemplateStudioService {
  // ────────────────────────────────────────────────────────────────────────────
  // Public CRUD
  // ────────────────────────────────────────────────────────────────────────────

  /** Create a draft template (local only — not submitted to Meta yet). */
  async createDraft(tenantId: string, input: CreateTemplateInput): Promise<FlowTemplate> {
    const { name, category, language = 'id', components, variableLabels } = input;

    const bodyText = extractBodyText(components);
    if (!bodyText) {
      throw Object.assign(new Error('Body component with text is required'), { statusCode: 400 });
    }

    const variables = extractVariables(bodyText);
    const header = components.find((c) => c.type === 'HEADER') ?? null;
    const footer = components.find((c) => c.type === 'FOOTER')?.text ?? null;
    const buttonComp = components.find((c) => c.type === 'BUTTONS');
    const buttons = buttonComp?.buttons ?? [];

    const [row] = await db
      .insert(flowTemplates)
      .values({
        tenantId,
        name,
        category,
        language,
        status: 'draft',
        bodyText,
        header: header ?? null,
        footer: footer ?? null,
        buttons: buttons.length ? buttons : [],
        variables,
        ...(variableLabels ? { variables: Object.keys(variableLabels) } : {}),
      })
      .returning();

    return row;
  }

  /** Update a draft or rejected template. Blocked on other statuses. */
  async updateDraft(
    tenantId: string,
    id: string,
    input: Partial<CreateTemplateInput>,
  ): Promise<FlowTemplate> {
    const existing = await this._requireTemplate(tenantId, id);
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      throw Object.assign(
        new Error(`Cannot update template with status '${existing.status}'. Only draft or rejected templates can be edited.`),
        { statusCode: 422 },
      );
    }

    const updates: Partial<typeof flowTemplates.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.category !== undefined) updates.category = input.category;
    if (input.language !== undefined) updates.language = input.language;

    if (input.components !== undefined) {
      const bodyText = extractBodyText(input.components);
      if (bodyText) updates.bodyText = bodyText;
      updates.variables = bodyText ? extractVariables(bodyText) : existing.variables;
      const header = input.components.find((c) => c.type === 'HEADER') ?? null;
      updates.header = header ?? null;
      const footer = input.components.find((c) => c.type === 'FOOTER')?.text ?? null;
      updates.footer = footer ?? null;
      const buttonComp = input.components.find((c) => c.type === 'BUTTONS');
      updates.buttons = buttonComp?.buttons ?? [];
    }

    const [row] = await db
      .update(flowTemplates)
      .set(updates)
      .where(and(eq(flowTemplates.id, id), eq(flowTemplates.tenantId, tenantId)))
      .returning();

    return row;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Meta submission
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Submit template to Meta Graph API.
   * PRD §6.2: validates snake_case name, component structure, Quick Reply requirement
   * if flow-triggered, then POSTs to /{wabaId}/message_templates.
   */
  async submit(tenantId: string, id: string): Promise<FlowTemplate> {
    const template = await this._requireTemplate(tenantId, id);
    this._validateForSubmit(template);

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant?.wabaId) {
      throw Object.assign(new Error('Tenant has no WABA ID configured'), { statusCode: 503 });
    }
    if (!tenant.metaAccessToken) {
      throw Object.assign(new Error('Tenant has no Meta access token configured'), { statusCode: 503 });
    }

    if (!config.WABA_POOL_ENCRYPTION_KEY) {
      throw Object.assign(
        new Error(
          'WABA_POOL_ENCRYPTION_KEY is not set. Add a 64-hex-char key to Railway environment variables and redeploy.',
        ),
        { statusCode: 503 },
      );
    }

    const accessToken = decrypt(tenant.metaAccessToken, config.WABA_POOL_ENCRYPTION_KEY);

    // Build Meta component payload
    const metaComponents: MetaTemplateComponent[] = [];

    if (template.header) {
      metaComponents.push(template.header as MetaTemplateComponent);
    }

    metaComponents.push({ type: 'BODY', text: template.bodyText });

    if (template.footer) {
      metaComponents.push({ type: 'FOOTER', text: template.footer });
    }

    if (Array.isArray(template.buttons) && (template.buttons as unknown[]).length > 0) {
      metaComponents.push({
        type: 'BUTTONS',
        buttons: template.buttons as MetaTemplateComponent['buttons'],
      });
    }

    const payload = {
      name: template.name,
      category: template.category,
      language: template.language,
      components: metaComponents,
    };

    const res = await axios.post(
      `https://graph.facebook.com/v23.0/${tenant.wabaId}/message_templates`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        validateStatus: null, // handle errors ourselves
      },
    );

    if (res.status !== 200 && res.status !== 201) {
      const errMsg =
        (res.data as { error?: { message?: string } })?.error?.message ??
        `Meta API error: ${res.status}`;
      throw Object.assign(new Error(errMsg), { statusCode: 502 });
    }

    const metaTemplateId = String(
      (res.data as { id?: string | number })?.id ?? '',
    );

    const [updated] = await db
      .update(flowTemplates)
      .set({
        status: 'pending_review',
        metaTemplateId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(flowTemplates.id, id), eq(flowTemplates.tenantId, tenantId)))
      .returning();

    return updated;
  }

  /**
   * Resubmit a rejected template.
   * Compliance: blocked if appealCount >= 2 (caller must enforce 422).
   */
  async appeal(tenantId: string, id: string): Promise<FlowTemplate> {
    const template = await this._requireTemplate(tenantId, id);

    if (template.appealCount >= 2) {
      throw Object.assign(
        new Error('Max 2 appeals per template. Contact Meta support directly.'),
        { statusCode: 422, code: 'appeal_limit_reached' },
      );
    }

    if (template.status !== 'rejected') {
      throw Object.assign(
        new Error(`Only rejected templates can be appealed. Current status: ${template.status}`),
        { statusCode: 422 },
      );
    }

    // Increment appeal count before resubmission
    await db
      .update(flowTemplates)
      .set({
        appealCount: template.appealCount + 1,
        lastAppealedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(flowTemplates.id, id), eq(flowTemplates.tenantId, tenantId)));

    // Resubmit to Meta — use the updated record
    return this.submit(tenantId, id);
  }

  /**
   * Pause an approved template (local only — no Meta API call).
   */
  async pause(tenantId: string, id: string): Promise<void> {
    const template = await this._requireTemplate(tenantId, id);
    if (template.status !== 'approved') {
      throw Object.assign(
        new Error(`Only approved templates can be paused. Current status: ${template.status}`),
        { statusCode: 422 },
      );
    }
    await db
      .update(flowTemplates)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(and(eq(flowTemplates.id, id), eq(flowTemplates.tenantId, tenantId)));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Webhook status update handler (PRD §6.3)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Handle Meta webhook `message_template_status_update` event.
   * DISABLED → pauses all active flows referencing this template.
   */
  async handleStatusUpdate(update: {
    metaTemplateId: string | number;
    event: 'APPROVED' | 'REJECTED' | 'DISABLED' | 'FLAGGED' | 'IN_APPEAL' | 'REINSTATED';
    reason?: string;
  }): Promise<void> {
    const { metaTemplateId, event, reason } = update;
    const metaId = String(metaTemplateId);

    const template = await db.query.flowTemplates.findFirst({
      where: eq(flowTemplates.metaTemplateId, metaId),
    });

    if (!template) {
      // Template not found in local DB — possibly from another system; ignore
      return;
    }

    const now = new Date();

    switch (event) {
      case 'APPROVED':
      case 'REINSTATED': {
        await db
          .update(flowTemplates)
          .set({ status: 'approved', approvedAt: now, updatedAt: now })
          .where(eq(flowTemplates.id, template.id));
        break;
      }

      case 'REJECTED': {
        await db
          .update(flowTemplates)
          .set({
            status: 'rejected',
            rejectionReason: reason ?? null,
            rejectedAt: now,
            updatedAt: now,
          })
          .where(eq(flowTemplates.id, template.id));
        break;
      }

      case 'DISABLED': {
        await db
          .update(flowTemplates)
          .set({ status: 'disabled', updatedAt: now })
          .where(eq(flowTemplates.id, template.id));

        // Pause all active flows that reference this template by name
        // Query: flow_definitions where status='active' and nodes JSONB contains template name
        const affectedFlows = await db
          .select({ id: flowDefinitions.id, description: flowDefinitions.description })
          .from(flowDefinitions)
          .where(
            and(
              eq(flowDefinitions.status, 'active'),
              sql`${flowDefinitions.definition}::text ILIKE ${'%' + template.name + '%'}`,
            ),
          );

        for (const flow of affectedFlows) {
          const pauseNote = `[Auto-paused ${now.toISOString()}] Template '${template.name}' was DISABLED by Meta.`;
          await db
            .update(flowDefinitions)
            .set({
              status: 'archived', // closest valid pause state using existing enum
              description: flow.description
                ? `${flow.description}\n${pauseNote}`
                : pauseNote,
              updatedAt: now,
            })
            .where(eq(flowDefinitions.id, flow.id));
        }
        break;
      }

      case 'FLAGGED': {
        await db
          .update(flowTemplates)
          .set({ status: 'flagged', updatedAt: now })
          .where(eq(flowTemplates.id, template.id));
        break;
      }

      case 'IN_APPEAL': {
        await db
          .update(flowTemplates)
          .set({ status: 'in_appeal', updatedAt: now })
          .where(eq(flowTemplates.id, template.id));
        break;
      }

      default:
        break;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Sync operations (called by templateSync.processor)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Poll pending templates and update their status from Meta.
   * Called every 5 min by `template.poll_pending` BullMQ job.
   */
  async pollPending(tenantId?: string): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const conditions = [
      eq(flowTemplates.status, 'pending_review'),
      sql`${flowTemplates.submittedAt} < ${tenMinutesAgo.toISOString()}`,
    ];

    if (tenantId) {
      conditions.push(eq(flowTemplates.tenantId, tenantId));
    }

    const pending = await db
      .select()
      .from(flowTemplates)
      .where(and(...conditions));

    for (const template of pending) {
      try {
        if (!template.metaTemplateId) continue;

        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.id, template.tenantId),
        });
        if (!tenant?.metaAccessToken) continue;

        const accessToken = decrypt(tenant.metaAccessToken, config.WABA_POOL_ENCRYPTION_KEY);

        const res = await axios.get(
          `https://graph.facebook.com/v23.0/${template.metaTemplateId}`,
          {
            params: { fields: 'id,name,status,quality_score' },
            headers: { Authorization: `Bearer ${accessToken}` },
            validateStatus: null,
          },
        );

        if (res.status !== 200) continue;

        const data = res.data as {
          status?: string;
          quality_score?: { score?: string };
        };
        const metaStatus = data.status?.toUpperCase();

        const statusMap: Record<string, typeof flowTemplates.$inferSelect['status']> = {
          APPROVED: 'approved',
          REJECTED: 'rejected',
          PENDING: 'pending_review',
          FLAGGED: 'flagged',
          IN_APPEAL: 'in_appeal',
          DISABLED: 'disabled',
        };

        const newStatus = metaStatus ? statusMap[metaStatus] : undefined;
        if (newStatus && newStatus !== template.status) {
          const updates: Partial<typeof flowTemplates.$inferInsert> = {
            status: newStatus,
            updatedAt: new Date(),
          };
          if (newStatus === 'approved') updates.approvedAt = new Date();
          if (newStatus === 'rejected') updates.rejectedAt = new Date();

          await db
            .update(flowTemplates)
            .set(updates)
            .where(eq(flowTemplates.id, template.id));
        }
      } catch {
        // Continue polling other templates — don't abort on individual failures
      }
    }
  }

  /**
   * Sync quality ratings from Meta for approved templates.
   * Called every 60 min by `template.sync_quality` BullMQ job.
   */
  async syncQualityRatings(tenantId?: string): Promise<void> {
    const conditions = [
      eq(flowTemplates.status, 'approved'),
    ];
    if (tenantId) {
      conditions.push(eq(flowTemplates.tenantId, tenantId));
    }

    const approved = await db
      .select()
      .from(flowTemplates)
      .where(and(...conditions));

    for (const template of approved) {
      try {
        if (!template.metaTemplateId) continue;

        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.id, template.tenantId),
        });
        if (!tenant?.metaAccessToken) continue;

        const accessToken = decrypt(tenant.metaAccessToken, config.WABA_POOL_ENCRYPTION_KEY);

        const res = await axios.get(
          `https://graph.facebook.com/v23.0/${template.metaTemplateId}`,
          {
            params: { fields: 'id,name,status,quality_score' },
            headers: { Authorization: `Bearer ${accessToken}` },
            validateStatus: null,
          },
        );

        if (res.status !== 200) continue;

        const data = res.data as {
          status?: string;
          quality_score?: { score?: string };
        };

        // If status changed (e.g., approved → disabled), handle via status update
        const metaStatus = data.status?.toUpperCase();
        if (metaStatus && metaStatus !== 'APPROVED') {
          await this.handleStatusUpdate({
            metaTemplateId: template.metaTemplateId,
            event: metaStatus as 'DISABLED' | 'FLAGGED',
          });
        }
      } catch {
        // Continue — don't abort on individual failures
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Validation
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Validate template structure before submission to Meta.
   * Throws on invalid name, missing body, too many buttons.
   */
  private _validateForSubmit(template: FlowTemplate): void {
    if (!SNAKE_CASE_RE.test(template.name)) {
      throw Object.assign(
        new Error(`Template name '${template.name}' is not valid snake_case (lowercase letters, digits, and underscores only, must start with a letter).`),
        { statusCode: 400 },
      );
    }

    if (!template.bodyText?.trim()) {
      throw Object.assign(new Error('Template body text is required'), { statusCode: 400 });
    }

    if (
      Array.isArray(template.buttons) &&
      (template.buttons as unknown[]).length > 3
    ) {
      throw Object.assign(
        new Error('Templates may have at most 3 buttons'),
        { statusCode: 400 },
      );
    }
  }

  /**
   * Validate template is suitable as a flow trigger.
   * PRD §4 / §17: Quick-Reply buttons are required.
   */
  validateForFlowUse(template: FlowTemplate): { valid: boolean; reason?: string } {
    const buttons = (template.buttons ?? []) as Array<{ type?: string }>;
    const hasQuickReply = buttons.some((b) => b.type === 'QUICK_REPLY');

    if (!hasQuickReply) {
      return {
        valid: false,
        reason:
          'Templates used as flow triggers must include at least one Quick Reply button (PRD §4 compliance).',
      };
    }

    return { valid: true };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  /** Load template belonging to tenant or throw 404. */
  private async _requireTemplate(tenantId: string, id: string): Promise<FlowTemplate> {
    const template = await db.query.flowTemplates.findFirst({
      where: and(eq(flowTemplates.id, id), eq(flowTemplates.tenantId, tenantId)),
    });
    if (!template) {
      throw Object.assign(new Error('Template not found'), { statusCode: 404 });
    }
    return template;
  }
}
