/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/AutomationWizardPage.tsx
 * Role    : 5-step automation wizard — replaces ScenarioBuilderPage (v3 Phase 4)
 *           Generates valid FlowDefinition objects with engine-compliant node types.
 *           NEVER generates TRIGGER or AGENT nodes (they silently fail in engine).
 *           All trigger nodes are typed: TRIGGER_INBOUND_KEYWORD, TRIGGER_ORDER_EVENT.
 * Route   : /dashboard/automations/new  (no :templateId needed)
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ToastProvider';
import {
  buildFlowDefinition,
  buildApiTriggerType,
  type WizardState,
  type CollectInfoQuestion,
  type OrderEventType,
} from './buildFlowDefinition';

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  'w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50';
const textareaCls = `${inputCls} resize-none`;
const labelCls = 'block text-xs font-medium text-secondary mb-1';
const sectionCls = 'rounded-lg border border-border bg-white/[0.02] p-4 space-y-3';

// ── Default wizard state ───────────────────────────────────────────────────────

function defaultState(): WizardState {
  return {
    name: '',
    purpose: 'qualify',
    triggerType: 'inbound_keyword',
    keywords: ['hello', 'hi'],
    orderEvent: 'payment_confirmed',
    timeSinceEvent: undefined,
    qualifyingQuestions: { enabled: false, questions: [] },
    qualify: { outcomeMessage: "Thanks! We'll be in touch soon 😊" },
    scheduling: {
      confirmationModel: 'staff_confirm',
      introMessage: 'Let me help you book an appointment.',
      consultationType: 'Consultation',
    },
    followup: { message: '', delayMs: 0 },
  };
}

// ── Step labels ────────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Purpose', icon: '🎯' },
  { label: 'Trigger', icon: '⚡' },
  { label: 'Questions', icon: '💬' },
  { label: 'Action', icon: '🔧' },
  { label: 'Review', icon: '✅' },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function AutomationWizardPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(defaultState());
  const [isLoading, setIsLoading] = useState(false);

  const update = (patch: Partial<WizardState>) => setState(prev => ({ ...prev, ...patch }));

  // ── Step 1: Purpose ──────────────────────────────────────────────────────────

  const PurposeStep = () => (
    <div className="space-y-3">
      <p className="text-sm text-secondary">What should this automation do?</p>
      {(
        [
          { value: 'qualify', icon: '👤', label: 'Qualify Leads', desc: 'Ask buyers a series of questions, then route to an outcome or human.' },
          { value: 'scheduling', icon: '📅', label: 'Book Appointments', desc: 'Guide buyers through booking a time slot with your team.' },
          { value: 'followup', icon: '📦', label: 'Follow Up After Event', desc: 'Send an automatic message when an order is placed, shipped, or delivered.' },
        ] as const
      ).map(opt => (
        <button
          key={opt.value}
          onClick={() => update({ purpose: opt.value })}
          className={`w-full text-left rounded-lg border p-4 transition-colors ${
            state.purpose === opt.value
              ? 'border-accent bg-accent/10'
              : 'border-border hover:border-border/80 hover:bg-white/[0.02]'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{opt.icon}</span>
            <div>
              <p className="text-sm font-semibold text-primary">{opt.label}</p>
              <p className="text-xs text-secondary">{opt.desc}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );

  // ── Step 2: Trigger ──────────────────────────────────────────────────────────

  const TriggerStep = () => {
    const showKeyword = state.purpose !== 'followup';
    const showOrderEvent = state.purpose === 'followup';

    return (
      <div className="space-y-4">
        {showKeyword && (
          <div className={sectionCls}>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">⚡ Trigger Keywords</p>
            <p className="text-xs text-secondary">The automation starts when a buyer sends any of these words.</p>
            <label className={labelCls}>Keywords (comma-separated)</label>
            <input
              type="text"
              className={inputCls}
              value={state.keywords.join(', ')}
              onChange={e => update({ keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean), triggerType: 'inbound_keyword' })}
              placeholder="e.g. book, appointment, jadwal"
            />
          </div>
        )}

        {showOrderEvent && (
          <div className={sectionCls}>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">📦 Order Event</p>
            <p className="text-xs text-secondary">The automation fires automatically when this event occurs.</p>
            <label className={labelCls}>Event</label>
            <select
              className={inputCls}
              value={state.orderEvent ?? 'payment_confirmed'}
              onChange={e => update({ orderEvent: e.target.value as OrderEventType, triggerType: 'order_event' })}
            >
              <option value="payment_confirmed">💳 Payment confirmed</option>
              <option value="shipped">📦 Order shipped</option>
              <option value="delivered">✅ Order delivered</option>
              <option value="payment_failed">⚠️ Payment failed / expired</option>
            </select>
          </div>
        )}
      </div>
    );
  };

  // ── Step 3: Qualifying Questions ─────────────────────────────────────────────

  const QuestionsStep = () => {
    const { enabled, questions } = state.qualifyingQuestions;

    const addQuestion = () => {
      const newQ: CollectInfoQuestion = {
        id: `q${Date.now()}`,
        promptText: '',
        variableName: `answer_${questions.length + 1}`,
        type: 'text',
        required: true,
      };
      update({ qualifyingQuestions: { enabled, questions: [...questions, newQ] } });
    };

    const removeQuestion = (idx: number) => {
      const updated = questions.filter((_, i) => i !== idx);
      update({ qualifyingQuestions: { enabled, questions: updated } });
    };

    const updateQuestion = (idx: number, patch: Partial<CollectInfoQuestion>) => {
      const updated = questions.map((q, i) => i === idx ? { ...q, ...patch } : q);
      update({ qualifyingQuestions: { enabled, questions: updated } });
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-secondary">Ask buyers qualifying questions before the main action?</p>
          <button
            onClick={() => update({ qualifyingQuestions: { enabled: !enabled, questions } })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-white/20'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {enabled && (
          <div className="space-y-3">
            {questions.map((q, idx) => (
              <div key={q.id} className={`${sectionCls} relative`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-secondary">Question {idx + 1}</span>
                  <button
                    onClick={() => removeQuestion(idx)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <label className={labelCls}>Question text</label>
                <input
                  type="text"
                  className={inputCls}
                  value={q.promptText}
                  onChange={e => updateQuestion(idx, { promptText: e.target.value })}
                  placeholder="e.g. What's your name?"
                />
                <label className={labelCls}>Variable name (used in later messages)</label>
                <input
                  type="text"
                  className={inputCls}
                  value={q.variableName}
                  onChange={e => updateQuestion(idx, { variableName: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                  placeholder="e.g. buyer_name"
                />
              </div>
            ))}

            {questions.length < 5 && (
              <button
                onClick={addQuestion}
                className="w-full border border-dashed border-border rounded-lg p-3 text-xs text-secondary hover:border-accent hover:text-accent transition-colors"
              >
                + Add question
              </button>
            )}
            {questions.length >= 5 && (
              <p className="text-[10px] text-secondary/50 text-center">Maximum 5 questions reached.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Step 4: Main Action ───────────────────────────────────────────────────────

  const ActionStep = () => {
    if (state.purpose === 'qualify') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-secondary">What should the bot send after collecting all answers?</p>
          <label className={labelCls}>Outcome message</label>
          <textarea
            rows={4}
            className={textareaCls}
            value={state.qualify.outcomeMessage}
            onChange={e => update({ qualify: { outcomeMessage: e.target.value } })}
            placeholder="e.g. Thanks for sharing! Our team will reach out within 24 hours 🙏"
          />
          <p className="text-[10px] text-secondary/50">
            You can reference collected answers using {'{{answers.variableName}}'}.
          </p>
        </div>
      );
    }

    if (state.purpose === 'scheduling') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-secondary">Configure the booking flow.</p>
          <label className={labelCls}>Intro message</label>
          <textarea
            rows={2}
            className={textareaCls}
            value={state.scheduling.introMessage ?? ''}
            onChange={e => update({ scheduling: { ...state.scheduling, introMessage: e.target.value } })}
            placeholder="e.g. Let me help you book an appointment 📅"
          />
          <label className={labelCls}>Service type label</label>
          <input
            type="text"
            className={inputCls}
            value={state.scheduling.consultationType ?? ''}
            onChange={e => update({ scheduling: { ...state.scheduling, consultationType: e.target.value } })}
            placeholder="e.g. Consultation, Haircut, Doctor Visit"
          />
          <label className={labelCls}>Confirmation model</label>
          <div className="space-y-2 mt-1">
            {(
              [
                { value: 'staff_confirm', label: 'Staff must confirm (recommended)', desc: 'Staff approves before buyer is notified' },
                { value: 'instant', label: 'Instant booking', desc: 'Auto-confirm, notify staff after' },
              ] as const
            ).map(opt => (
              <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="confirmationModel"
                  value={opt.value}
                  checked={(state.scheduling.confirmationModel ?? 'staff_confirm') === opt.value}
                  onChange={() => update({ scheduling: { ...state.scheduling, confirmationModel: opt.value } })}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm text-primary">{opt.label}</span>
                  <span className="block text-xs text-secondary">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      );
    }

    if (state.purpose === 'followup') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-secondary">What message should be sent when the event fires?</p>
          <label className={labelCls}>Message</label>
          <textarea
            rows={4}
            className={textareaCls}
            value={state.followup.message ?? ''}
            onChange={e => update({ followup: { ...state.followup, message: e.target.value } })}
            placeholder="e.g. ✅ Pembayaran diterima! Pesanan kamu sedang diproses 🎉"
          />
          <label className={labelCls}>Optional delay before sending (minutes, 0 = immediate)</label>
          <input
            type="number"
            min={0}
            className={inputCls}
            value={state.followup.delayMs ? Math.round(state.followup.delayMs / 60000) : 0}
            onChange={e => update({ followup: { ...state.followup, delayMs: Number(e.target.value) * 60000 } })}
          />
        </div>
      );
    }

    return null;
  };

  // ── Step 5: Review ────────────────────────────────────────────────────────────

  const ReviewStep = () => {
    const triggerSummary =
      state.triggerType === 'inbound_keyword'
        ? `Keyword: "${state.keywords.join(', ')}"`
        : state.triggerType === 'order_event'
        ? `Order event: ${state.orderEvent}`
        : `Time-based trigger`;

    const purposeSummary =
      state.purpose === 'qualify' ? 'Qualify leads'
        : state.purpose === 'scheduling' ? 'Book appointment'
        : 'Follow up after event';

    const questionsSummary =
      state.qualifyingQuestions.enabled && state.qualifyingQuestions.questions.length > 0
        ? `${state.qualifyingQuestions.questions.length} qualifying question(s)`
        : 'No qualifying questions';

    return (
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Flow name *</label>
          <input
            type="text"
            className={inputCls}
            value={state.name}
            onChange={e => update({ name: e.target.value })}
            placeholder="e.g. Lead qualification flow"
          />
        </div>
        <div className={sectionCls}>
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Summary</p>
          <div className="space-y-1 text-sm text-secondary">
            <p>🎯 Purpose: <span className="text-primary">{purposeSummary}</span></p>
            <p>⚡ Trigger: <span className="text-primary">{triggerSummary}</span></p>
            <p>💬 Questions: <span className="text-primary">{questionsSummary}</span></p>
          </div>
        </div>
        <p className="text-[10px] text-secondary/50">
          Review and save. You can edit this flow in the canvas editor after saving.
        </p>
      </div>
    );
  };

  // ── Submit ────────────────────────────────────────────────────────────────────

  const handleSave = async (activate: boolean) => {
    if (!state.name.trim()) {
      addToast('Please enter a flow name', 'error');
      return;
    }
    if (state.triggerType === 'inbound_keyword' && state.keywords.length === 0) {
      addToast('Please enter at least one keyword', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const definition = buildFlowDefinition(state);
      const triggerType = buildApiTriggerType(state);
      const triggerConfig = definition.triggerConfig ?? {};

      const { flowsApi } = await import('@/lib/api');
      const res = await flowsApi.create({
        name: state.name.trim(),
        definition,
        triggerType,
        triggerConfig,
      });

      if (activate && res.data?.id) {
        await flowsApi.updateStatus(res.data.id, 'active');
      }

      addToast(activate ? 'Flow activated!' : 'Flow saved as draft', 'success');
      navigate('/dashboard/automations');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Failed to save flow';
      addToast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const stepComponents = [PurposeStep, TriggerStep, QuestionsStep, ActionStep, ReviewStep];
  const CurrentStep = stepComponents[step];

  return (
    <div className="min-h-screen bg-background p-6 flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-2xl mb-6">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate('/dashboard/automations')}
            className="text-secondary hover:text-primary text-sm transition-colors"
          >
            ← Back to automations
          </button>
        </div>
        <h1 className="text-xl font-bold text-primary">New Automation</h1>
        <p className="text-sm text-secondary mt-1">Set up an automated WhatsApp flow in a few steps.</p>
      </div>

      {/* Step progress */}
      <div className="w-full max-w-2xl flex items-center gap-1 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => i < step && setStep(i)}
              className={`flex items-center gap-2 text-xs font-medium transition-colors ${
                i === step
                  ? 'text-accent'
                  : i < step
                  ? 'text-primary/60 hover:text-primary cursor-pointer'
                  : 'text-secondary/30 cursor-default'
              }`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border ${
                i === step
                  ? 'border-accent bg-accent/20 text-accent'
                  : i < step
                  ? 'border-primary/30 bg-white/10 text-primary/60'
                  : 'border-border/30 text-secondary/30'
              }`}>
                {i < step ? '✓' : (i + 1)}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-primary/30' : 'bg-border/30'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step panel */}
      <div className="w-full max-w-2xl bg-surface border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="text-xl">{STEPS[step].icon}</span>
          <h2 className="text-base font-semibold text-primary">
            Step {step + 1}: {STEPS[step].label}
          </h2>
        </div>

        {CurrentStep && <CurrentStep />}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0 || isLoading}
            className="px-4 py-2 text-sm text-secondary hover:text-primary disabled:opacity-30 transition-colors"
          >
            ← Back
          </button>

          <div className="flex gap-2">
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                className="px-5 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
              >
                Continue →
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleSave(false)}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm text-secondary border border-border rounded-lg hover:border-primary/50 hover:text-primary disabled:opacity-50 transition-colors"
                >
                  Save Draft
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={isLoading}
                  className="px-5 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {isLoading ? 'Saving…' : 'Activate →'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
