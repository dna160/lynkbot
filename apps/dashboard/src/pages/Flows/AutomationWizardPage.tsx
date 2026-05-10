/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/AutomationWizardPage.tsx
 * Role    : 4-step automation wizard — purpose + trigger + configure + launch.
 *           Primary CTA is always "Launch" (active). Draft is secondary.
 *           Purpose auto-determines trigger type so there is no ambiguous
 *           "choose your trigger" step for non-followup automations.
 * Route   : /dashboard/automations/new
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

// ── Styles ────────────────────────────────────────────────────────────────────

const inp = 'w-full mt-1 px-3 py-2 bg-[#0F172A] border border-[#334155] text-white text-sm rounded-lg focus:outline-none focus:border-indigo-500 disabled:opacity-50';
const ta  = `${inp} resize-none`;
const lbl = 'block text-xs font-medium text-slate-400 mb-0.5';
const card = 'rounded-xl border border-[#334155] bg-[#0F172A]/60 p-4';

// ── Default state ─────────────────────────────────────────────────────────────

function defaultState(): WizardState {
  return {
    name: '',
    purpose: 'qualify',
    triggerType: 'inbound_keyword',
    keywords: ['halo', 'hi', 'hello'],
    orderEvent: 'payment_confirmed',
    timeSinceEvent: undefined,
    qualifyingQuestions: { enabled: false, questions: [] },
    qualify: { outcomeMessage: "Terima kasih! Tim kami akan segera menghubungi kamu 🙏" },
    scheduling: {
      confirmationModel: 'staff_confirm',
      introMessage: 'Aku bantu kamu buat booking ya! 📅',
      consultationType: 'Consultation',
    },
    followup: { message: '', delayMs: 0 },
  };
}

// ── Step config ───────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Purpose', icon: '🎯' },
  { label: 'Trigger', icon: '⚡' },
  { label: 'Configure', icon: '🔧' },
  { label: 'Launch', icon: '🚀' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AutomationWizardPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(defaultState());
  const [isLoading, setIsLoading] = useState(false);
  const [launched, setLaunched] = useState<{ id: string; name: string } | null>(null);

  const update = (patch: Partial<WizardState>) =>
    setState(prev => ({ ...prev, ...patch }));

  // When purpose changes, auto-set triggerType to its natural default
  const setPurpose = (p: WizardState['purpose']) => {
    const triggerType: WizardState['triggerType'] =
      p === 'followup' ? 'order_event' : 'inbound_keyword';
    update({ purpose: p, triggerType });
  };

  // ── Step 1: Purpose + Name ───────────────────────────────────────────────────

  const PurposeStep = () => (
    <div className="space-y-5">
      <div>
        <label className={lbl}>Automation name *</label>
        <input
          type="text"
          className={inp}
          value={state.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="e.g. Booking Automation, Post-Payment Follow Up"
          autoFocus
        />
      </div>

      <div>
        <p className={lbl}>What should this automation do?</p>
        <div className="space-y-2 mt-1">
          {(
            [
              {
                value: 'qualify' as const,
                icon: '👤',
                label: 'Qualify Leads',
                desc: 'Ask buyers a few questions, then send a closing message or route to staff.',
                trigger: 'Starts when buyer types a keyword',
              },
              {
                value: 'scheduling' as const,
                icon: '📅',
                label: 'Book Appointments',
                desc: 'Guide buyers through booking a time slot with your team.',
                trigger: 'Starts when buyer types a keyword',
              },
              {
                value: 'followup' as const,
                icon: '📦',
                label: 'Follow Up After Order',
                desc: 'Auto-send a message when an order is placed, shipped, or delivered.',
                trigger: 'Starts automatically on an order event',
              },
            ]
          ).map(opt => (
            <button
              key={opt.value}
              onClick={() => setPurpose(opt.value)}
              className={`w-full text-left rounded-xl border p-4 transition-all ${
                state.purpose === opt.value
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-[#334155] hover:border-[#475569] hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{opt.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{opt.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{opt.desc}</p>
                  <p className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1">
                    <span className="text-slate-600">⚡</span> {opt.trigger}
                  </p>
                </div>
                {state.purpose === opt.value && (
                  <span className="text-indigo-400 text-sm mt-0.5 flex-shrink-0">✓</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Step 2: Trigger config ────────────────────────────────────────────────────

  const TriggerStep = () => {
    if (state.purpose === 'followup') {
      return (
        <div className="space-y-4">
          <div className={card}>
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1">📦 Order Event Trigger</p>
            <p className="text-xs text-slate-400 mb-3">
              This automation fires automatically — no keyword needed. Choose which order lifecycle event starts it.
            </p>
            <label className={lbl}>When does this fire?</label>
            <select
              className={inp}
              value={state.orderEvent ?? 'payment_confirmed'}
              onChange={e => update({ orderEvent: e.target.value as OrderEventType, triggerType: 'order_event' })}
            >
              <option value="payment_confirmed">💳 Payment confirmed — buyer just paid</option>
              <option value="shipped">📦 Order shipped — tracking number assigned</option>
              <option value="delivered">✅ Order delivered — courier confirms delivery</option>
              <option value="payment_failed">⚠️ Payment failed or expired</option>
            </select>
          </div>

          <div className={`${card} border-amber-800/40 bg-amber-900/10`}>
            <p className="text-xs text-amber-400/80">
              <span className="font-medium">⚙️ How it works:</span> When the selected event fires for any buyer,
              this automation sends them a message automatically. No action required from staff.
            </p>
          </div>
        </div>
      );
    }

    // Keyword trigger (qualify + scheduling)
    const keywordList = state.keywords.filter(Boolean);

    const removeKeyword = (kw: string) =>
      update({ keywords: state.keywords.filter(k => k !== kw) });

    const handleKeyInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = (e.currentTarget.value ?? '').trim().toLowerCase();
        if (val && !state.keywords.includes(val)) {
          update({ keywords: [...state.keywords, val] });
        }
        e.currentTarget.value = '';
      }
    };

    return (
      <div className="space-y-4">
        <div className={card}>
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1">⚡ Keyword Trigger</p>
          <p className="text-xs text-slate-400 mb-3">
            The automation starts when a buyer sends a message that <em>contains</em> any of these words.
            Matching is case-insensitive.
          </p>

          {keywordList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {keywordList.map(kw => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs rounded-full"
                >
                  {kw}
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="text-indigo-400/70 hover:text-red-400 transition-colors leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <label className={lbl}>Add keywords (press Enter or comma to add)</label>
          <input
            type="text"
            className={inp}
            onKeyDown={handleKeyInput}
            placeholder='e.g. "book", "appointment", "jadwal"'
          />
          {keywordList.length === 0 && (
            <p className="text-xs text-red-400 mt-1">Add at least one keyword.</p>
          )}
        </div>

        <div className={`${card} border-indigo-800/40 bg-indigo-900/10`}>
          <p className="text-xs text-indigo-300/80">
            <span className="font-medium">💡 Tip:</span> Keep keywords short and likely — buyers type naturally.
            "book", "daftar", "jadwal" work better than "I want to book an appointment".
          </p>
        </div>
      </div>
    );
  };

  // ── Step 3: Configure action ──────────────────────────────────────────────────

  const ConfigureStep = () => {
    const { enabled, questions } = state.qualifyingQuestions;

    const addQuestion = () => {
      const q: CollectInfoQuestion = {
        id: `q${Date.now()}`,
        promptText: '',
        variableName: `answer_${questions.length + 1}`,
        type: 'text',
        required: true,
      };
      update({ qualifyingQuestions: { enabled, questions: [...questions, q] } });
    };

    const removeQ = (i: number) =>
      update({ qualifyingQuestions: { enabled, questions: questions.filter((_, idx) => idx !== i) } });

    const updateQ = (i: number, patch: Partial<CollectInfoQuestion>) =>
      update({
        qualifyingQuestions: {
          enabled,
          questions: questions.map((q, idx) => idx === i ? { ...q, ...patch } : q),
        },
      });

    return (
      <div className="space-y-5">
        {/* Qualifying questions (qualify + scheduling only) */}
        {state.purpose !== 'followup' && (
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-slate-300">💬 Qualifying Questions</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ask buyers questions before the main action — answers saved as variables.
                </p>
              </div>
              <button
                onClick={() => update({ qualifyingQuestions: { enabled: !enabled, questions } })}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  enabled ? 'bg-indigo-600' : 'bg-white/10'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            {enabled && (
              <div className="space-y-3 mt-3 pt-3 border-t border-[#334155]">
                {questions.map((q, i) => (
                  <div key={q.id} className="bg-[#0D1424] rounded-lg p-3 space-y-2 border border-[#1E293B]">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">Question {i + 1}</span>
                      <button onClick={() => removeQ(i)} className="text-[10px] text-red-400/70 hover:text-red-300">
                        Remove
                      </button>
                    </div>
                    <input
                      type="text"
                      className={inp}
                      value={q.promptText}
                      onChange={e => updateQ(i, { promptText: e.target.value })}
                      placeholder="e.g. What's your name?"
                    />
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className={lbl}>Variable name</label>
                        <input
                          type="text"
                          className={inp}
                          value={q.variableName}
                          onChange={e => updateQ(i, { variableName: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                          placeholder="e.g. buyer_name"
                        />
                      </div>
                      <div className="w-28">
                        <label className={lbl}>Type</label>
                        <select
                          className={inp}
                          value={q.type}
                          onChange={e => updateQ(i, { type: e.target.value as 'text' | 'choice' })}
                        >
                          <option value="text">Free text</option>
                          <option value="choice">Multiple choice</option>
                        </select>
                      </div>
                    </div>
                    {q.type === 'choice' && (
                      <div>
                        <label className={lbl}>Choices (comma-separated, max 3)</label>
                        <input
                          type="text"
                          className={inp}
                          value={q.choices?.join(', ') ?? ''}
                          onChange={e => updateQ(i, { choices: e.target.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3) })}
                          placeholder="Yes, No, Maybe"
                        />
                      </div>
                    )}
                  </div>
                ))}
                {questions.length < 5 && (
                  <button
                    onClick={addQuestion}
                    className="w-full border border-dashed border-[#334155] rounded-lg p-2.5 text-xs text-slate-500 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
                  >
                    + Add question
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Purpose-specific action config */}
        {state.purpose === 'qualify' && (
          <div className={card}>
            <p className="text-xs font-semibold text-slate-300 mb-2">📨 Closing Message</p>
            <p className="text-xs text-slate-400 mb-2">Sent after all questions are answered. Use <code className="text-indigo-300">{'{{answers.variableName}}'}</code> to include answers.</p>
            <label className={lbl}>Message</label>
            <textarea
              rows={3}
              className={ta}
              value={state.qualify.outcomeMessage}
              onChange={e => update({ qualify: { outcomeMessage: e.target.value } })}
              placeholder="Thanks! Our team will reach out soon 🙏"
            />
          </div>
        )}

        {state.purpose === 'scheduling' && (
          <div className={card}>
            <p className="text-xs font-semibold text-slate-300 mb-3">📅 Booking Config</p>
            <div className="space-y-3">
              <div>
                <label className={lbl}>Intro message (sent before showing available slots)</label>
                <textarea
                  rows={2}
                  className={ta}
                  value={state.scheduling.introMessage ?? ''}
                  onChange={e => update({ scheduling: { ...state.scheduling, introMessage: e.target.value } })}
                  placeholder="Aku bantu kamu buat booking ya! 📅"
                />
              </div>
              <div>
                <label className={lbl}>Service / appointment type</label>
                <input
                  type="text"
                  className={inp}
                  value={state.scheduling.consultationType ?? ''}
                  onChange={e => update({ scheduling: { ...state.scheduling, consultationType: e.target.value } })}
                  placeholder="e.g. Consultation, Haircut, Doctor Visit"
                />
              </div>
              <div>
                <label className={lbl}>Confirmation model</label>
                <div className="space-y-1.5 mt-1">
                  {(
                    [
                      { value: 'staff_confirm' as const, label: '✋ Staff must approve each booking', desc: 'Buyer waits for staff to confirm — recommended' },
                      { value: 'instant' as const, label: '⚡ Instant booking', desc: 'Auto-confirm immediately, notify staff after' },
                    ]
                  ).map(opt => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors ${
                        (state.scheduling.confirmationModel ?? 'staff_confirm') === opt.value
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-[#334155] hover:border-[#475569]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="confirmationModel"
                        value={opt.value}
                        checked={(state.scheduling.confirmationModel ?? 'staff_confirm') === opt.value}
                        onChange={() => update({ scheduling: { ...state.scheduling, confirmationModel: opt.value } })}
                        className="mt-0.5 accent-indigo-500"
                      />
                      <span>
                        <span className="text-sm text-white">{opt.label}</span>
                        <span className="block text-xs text-slate-400">{opt.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {state.purpose === 'followup' && (
          <div className={card}>
            <p className="text-xs font-semibold text-slate-300 mb-3">📨 Follow-Up Message</p>
            <div className="space-y-3">
              <div>
                <label className={lbl}>Message body</label>
                <textarea
                  rows={4}
                  className={ta}
                  value={state.followup.message ?? ''}
                  onChange={e => update({ followup: { ...state.followup, message: e.target.value } })}
                  placeholder="e.g. ✅ Pembayaran diterima! Pesanan kamu sedang diproses 🎉"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Use <code className="text-indigo-300">{'{{buyer.name}}'}</code> to personalise.
                </p>
              </div>
              <div>
                <label className={lbl}>Delay before sending (minutes, 0 = immediately)</label>
                <input
                  type="number"
                  min={0}
                  className={inp}
                  value={state.followup.delayMs ? Math.round(state.followup.delayMs / 60000) : 0}
                  onChange={e => update({ followup: { ...state.followup, delayMs: Number(e.target.value) * 60000 } })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Step 4: Review + Launch ───────────────────────────────────────────────────

  const LaunchStep = () => {
    const isKeyword = state.triggerType === 'inbound_keyword';
    const kwList = state.keywords.filter(Boolean);

    const flowSteps: { icon: string; text: string }[] = [];

    if (isKeyword) {
      flowSteps.push({ icon: '💬', text: `Buyer sends a message containing: "${kwList.join('" or "')}"` });
    } else {
      const eventLabel: Record<string, string> = {
        payment_confirmed: 'Payment confirmed',
        shipped: 'Order shipped',
        delivered: 'Order delivered',
        payment_failed: 'Payment failed / expired',
      };
      flowSteps.push({ icon: '📦', text: `Order event: ${eventLabel[state.orderEvent ?? 'payment_confirmed'] ?? state.orderEvent}` });
    }

    if (state.qualifyingQuestions.enabled && state.qualifyingQuestions.questions.length > 0) {
      flowSteps.push({
        icon: '💬',
        text: `Bot asks ${state.qualifyingQuestions.questions.length} question${state.qualifyingQuestions.questions.length > 1 ? 's' : ''} and stores answers`,
      });
    }

    if (state.purpose === 'scheduling') {
      if (state.scheduling.introMessage) {
        flowSteps.push({ icon: '📝', text: `Bot sends: "${state.scheduling.introMessage}"` });
      }
      flowSteps.push({ icon: '📅', text: 'Bot presents available time slots for buyer to choose' });
      flowSteps.push({
        icon: state.scheduling.confirmationModel === 'instant' ? '⚡' : '✋',
        text: state.scheduling.confirmationModel === 'instant'
          ? 'Booking auto-confirmed, staff notified'
          : 'Staff approves booking, buyer receives confirmation',
      });
    } else if (state.purpose === 'qualify') {
      flowSteps.push({ icon: '📨', text: `Bot sends: "${state.qualify.outcomeMessage.slice(0, 60)}${state.qualify.outcomeMessage.length > 60 ? '…' : ''}"` });
    } else if (state.purpose === 'followup') {
      if (state.followup.delayMs && state.followup.delayMs > 0) {
        flowSteps.push({ icon: '⏳', text: `Wait ${Math.round(state.followup.delayMs / 60000)} minutes` });
      }
      flowSteps.push({ icon: '📨', text: `Bot sends: "${(state.followup.message ?? '').slice(0, 60)}${(state.followup.message ?? '').length > 60 ? '…' : ''}"` });
    }

    flowSteps.push({ icon: '✅', text: 'Automation complete' });

    return (
      <div className="space-y-4">
        <div className={card}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">📋 Flow Preview</p>
          <div className="space-y-0">
            {flowSteps.map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="text-base">{s.icon}</span>
                  {i < flowSteps.length - 1 && (
                    <div className="w-px flex-1 bg-[#334155] my-1 min-h-[16px]" />
                  )}
                </div>
                <p className="text-xs text-slate-300 pt-0.5 pb-4">{s.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={`${card} bg-indigo-900/10 border-indigo-800/40`}>
          <p className="text-xs font-semibold text-indigo-300 mb-1">✅ Ready to launch</p>
          <p className="text-xs text-slate-400">
            Clicking <strong className="text-white">Launch</strong> activates this automation immediately.{' '}
            {isKeyword && kwList.length > 0 && (
              <>Test it by sending <code className="text-indigo-300">"{kwList[0]}"</code> to your WhatsApp number.</>
            )}
            {!isKeyword && ' It will fire automatically the next time the selected order event occurs.'}
          </p>
        </div>
      </div>
    );
  };

  // ── Success screen ────────────────────────────────────────────────────────────

  if (launched) {
    const isKeyword = state.triggerType === 'inbound_keyword';
    const kwList = state.keywords.filter(Boolean);

    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="text-6xl">🚀</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Automation is live!</h1>
            <p className="text-slate-400 mt-2">
              <span className="text-white font-medium">"{launched.name}"</span> is now active and running.
            </p>
          </div>

          {isKeyword && kwList.length > 0 && (
            <div className="bg-[#0F172A] border border-[#334155] rounded-xl p-4 text-left space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">🧪 Test it now</p>
              <p className="text-sm text-slate-300">
                Send <code className="bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded">"{kwList[0]}"</code> to your
                WhatsApp business number and the bot will reply automatically.
              </p>
              {kwList.length > 1 && (
                <p className="text-xs text-slate-500">
                  Also triggers on: {kwList.slice(1).map(k => `"${k}"`).join(', ')}
                </p>
              )}
            </div>
          )}

          {!isKeyword && (
            <div className="bg-[#0F172A] border border-[#334155] rounded-xl p-4 text-left space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">⚙️ How it runs</p>
              <p className="text-sm text-slate-300">
                This automation fires automatically when the selected order event occurs for any buyer.
                No action required from you.
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={() => navigate('/dashboard/automations')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              View all automations
            </button>
            <button
              onClick={() => {
                setLaunched(null);
                setState(defaultState());
                setStep(0);
              }}
              className="px-5 py-2.5 text-slate-400 hover:text-white rounded-lg text-sm transition-colors border border-[#334155] hover:border-[#475569]"
            >
              Create another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Submit handler ────────────────────────────────────────────────────────────

  const handleSave = async (activate: boolean) => {
    if (!state.name.trim()) {
      addToast('Please enter a flow name', 'error');
      setStep(0);
      return;
    }
    if (state.triggerType === 'inbound_keyword' && state.keywords.filter(Boolean).length === 0) {
      addToast('Add at least one keyword', 'error');
      setStep(1);
      return;
    }

    setIsLoading(true);
    try {
      const definition = buildFlowDefinition(state);
      const triggerType = buildApiTriggerType(state);
      const triggerConfig = (definition as any).triggerConfig ?? {};

      const { flowsApi } = await import('@/lib/api');
      const res = await flowsApi.create({
        name: state.name.trim(),
        definition,
        triggerType,
        triggerConfig,
      });

      if (activate && res.data?.id) {
        await flowsApi.updateStatus(res.data.id, 'active');
        setLaunched({ id: res.data.id, name: state.name.trim() });
      } else {
        addToast('Saved as draft', 'success');
        navigate('/dashboard/automations');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Failed to save';
      addToast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Nav helpers ───────────────────────────────────────────────────────────────

  const canNext = (): boolean => {
    if (step === 0) return !!state.name.trim();
    if (step === 1 && state.triggerType === 'inbound_keyword') return state.keywords.filter(Boolean).length > 0;
    return true;
  };

  const stepComponents = [PurposeStep, TriggerStep, ConfigureStep, LaunchStep];
  const CurrentStep = stepComponents[step];

  return (
    <div className="min-h-screen bg-[#0B1120] p-6 flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-xl mb-5">
        <button
          onClick={() => navigate('/dashboard/automations')}
          className="text-slate-500 hover:text-slate-300 text-sm transition-colors mb-3 flex items-center gap-1"
        >
          ← Automations
        </button>
        <h1 className="text-xl font-bold text-white">New Automation</h1>
        <p className="text-sm text-slate-400 mt-0.5">Build a WhatsApp automation in minutes.</p>
      </div>

      {/* Progress */}
      <div className="w-full max-w-xl flex items-center mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i >= step}
              className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                i === step ? 'text-indigo-400'
                : i < step ? 'text-slate-400 hover:text-white cursor-pointer'
                : 'text-slate-600 cursor-default'
              }`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] border flex-shrink-0 ${
                i === step ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                : i < step ? 'border-emerald-700 bg-emerald-800/30 text-emerald-400'
                : 'border-[#334155] text-slate-600'
              }`}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-emerald-800/50' : 'bg-[#334155]'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Panel */}
      <div className="w-full max-w-xl bg-[#111827] border border-[#1E293B] rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="text-xl">{STEPS[step].icon}</span>
          <h2 className="text-base font-semibold text-white">
            {step === 0 ? 'What should this automation do?' :
             step === 1 ? 'How does it start?' :
             step === 2 ? 'Configure the action' :
             'Review and launch'}
          </h2>
        </div>

        {CurrentStep?.()}

        {/* Footer nav */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#1E293B]">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0 || isLoading}
            className="px-4 py-2 text-sm text-slate-500 hover:text-white disabled:opacity-30 transition-colors"
          >
            ← Back
          </button>

          <div className="flex items-center gap-2">
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => {
                  if (!canNext()) {
                    addToast(
                      step === 0 ? 'Enter a name first' : 'Add at least one keyword',
                      'error',
                    );
                    return;
                  }
                  setStep(s => s + 1);
                }}
                disabled={isLoading}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Continue →
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleSave(false)}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
                >
                  Save draft
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={isLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : '🚀'}
                  {isLoading ? 'Launching…' : 'Launch Automation'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
