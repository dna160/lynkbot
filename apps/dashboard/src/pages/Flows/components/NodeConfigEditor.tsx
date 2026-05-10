import type { FlowNode } from '@/types/flow';
import type { IntentKey } from '@/hooks/useIntentPlaybooks';
import { useStaff } from '@/hooks/useScheduling';
import { useIntentPlaybooks, INTENT_KEY_LABELS } from '@/hooks/useIntentPlaybooks';
import { PALETTE_NODES } from './nodes/nodeConfig';
import { MessageEditor } from './MessageEditor';

type TriggerType = 'inbound_keyword' | 'time_based' | 'order_event' | 'manual';

interface NodeConfigEditorProps {
  node: FlowNode | null;
  triggerType?: TriggerType;
  onTriggerTypeChange?: (t: TriggerType) => void;
  onChange: (updated: FlowNode) => void;
  onDelete?: () => void;
}

export function NodeConfigEditor({
  node,
  triggerType,
  onTriggerTypeChange,
  onChange,
  onDelete,
}: NodeConfigEditorProps) {
  const { data: staffList } = useStaff();
  const { data: playbookList } = useIntentPlaybooks();

  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
          <svg className="w-5 h-5 text-secondary/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
        </div>
        <p className="text-sm text-secondary/50 font-medium">Click a node to configure it</p>
        <p className="text-xs text-secondary/30 mt-1">Select any node on the canvas</p>
      </div>
    );
  }

  const palette = PALETTE_NODES.find((x) => x.type === node.type);
  if (!palette) return null;

  const update = (patch: Partial<Record<string, unknown>>) => {
    onChange({ ...node, config: { ...node.config, ...patch } });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-border shrink-0"
        style={{ borderLeftColor: palette.color, borderLeftWidth: 3 }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{palette.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-primary leading-tight">{palette.label}</div>
            <div className="text-[10px] text-secondary/50 mt-0.5">{palette.description}</div>
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-900/20 text-secondary/40 hover:text-red-400 transition-colors shrink-0"
              title="Delete node"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {node.type === 'TRIGGER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Trigger Type</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={triggerType ?? 'inbound_keyword'}
                onChange={(e) => onTriggerTypeChange?.(e.target.value as TriggerType)}
              >
                <option value="inbound_keyword">Keyword Trigger</option>
                <option value="time_based">Scheduled (Cron)</option>
                <option value="order_event">Order Event</option>
                <option value="manual">Manual</option>
              </select>
            </label>

            {(triggerType === 'inbound_keyword' || !triggerType) && (
              <label className="block">
                <span className="text-xs font-medium text-secondary">Keywords</span>
                <input
                  className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                  placeholder="hello, hi, halo"
                  value={(Array.isArray(node.config.keywords) ? node.config.keywords as string[] : []).join(', ')}
                  onChange={(e) =>
                    update({ keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                  }
                />
                <span className="text-[10px] text-secondary/50 mt-1 block">
                  Comma-separated. Flow starts when buyer sends any of these.
                </span>
              </label>
            )}

            {triggerType === 'time_based' && (
              <label className="block">
                <span className="text-xs font-medium text-secondary">Cron Expression (Jakarta UTC+7)</span>
                <input
                  className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                  placeholder="0 9 * * 1  (Mon 9am)"
                  value={String(node.config.cronExpression ?? '')}
                  onChange={(e) => update({ cronExpression: e.target.value })}
                />
                <span className="text-[10px] text-secondary/50 mt-1 block">
                  Format: min hour day month weekday
                </span>
              </label>
            )}

            {triggerType === 'order_event' && (
              <label className="block">
                <span className="text-xs font-medium text-secondary">Order Event</span>
                <select
                  className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                  value={String(node.config.orderEvent ?? 'order_confirmed')}
                  onChange={(e) => update({ orderEvent: e.target.value })}
                >
                  <option value="order_confirmed">Order Confirmed</option>
                  <option value="order_shipped">Order Shipped</option>
                  <option value="order_delivered">Order Delivered</option>
                  <option value="payment_expired">Payment Expired</option>
                </select>
              </label>
            )}

            {triggerType === 'manual' && (
              <p className="text-xs text-secondary/50 bg-white/5 rounded-lg p-3">
                Manual flows are started via the API or a broadcast campaign. No extra config needed.
              </p>
            )}
          </div>
        )}

        {node.type === 'SEND_TEMPLATE' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Template Name (snake_case)</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                placeholder="order_confirmation"
                value={String(node.config.templateName ?? '')}
                onChange={(e) => update({ templateName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">Language Code</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="id"
                value={String(node.config.languageCode ?? 'id')}
                onChange={(e) => update({ languageCode: e.target.value })}
              />
            </label>
          </div>
        )}

        {node.type === 'SEND_TEXT' && (
          <MessageEditor
            label="Message"
            value={String(node.config.message ?? '')}
            onChange={(v) => update({ message: v })}
            placeholder="Hi {{buyer.name}}, your order is ready! 🎉"
            rows={5}
            hint="Click a chip below to insert a variable at your cursor."
          />
        )}

        {node.type === 'SEND_INTERACTIVE' && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Interaction Type</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={String(node.config.type ?? 'button')}
                onChange={(e) => update({ type: e.target.value })}
              >
                <option value="button">Button</option>
                <option value="list">List</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                Header text <span className="text-secondary/40">(optional)</span>
              </span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="Order update for {{buyer.name}}"
                value={String(node.config.headerText ?? '')}
                onChange={(e) => update({ headerText: e.target.value })}
              />
            </label>
            <MessageEditor
              label="Body text"
              value={String(node.config.bodyText ?? '')}
              onChange={(v) => update({ bodyText: v })}
              placeholder="Hi {{buyer.name}}, please choose an option:"
              rows={4}
              hint="Main message shown to the buyer."
            />
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                Footer text <span className="text-secondary/40">(optional)</span>
              </span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="Reply with a number to choose"
                value={String(node.config.footerText ?? '')}
                onChange={(e) => update({ footerText: e.target.value })}
              />
            </label>
          </div>
        )}

        {node.type === 'DELAY' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Delay (milliseconds)</span>
              <input
                type="number"
                min={500}
                step={500}
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={Number(node.config.delayMs ?? 3000)}
                onChange={(e) => update({ delayMs: Number(e.target.value) })}
              />
            </label>
            <div className="flex gap-2">
              {[1000, 3000, 5000, 30000, 60000].map((ms) => (
                <button
                  key={ms}
                  onClick={() => update({ delayMs: ms })}
                  className="flex-1 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-secondary hover:text-primary transition-colors"
                >
                  {ms >= 60000 ? `${ms / 60000}m` : `${ms / 1000}s`}
                </button>
              ))}
            </div>
          </div>
        )}

        {node.type === 'WAIT_FOR_REPLY' && (
          <label className="block">
            <span className="text-xs font-medium text-secondary">Timeout (ms, 0 = wait forever)</span>
            <input
              type="number"
              min={0}
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={Number(node.config.timeoutMs ?? 0)}
              onChange={(e) => update({ timeoutMs: Number(e.target.value) || undefined })}
            />
          </label>
        )}

        {node.type === 'IF_CONDITION' && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-secondary mb-2">Branch Outputs</div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-green-900/10 border border-green-800/30">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-green-400 font-medium">Output 1 — Yes / True</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-900/10 border border-red-800/30">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span className="text-xs text-red-400 font-medium">Output 2 — No / False</span>
            </div>
            <p className="text-[10px] text-secondary/50 pt-1">
              Drag from the bottom ports to connect each branch.
            </p>
          </div>
        )}

        {node.type === 'KEYWORD_ROUTER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                Match Keywords (comma-separated)
              </span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                placeholder="pay, bayar, order"
                value={(Array.isArray(node.config.keywords) ? node.config.keywords as string[] : []).join(', ')}
                onChange={(e) =>
                  update({ keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
              />
            </label>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-green-900/10 border border-green-800/30">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-green-400 font-medium">Output 1 — Keyword matched</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/60 border border-slate-700/30">
              <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
              <span className="text-xs text-secondary font-medium">Output 2 — No match</span>
            </div>
          </div>
        )}

        {node.type === 'TAG_BUYER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Action</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={String(node.config.action ?? 'add')}
                onChange={(e) => update({ action: e.target.value })}
              >
                <option value="add">Add tag</option>
                <option value="remove">Remove tag</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">Tag name</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="vip_customer"
                value={String(node.config.tag ?? '')}
                onChange={(e) => update({ tag: e.target.value })}
              />
            </label>
          </div>
        )}

        {node.type === 'UPDATE_BUYER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Field to update</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={String(node.config.field ?? 'displayName')}
                onChange={(e) => update({ field: e.target.value })}
              >
                <option value="displayName">Display Name</option>
                <option value="notes">Notes</option>
                <option value="preferredLanguage">Preferred Language</option>
              </select>
            </label>
            <MessageEditor
              label="New value"
              value={String(node.config.value ?? '')}
              onChange={(v) => update({ value: v })}
              placeholder="{{trigger.message}} or static text"
              rows={2}
              hint="Use a variable to copy a buyer's reply into this field."
            />
          </div>
        )}

        {node.type === 'SEGMENT_QUALITY_GATE' && (
          <div className="space-y-3">
            <div className="text-xs font-medium text-secondary mb-1">Pass criteria</div>
            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5">
              <input
                type="checkbox"
                checked={Boolean(node.config.requireOrders)}
                onChange={(e) => update({ requireOrders: e.target.checked })}
                className="w-4 h-4 rounded border-border text-accent"
              />
              <span className="text-sm text-secondary">Require ≥1 order</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5">
              <input
                type="checkbox"
                checked={Boolean(node.config.requireInboundHistory)}
                onChange={(e) => update({ requireInboundHistory: e.target.checked })}
                className="w-4 h-4 rounded border-border text-accent"
              />
              <span className="text-sm text-secondary">Require inbound message history</span>
            </label>
          </div>
        )}

        {node.type === 'START_SCHEDULING' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-sky-900/20 border border-sky-700/30 px-3 py-2 text-xs text-sky-300/80">
              Ends the flow and hands the buyer off to the scheduling system.
            </div>
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                Consultation Type <span className="text-secondary/40">(optional)</span>
              </span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="e.g. Skin Consultation, Product Demo"
                value={String(node.config.consultationType ?? '')}
                onChange={(e) => update({ consultationType: e.target.value })}
              />
            </label>
            <MessageEditor
              label="Intro message (optional)"
              value={String(node.config.introMessage ?? '')}
              onChange={(v) => update({ introMessage: v })}
              placeholder="Hi {{buyer.name}}! Let me help you book an appointment 📅"
              rows={3}
              hint="Sent to the buyer before the scheduling flow begins."
            />
            <label className="block">
              <span className="text-xs font-medium text-secondary">Assigned Staff for Confirmation</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={String(node.config.assignedStaffId ?? '')}
                onChange={(e) => update({ assignedStaffId: e.target.value || undefined })}
              >
                <option value="">— Auto-route to slot staff —</option>
                {(staffList ?? [])
                  .filter((s) => (s as { isActive?: boolean }).isActive !== false)
                  .map((s) => {
                    const staff = s as { id: string; name: string };
                    return (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    );
                  })}
              </select>
              <span className="text-[10px] text-secondary/50 mt-1 block">
                This staff member receives a WhatsApp confirmation request.
              </span>
            </label>
          </div>
        )}

        {node.type === 'ACTIVATE_PLAYBOOK' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-purple-900/20 border border-purple-700/30 px-3 py-2 text-xs text-purple-300/80">
              Ends the flow and activates a specific AI Playbook for the buyer's next conversation.
            </div>
            <label className="block">
              <span className="text-xs font-medium text-secondary">AI Playbook to activate</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={String(node.config.intentKey ?? '')}
                onChange={(e) => update({ intentKey: e.target.value })}
              >
                <option value="">— Select a playbook —</option>
                {(playbookList ?? [])
                  .filter((p) => (p as { isActive: boolean }).isActive)
                  .map((p) => {
                    const pb = p as { id: string; intentKey: IntentKey; label: string };
                    return (
                      <option key={pb.id} value={pb.intentKey}>
                        {INTENT_KEY_LABELS[pb.intentKey] ?? pb.intentKey} — {pb.label}
                      </option>
                    );
                  })}
              </select>
              <span className="text-[10px] text-secondary/50 mt-1 block">
                Only active playbooks are shown.
              </span>
            </label>
          </div>
        )}

        {node.type === 'END_FLOW' && (
          <label className="block">
            <span className="text-xs font-medium text-secondary">End reason (optional)</span>
            <input
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              placeholder="completed, opted_out…"
              value={String(node.config.reason ?? '')}
              onChange={(e) => update({ reason: e.target.value })}
            />
          </label>
        )}

        {node.type === 'NOTIFY_STAFF' && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Staff member</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={String(node.config.staffId ?? '')}
                onChange={(e) => update({ staffId: e.target.value || undefined })}
              >
                <option value="">— Select staff —</option>
                {(staffList ?? [])
                  .filter((s) => (s as { isActive?: boolean }).isActive !== false)
                  .map((s) => {
                    const staff = s as { id: string; name: string };
                    return (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    );
                  })}
              </select>
            </label>
            <MessageEditor
              label="Message"
              value={String(node.config.message ?? '')}
              onChange={(v) => update({ message: v })}
              placeholder="New inquiry from {{buyer.name}} — please follow up."
              rows={4}
              hint="Sent as a WhatsApp message to the selected staff member."
            />
          </div>
        )}

        {node.type === 'AGENT' && (
          <div className="space-y-4">
            <MessageEditor
              label="Instructions"
              value={String(node.config.instructions ?? '')}
              onChange={(v) => update({ instructions: v })}
              placeholder="You are a helpful sales assistant. Answer questions about our products and help the buyer place an order."
              rows={6}
              hint="These instructions guide the AI agent's behaviour."
            />
            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5">
              <input
                type="checkbox"
                checked={Boolean(node.config.memoryEnabled)}
                onChange={(e) => update({ memoryEnabled: e.target.checked })}
                className="w-4 h-4 rounded border-border text-accent"
              />
              <span className="text-sm text-secondary">Enable memory across sessions</span>
            </label>
            <MessageEditor
              label="Intro message (optional)"
              value={String(node.config.introMessage ?? '')}
              onChange={(v) => update({ introMessage: v })}
              placeholder="Hi {{buyer.name}}! How can I help you today?"
              rows={3}
              hint="Sent to the buyer when the agent takes over."
            />
            <div className="space-y-1">
              <div className="text-xs font-medium text-secondary mb-2">Action Exits</div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-indigo-900/10 border border-indigo-800/30">
                <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                <span className="text-xs text-indigo-300 font-medium">Exit 1 — action_0</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-indigo-900/10 border border-indigo-800/30">
                <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                <span className="text-xs text-indigo-300 font-medium">Exit 2 — action_1</span>
              </div>
              <p className="text-[10px] text-secondary/50 pt-1">
                Connect each exit to the next node in that action branch.
              </p>
            </div>
          </div>
        )}

        {node.type === 'COLLECT_INFO' && (
          <div className="space-y-4">
            <p className="text-xs text-secondary/70">
              Asks the buyer a series of questions one at a time. Answers are stored as{' '}
              <code className="bg-white/5 px-1 rounded">{'{{answers.variableName}}'}</code> variables
              and can be used in IF/ELSE branches downstream.
            </p>
            {/* Questions list */}
            {((node.config.questions as any[]) ?? []).map((q: any, qi: number) => (
              <div key={q.id ?? qi} className="p-3 bg-white/5 rounded-lg border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-secondary">Question {qi + 1}</span>
                  <button
                    onClick={() => {
                      const qs = [...((node.config.questions as any[]) ?? [])];
                      qs.splice(qi, 1);
                      update({ questions: qs });
                    }}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div>
                  <label className="text-[10px] text-secondary/60 mb-1 block">Prompt text</label>
                  <input
                    value={q.promptText ?? ''}
                    onChange={e => {
                      const qs = [...((node.config.questions as any[]) ?? [])];
                      qs[qi] = { ...qs[qi], promptText: e.target.value };
                      update({ questions: qs });
                    }}
                    placeholder="e.g. What is your name?"
                    className="w-full bg-[#0F172A] border border-border text-primary text-xs rounded px-2 py-1.5 focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-secondary/60 mb-1 block">Variable name (no spaces)</label>
                  <input
                    value={q.variableName ?? ''}
                    onChange={e => {
                      const qs = [...((node.config.questions as any[]) ?? [])];
                      qs[qi] = { ...qs[qi], variableName: e.target.value.replace(/\s+/g, '_') };
                      update({ questions: qs });
                    }}
                    placeholder="e.g. buyer_name"
                    className="w-full bg-[#0F172A] border border-border text-primary text-xs font-mono rounded px-2 py-1.5 focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-secondary/60 mb-1 block">Type</label>
                  <div className="flex gap-2">
                    {(['text', 'choice'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => {
                          const qs = [...((node.config.questions as any[]) ?? [])];
                          qs[qi] = { ...qs[qi], type: t };
                          update({ questions: qs });
                        }}
                        className={`flex-1 py-1 rounded border text-xs transition-all ${
                          q.type === t ? 'border-accent text-accent' : 'border-border text-secondary'
                        }`}
                      >
                        {t === 'text' ? 'Free text' : 'Choice buttons'}
                      </button>
                    ))}
                  </div>
                </div>
                {q.type === 'choice' && (
                  <div>
                    <label className="text-[10px] text-secondary/60 mb-1 block">Choices (one per line, max 3)</label>
                    <textarea
                      value={Array.isArray(q.choices) ? q.choices.join('\n') : ''}
                      onChange={e => {
                        const choices = e.target.value.split('\n').slice(0, 3);
                        const qs = [...((node.config.questions as any[]) ?? [])];
                        qs[qi] = { ...qs[qi], choices };
                        update({ questions: qs });
                      }}
                      rows={3}
                      className="w-full bg-[#0F172A] border border-border text-primary text-xs rounded px-2 py-1.5 focus:outline-none focus:border-accent resize-none"
                    />
                  </div>
                )}
              </div>
            ))}
            <button
              onClick={() => {
                const qs = [...((node.config.questions as any[]) ?? [])];
                qs.push({ id: `q${Date.now()}`, promptText: '', variableName: '', type: 'text', required: true });
                update({ questions: qs });
              }}
              className="w-full py-1.5 border border-dashed border-border text-secondary text-xs rounded-lg hover:border-accent/60 hover:text-accent/80 transition-colors"
            >
              + Add question
            </button>
            <div>
              <label className="text-xs text-secondary mb-1.5 block">On complete</label>
              <div className="flex gap-2">
                {(['continue', 'end'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => update({ onComplete: v })}
                    className={`flex-1 py-1.5 rounded border text-xs transition-all ${
                      (node.config.onComplete ?? 'continue') === v
                        ? 'border-accent text-accent'
                        : 'border-border text-secondary'
                    }`}
                  >
                    {v === 'continue' ? 'Continue flow' : 'End flow'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-900/10 border border-emerald-800/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-xs text-emerald-300 font-medium">Default exit — connect to next step</span>
            </div>
          </div>
        )}

        {(node.validationErrors?.length ?? 0) > 0 && (
          <div className="p-3 bg-red-900/20 border border-red-800/40 rounded-lg">
            <div className="text-xs font-semibold text-red-400 mb-1">Validation errors</div>
            {node.validationErrors!.map((err, i) => (
              <div key={i} className="text-xs text-red-300">• {err}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
