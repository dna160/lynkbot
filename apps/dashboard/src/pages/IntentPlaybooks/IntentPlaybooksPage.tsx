/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/IntentPlaybooks/IntentPlaybooksPage.tsx
 * Role    : Full CRUD page for Intent Playbooks — lets tenants configure per-intent
 *           AI behavior, system prompt injections, next-step types, and more.
 *           Follows the same card/modal pattern as FlowsListPage.tsx.
 * Exports : IntentPlaybooksPage
 * DO NOT  : Import from apps/api or packages/db directly
 */
import { useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import {
  useIntentPlaybooks,
  useCreatePlaybook,
  useUpdatePlaybook,
  useDeletePlaybook,
  useTogglePlaybook,
  type PlaybookRow,
  type IntentKey,
  type NextStepType,
  INTENT_KEY_LABELS,
  NEXT_STEP_LABELS,
} from '@/hooks/useIntentPlaybooks';
import { useStaff } from '@/hooks/useScheduling';

// ─── Constants ───────────────────────────────────────────────────────────────

const INTENT_KEYS: IntentKey[] = [
  'GREETING',
  'BROWSING',
  'PRODUCT_INQUIRY',
  'OBJECTION_HANDLING',
  'CHECKOUT_INTENT',
  'OUT_OF_STOCK',
  'SCHEDULING',
  'GENERAL_INQUIRY',
];

const NEXT_STEP_TYPES: NextStepType[] = [
  'continue_conversation',
  'checkout',
  'schedule_consultation',
  'human_handoff',
  'collect_info',
];

const NEXT_STEP_BADGE: Record<NextStepType, string> = {
  continue_conversation: 'bg-slate-700 text-slate-300',
  checkout: 'bg-green-900/40 text-green-400',
  schedule_consultation: 'bg-blue-900/40 text-blue-400',
  human_handoff: 'bg-orange-900/40 text-orange-400',
  collect_info: 'bg-purple-900/40 text-purple-400',
};

const INTENT_BADGE_COLOR: Record<IntentKey, string> = {
  GREETING: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40',
  BROWSING: 'bg-sky-900/30 text-sky-400 border-sky-800/40',
  PRODUCT_INQUIRY: 'bg-violet-900/30 text-violet-400 border-violet-800/40',
  OBJECTION_HANDLING: 'bg-red-900/30 text-red-400 border-red-800/40',
  CHECKOUT_INTENT: 'bg-green-900/30 text-green-400 border-green-800/40',
  OUT_OF_STOCK: 'bg-yellow-900/30 text-yellow-400 border-yellow-800/40',
  SCHEDULING: 'bg-cyan-900/30 text-cyan-400 border-cyan-800/40',
  GENERAL_INQUIRY: 'bg-slate-700/50 text-slate-300 border-slate-600/40',
};

// ─── Blank form state ─────────────────────────────────────────────────────────

function blankForm(): Partial<PlaybookRow> {
  return {
    intentKey: 'GENERAL_INQUIRY',
    label: '',
    description: null,
    isActive: true,
    priority: 0,
    systemPromptAddition: '',
    toneNote: null,
    nextStepType: 'continue_conversation',
    nextStepConfig: null,
    detectionKeywords: null,
    fallbackMessage: null,
  };
}

// ─── Editor Modal ─────────────────────────────────────────────────────────────

interface EditorModalProps {
  initial: Partial<PlaybookRow>;
  onSave: (data: Partial<PlaybookRow>) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  mode: 'create' | 'edit';
}

function EditorModal({ initial, onSave, onClose, saving, mode }: EditorModalProps) {
  const [form, setForm] = useState<Partial<PlaybookRow>>(initial);
  const [keywordsRaw, setKeywordsRaw] = useState<string>(
    (initial.detectionKeywords ?? []).join(', '),
  );
  const { data: staffList } = useStaff();

  const set = <K extends keyof PlaybookRow>(k: K, v: PlaybookRow[K] | null) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    const keywords = keywordsRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    await onSave({ ...form, detectionKeywords: keywords.length ? keywords : null });
  };

  const nst = form.nextStepType ?? 'continue_conversation';
  const cfg = (form.nextStepConfig ?? {}) as Record<string, string>;
  const setCfg = (key: string, val: string) =>
    set('nextStepConfig', { ...cfg, [key]: val } as Record<string, unknown>);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-[#141414] border border-border rounded-2xl w-full max-w-2xl shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-primary">
            {mode === 'create' ? 'New AI Playbook' : 'Edit AI Playbook'}
          </h2>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Intent Key + Label row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Intent</label>
              <select
                value={form.intentKey ?? 'GENERAL_INQUIRY'}
                onChange={e => set('intentKey', e.target.value as IntentKey)}
                className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent"
              >
                {INTENT_KEYS.map(k => (
                  <option key={k} value={k}>{INTENT_KEY_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Label</label>
              <input
                type="text"
                value={form.label ?? ''}
                onChange={e => set('label', e.target.value)}
                placeholder="e.g. Warm Greeting Handler"
                className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent placeholder-secondary/40"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Description <span className="text-secondary/50">(optional)</span></label>
            <textarea
              value={form.description ?? ''}
              onChange={e => set('description', e.target.value || null)}
              rows={2}
              placeholder="Brief note about what this playbook does"
              className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent placeholder-secondary/40 resize-none"
            />
          </div>

          {/* System Prompt Addition — main field */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">
              System Prompt Injection
            </label>
            <p className="text-xs text-secondary/60 mb-1.5">
              This text is injected directly into the AI's system prompt when this intent is active. Be specific and directive.
            </p>
            <textarea
              value={form.systemPromptAddition ?? ''}
              onChange={e => set('systemPromptAddition', e.target.value)}
              rows={6}
              placeholder={`e.g. The buyer is actively browsing products. Your goal is to highlight key benefits and gently guide them toward adding an item to their cart. Ask clarifying questions about their needs. Do not push hard — stay friendly and consultative.`}
              className="w-full bg-surface border border-accent/30 text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent placeholder-secondary/30 resize-y font-mono"
            />
          </div>

          {/* Tone Note */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Tone Note <span className="text-secondary/50">(optional)</span></label>
            <input
              type="text"
              value={form.toneNote ?? ''}
              onChange={e => set('toneNote', e.target.value || null)}
              placeholder="e.g. Warm and encouraging. Use emoji sparingly."
              className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent placeholder-secondary/40"
            />
          </div>

          {/* Next Step Type */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Next Step Direction</label>
            <select
              value={nst}
              onChange={e => set('nextStepType', e.target.value as NextStepType)}
              className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent"
            >
              {NEXT_STEP_TYPES.map(t => (
                <option key={t} value={t}>{NEXT_STEP_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {/* Conditional next step config */}
          {nst === 'continue_conversation' && (
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-4 py-3">
              <p className="text-xs text-secondary/70">The AI will continue the conversation naturally without any specific next-step direction.</p>
            </div>
          )}

          {nst === 'checkout' && (
            <div className="bg-green-900/20 border border-green-800/30 rounded-lg px-4 py-3">
              <p className="text-xs text-green-400/80">The AI will naturally guide the buyer toward purchase. If buyer shows clear intent, the AI will transition toward the checkout flow.</p>
            </div>
          )}

          {nst === 'schedule_consultation' && (
            <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg p-4 space-y-4">
              <p className="text-xs text-blue-400/80 font-semibold uppercase tracking-wide">Scheduling Config</p>

              <div>
                <label className="block text-xs text-secondary mb-1">Consultation Type</label>
                <input
                  type="text"
                  value={cfg.consultationType ?? ''}
                  onChange={e => setCfg('consultationType', e.target.value)}
                  placeholder="e.g. Skin consultation, Product demo"
                  className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent placeholder-secondary/40"
                />
              </div>

              <div>
                <label className="block text-xs text-secondary mb-1">Call-to-action text <span className="text-secondary/50">(optional)</span></label>
                <input
                  type="text"
                  value={cfg.cta ?? ''}
                  onChange={e => setCfg('cta', e.target.value)}
                  placeholder='e.g. "Reply SCHEDULE to book a free demo"'
                  className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent placeholder-secondary/40"
                />
              </div>

              <div className="border-t border-blue-800/30 pt-3 space-y-3">
                <p className="text-xs text-blue-300/70 font-medium">Staff confirmation</p>
                <p className="text-xs text-secondary/60">
                  When a buyer books, this staff member receives a WhatsApp notification and must reply <span className="font-mono bg-slate-700 px-1 rounded">CONFIRM</span> to finalise the appointment.
                </p>

                <div>
                  <label className="block text-xs text-secondary mb-1">Assigned Staff <span className="text-secondary/50">(required for confirmation flow)</span></label>
                  <select
                    value={cfg.assignedStaffId ?? ''}
                    onChange={e => setCfg('assignedStaffId', e.target.value)}
                    className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
                  >
                    <option value="">— No staff assigned (auto-route to slot staff) —</option>
                    {(staffList ?? []).filter(s => (s as any).isActive !== false).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {cfg.assignedStaffId && (
                  <div className="rounded-lg bg-blue-900/30 border border-blue-700/30 px-3 py-2 text-xs text-blue-300/80 space-y-1">
                    <p>✓ All bookings from this playbook will notify <strong>{staffList?.find(s => s.id === cfg.assignedStaffId)?.name ?? 'selected staff'}</strong></p>
                    <p>✓ Staff types <span className="font-mono bg-slate-700 px-1 rounded">CONFIRM</span> to approve, or any rejection word to decline</p>
                    <p>✓ Buyer can request a new time — staff will be re-notified for approval</p>
                    <p>✓ Rescheduling deletes the old appointment and creates a new one</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {nst === 'human_handoff' && (
            <div className="bg-orange-900/20 border border-orange-800/30 rounded-lg p-4">
              <label className="block text-xs text-orange-400/80 font-medium mb-2">Custom handoff message</label>
              <input
                type="text"
                value={cfg.handoffMessage ?? ''}
                onChange={e => setCfg('handoffMessage', e.target.value)}
                placeholder='e.g. "Would you like to speak with one of our specialists?"'
                className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent placeholder-secondary/40"
              />
            </div>
          )}

          {nst === 'collect_info' && (
            <div className="bg-purple-900/20 border border-purple-800/30 rounded-lg p-4">
              <label className="block text-xs text-purple-400/80 font-medium mb-2">Information to collect</label>
              <textarea
                value={cfg.infoToCollect ?? ''}
                onChange={e => setCfg('infoToCollect', e.target.value)}
                rows={3}
                placeholder="e.g. name, shipping address, preferred delivery date"
                className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent placeholder-secondary/40 resize-none"
              />
            </div>
          )}

          {/* Detection Keywords */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Detection Keywords <span className="text-secondary/50">(optional, comma-separated)</span></label>
            <input
              type="text"
              value={keywordsRaw}
              onChange={e => setKeywordsRaw(e.target.value)}
              placeholder="e.g. harga, berapa, murah, diskon"
              className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent placeholder-secondary/40"
            />
            {keywordsRaw.trim() && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {keywordsRaw.split(',').map(k => k.trim()).filter(Boolean).map(kw => (
                  <span key={kw} className="inline-flex items-center px-2 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded-full text-xs">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Fallback Message */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Fallback Message <span className="text-secondary/50">(shown if AI fails entirely)</span></label>
            <input
              type="text"
              value={form.fallbackMessage ?? ''}
              onChange={e => set('fallbackMessage', e.target.value || null)}
              placeholder="e.g. Maaf, ada gangguan sebentar. Bisa coba lagi?"
              className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent placeholder-secondary/40"
            />
          </div>

          {/* Priority + Active row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Priority <span className="text-secondary/50">(higher = preferred)</span></label>
              <input
                type="number"
                value={form.priority ?? 0}
                onChange={e => set('priority', parseInt(e.target.value, 10) || 0)}
                className="w-full bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div
                  onClick={() => set('isActive', !form.isActive)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-accent' : 'bg-slate-700'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
                <span className="text-sm text-primary">{form.isActive ? 'Active' : 'Inactive'}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm border border-border text-secondary rounded-lg hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.label || !form.intentKey}
            className="px-5 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {mode === 'create' ? 'Create Playbook' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Playbook Card ────────────────────────────────────────────────────────────

interface PlaybookCardProps {
  playbook: PlaybookRow;
  onEdit: (p: PlaybookRow) => void;
  onDelete: (p: PlaybookRow) => void;
  onToggle: (id: string) => void;
  toggling: boolean;
}

function PlaybookCard({ playbook, onEdit, onDelete, onToggle, toggling }: PlaybookCardProps) {
  const previewText = playbook.systemPromptAddition
    ? playbook.systemPromptAddition.slice(0, 120) + (playbook.systemPromptAddition.length > 120 ? '…' : '')
    : null;

  return (
    <div className={`bg-surface border rounded-xl p-5 transition-all ${playbook.isActive ? 'border-border hover:border-accent/30' : 'border-border/50 opacity-60'}`}>
      {/* Card top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${INTENT_BADGE_COLOR[playbook.intentKey]}`}>
              {INTENT_KEY_LABELS[playbook.intentKey]}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${NEXT_STEP_BADGE[playbook.nextStepType]}`}>
              {NEXT_STEP_LABELS[playbook.nextStepType]}
            </span>
            {playbook.priority > 0 && (
              <span className="text-xs text-secondary/60">P{playbook.priority}</span>
            )}
          </div>
          <h3 className="font-semibold text-primary text-sm truncate">{playbook.label}</h3>
          {playbook.description && (
            <p className="text-xs text-secondary mt-0.5 line-clamp-1">{playbook.description}</p>
          )}
        </div>

        {/* Toggle */}
        <button
          onClick={() => onToggle(playbook.id)}
          disabled={toggling}
          className="flex-shrink-0"
          title={playbook.isActive ? 'Deactivate' : 'Activate'}
        >
          <div className={`relative w-9 h-5 rounded-full transition-colors ${playbook.isActive ? 'bg-accent' : 'bg-slate-700'} ${toggling ? 'opacity-50' : ''}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${playbook.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
        </button>
      </div>

      {/* Prompt preview */}
      {previewText ? (
        <div className="bg-black/20 border border-white/5 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-secondary/70 font-mono leading-relaxed">{previewText}</p>
        </div>
      ) : (
        <div className="bg-black/10 border border-dashed border-border/40 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-secondary/40 italic">No system prompt addition set</p>
        </div>
      )}

      {/* Keywords preview */}
      {playbook.detectionKeywords && playbook.detectionKeywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {playbook.detectionKeywords.slice(0, 6).map(kw => (
            <span key={kw} className="inline-flex items-center px-1.5 py-0.5 bg-accent/10 text-accent/70 border border-accent/20 rounded text-xs">
              {kw}
            </span>
          ))}
          {playbook.detectionKeywords.length > 6 && (
            <span className="text-xs text-secondary/50">+{playbook.detectionKeywords.length - 6} more</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={() => onEdit(playbook)}
          className="text-xs text-accent hover:underline"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(playbook)}
          className="text-xs text-red-400 hover:underline"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function IntentPlaybooksPage() {
  const { addToast } = useToast();
  const { data: playbooks, isLoading } = useIntentPlaybooks();
  const createMutation = useCreatePlaybook();
  const updateMutation = useUpdatePlaybook();
  const deleteMutation = useDeletePlaybook();
  const toggleMutation = useTogglePlaybook();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<PlaybookRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setModalMode('create');
  };

  const openEdit = (p: PlaybookRow) => {
    setEditTarget(p);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditTarget(null);
  };

  const handleSave = async (data: Partial<PlaybookRow>) => {
    try {
      if (modalMode === 'create') {
        await createMutation.mutateAsync(data);
        addToast('Playbook created', 'success');
      } else if (modalMode === 'edit' && editTarget) {
        await updateMutation.mutateAsync({ id: editTarget.id, ...data });
        addToast('Playbook updated', 'success');
      }
      closeModal();
    } catch {
      addToast('Failed to save playbook', 'error');
    }
  };

  const handleDelete = async (p: PlaybookRow) => {
    if (!confirm(`Delete playbook "${p.label}"? This cannot be undone.`)) return;
    try {
      await deleteMutation.mutateAsync(p.id);
      addToast('Playbook deleted', 'success');
    } catch {
      addToast('Failed to delete playbook', 'error');
    }
  };

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    try {
      await toggleMutation.mutateAsync(id);
    } catch {
      addToast('Failed to toggle playbook', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const total = playbooks?.length ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">AI Playbooks</h1>
          <p className="text-sm text-secondary mt-0.5">
            Configure per-intent AI behavior — system prompt injections, tone notes, and next-step directions.
            {total > 0 && ` ${total} playbook${total !== 1 ? 's' : ''} configured.`}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Playbook
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-accent/5 border border-accent/20 rounded-xl px-5 py-4 flex gap-3">
        <svg className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm text-primary font-medium">How Playbooks Work</p>
          <p className="text-xs text-secondary mt-0.5">
            When a buyer's conversation enters a specific intent state (e.g. <span className="text-accent/80">BROWSING</span>, <span className="text-accent/80">CHECKOUT_INTENT</span>), the matching playbook's system prompt addition is injected into the AI — customizing how it responds. <span className="text-accent/80">GENERAL_INQUIRY</span> acts as the fallback for unmatched states.
          </p>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !playbooks || playbooks.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl text-center py-16">
          <svg className="w-12 h-12 text-secondary/30 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p className="text-secondary font-medium">No playbooks yet</p>
          <p className="text-secondary/60 text-sm mt-1">Create your first playbook to customize the AI's behavior per intent</p>
          <button
            onClick={openCreate}
            className="mt-4 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors"
          >
            Create Playbook
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {playbooks.map(p => (
            <PlaybookCard
              key={p.id}
              playbook={p}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              toggling={togglingId === p.id}
            />
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {modalMode && (
        <EditorModal
          mode={modalMode}
          initial={editTarget ? { ...editTarget } : blankForm()}
          onSave={handleSave}
          onClose={closeModal}
          saving={isSaving}
        />
      )}
    </div>
  );
}
