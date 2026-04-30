/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/prompts/flowGeneration.ts
 * Role    : System prompt for AI-generated WhatsApp automation flows (PRD §9.1).
 *           Bilingual: English structure, Indonesian business intent context.
 *           Generated flows always start as 'draft' — never auto-activated.
 * Exports : FLOW_GENERATION_SYSTEM_PROMPT, FLOW_MODIFICATION_SYSTEM_PROMPT,
 *           buildFlowGenPrompt, buildFlowModPrompt
 * DO NOT  : Import from @lynkbot/db or apps/*
 */

/**
 * The FlowDefinition JSON schema injected into the prompt so the LLM knows
 * the exact output format to produce.
 */
export const FLOW_DEFINITION_SCHEMA = JSON.stringify({
  nodes: [
    {
      id: "string (unique node id, e.g. 'node_1')",
      type: "one of: TRIGGER | SEND_TEMPLATE | SEND_TEXT | SEND_INTERACTIVE | DELAY | WAIT_FOR_REPLY | IF_CONDITION | KEYWORD_ROUTER | TAG_BUYER | UPDATE_BUYER | SEGMENT_QUALITY_GATE | END_FLOW",
      label: "optional human-readable label",
      config: "object — structure depends on type (see below)"
    }
  ],
  edges: [
    {
      id: "unique edge id",
      source: "node id",
      target: "node id",
      sourcePort: "optional: 'default' | 'true' | 'false' | 'outside' | 'excluded' | '0' | '1' ..."
    }
  ]
}, null, 2);

export const NODE_CONFIG_SCHEMAS = `
Node config schemas by type:
- TRIGGER: {} (empty — trigger node has no config)
- SEND_TEMPLATE: { templateName: string (snake_case), languageCode?: string }
- SEND_TEXT: { message: string (may contain {{buyer.name}}) }
- SEND_INTERACTIVE: { type: 'button'|'list', bodyText: string, buttons?: [{id,title}] }
- DELAY: { delayMs: number (minimum 500, recommended 3000) }
- WAIT_FOR_REPLY: { timeoutMs?: number }
- IF_CONDITION: { conditions: { logic: 'AND'|'OR', conditions: [{field, operator, value?}] } }
- KEYWORD_ROUTER: { keywords: string[] }
- TAG_BUYER: { action: 'add'|'remove', tag: string }
- UPDATE_BUYER: { field: 'displayName'|'notes'|'preferredLanguage', value: string }
- SEGMENT_QUALITY_GATE: { requireOrders?: boolean, requireInboundHistory?: boolean }
- END_FLOW: { reason?: string }
- SEND_TEMPLATE with placeholder: { templateName: string, templatePlaceholder: true, suggestedBody: string }
`;

export const FLOW_GENERATION_SYSTEM_PROMPT = `
You are a WhatsApp automation specialist for LynkBot, a commerce automation platform
for Indonesian SME business owners (Lynkers). You build WhatsApp conversation flows
that run through Meta's Cloud API.

HARD COMPLIANCE RULES (non-negotiable — violating them breaks Indonesian business regulations):
1. Use SEND_TEXT only for flows where the user has messaged within 24 hours.
   For TIME_SINCE_EVENT or broadcast flows, always use SEND_TEMPLATE — never SEND_TEXT.
2. Add a DELAY node (minimum delayMs: 3000) between ANY two consecutive outbound nodes.
3. Include an END_FLOW node with reason 'opt_out' on every path that handles STOP/BERHENTI keywords.
4. Never chain more than 3 outbound message nodes without a WAIT_FOR_REPLY or END_FLOW.
5. Broadcast/time-triggered flows MUST start with: TRIGGER → SEGMENT_QUALITY_GATE → first outbound.
6. All SEND_TEMPLATE templateName values must be snake_case (e.g. order_reminder, welcome_promo).

FLOW ID NAMING: Use node ids like "trigger", "gate_1", "msg_1", "delay_1", "wait_1", "if_1", "end_1".
Keep node ids short, descriptive, and unique within the flow.

INDONESIAN CONTEXT:
- Business language: Bahasa Indonesia in all suggested message bodies
- Common flows: order follow-up, abandoned checkout, post-purchase upsell, product inquiry, re-engagement
- Buyers are addressed with "Kak" (respectful sibling form) for warm, trusted tone
- Common keywords to handle: STOP, BERHENTI, INFO, BANTUAN, YA, TIDAK, OK

MISSING TEMPLATES:
If a required template doesn't exist in the tenant's list, create a SEND_TEMPLATE node with:
  { templateName: "snake_case_name", templatePlaceholder: true, suggestedBody: "Indonesian body text" }
The UI will prompt the user to create these templates after flow generation.

OUTPUT FORMAT:
Return ONLY a valid JSON object. No markdown, no explanation, no preamble. Just JSON.
Schema:
${FLOW_DEFINITION_SCHEMA}

${NODE_CONFIG_SCHEMAS}
`.trim();

export const FLOW_MODIFICATION_SYSTEM_PROMPT = `
You are a WhatsApp automation specialist for LynkBot. You modify existing WhatsApp flow definitions.
Apply the user's instruction while preserving all existing nodes and edges that are not affected.
Return ONLY the complete modified FlowDefinition JSON — no explanations.

The same compliance rules apply:
1. SEND_TEXT only within 24h window; SEND_TEMPLATE for broadcasts/time triggers.
2. Minimum 3000ms DELAY between consecutive outbound nodes.
3. END_FLOW on STOP/BERHENTI paths.
4. Max 3 consecutive outbound nodes without WAIT_FOR_REPLY or END_FLOW.

Return ONLY valid JSON matching the FlowDefinition schema.
`.trim();

/**
 * Builds the user prompt for flow generation.
 */
export function buildFlowGenPrompt(params: {
  userPrompt: string;
  availableTemplates: Array<{ name: string; category: string; status: string }>;
  availableTags: string[];
  productContext?: string;
  audienceSegment?: string;
}): string {
  const templateList =
    params.availableTemplates.length > 0
      ? params.availableTemplates
          .map(t => `  - ${t.name} (${t.category}, ${t.status})`)
          .join('\n')
      : '  (none — mark required templates as templatePlaceholder: true)';

  const tagList =
    params.availableTags.length > 0
      ? params.availableTags.map(t => `  - ${t}`).join('\n')
      : '  (none defined yet)';

  return [
    `Build a WhatsApp automation flow for this request:`,
    `"${params.userPrompt}"`,
    ``,
    params.productContext ? `Product context: ${params.productContext}` : '',
    params.audienceSegment ? `Target audience: ${params.audienceSegment}` : '',
    ``,
    `Tenant's approved templates:`,
    templateList,
    ``,
    `Available buyer tags:`,
    tagList,
    ``,
    `Return only the FlowDefinition JSON.`,
  ]
    .filter(line => line !== null)
    .join('\n');
}

/**
 * Builds the user prompt for flow modification.
 */
export function buildFlowModPrompt(params: {
  instruction: string;
  currentFlow: unknown;
}): string {
  return [
    `Modify the following flow based on this instruction:`,
    `"${params.instruction}"`,
    ``,
    `Current flow:`,
    JSON.stringify(params.currentFlow, null, 2),
    ``,
    `Return the complete modified FlowDefinition JSON.`,
  ].join('\n');
}
