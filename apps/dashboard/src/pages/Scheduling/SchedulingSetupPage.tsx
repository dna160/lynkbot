import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaff, useServices } from '@/hooks/useScheduling';
import { flowsApi, aiApi } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  name: string;
  keywords: string;
  serviceId: string;
  staffId: string;
  introMessage: string;
  agentInstructions: string;
  staffMessage: string;
}

const DEFAULTS: WizardState = {
  name: 'Scheduling Flow',
  keywords: 'booking, jadwal, schedule, konsultasi',
  serviceId: '',
  staffId: '',
  introMessage: 'Halo! Saya akan membantu kamu booking jadwal. Layanan apa yang kamu butuhkan? 😊',
  agentInstructions: 'Help the buyer book a consultation. Check availability, present available slots, confirm the booking, and notify the assigned staff. Be friendly and respond in the same language as the buyer.',
  staffMessage: '📅 Permintaan appointment baru dari {{buyerName}}!\n\nLayanan: {{serviceName}}\nWaktu: {{time}}\n\nBalas *Konfirmasi* untuk menerima atau *Tolak* untuk menolak.',
};

// ── Step indicator ────────────────────────────────────────────────────────────

function Steps({ current }: { current: number }) {
  const steps = ['Trigger', 'Configure', 'Review'];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i < current ? 'bg-accent text-white' :
              i === current ? 'bg-accent/20 text-accent border border-accent' :
              'bg-white/5 text-secondary/40 border border-border'
            }`}>
              {i < current ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-sm font-medium ${i === current ? 'text-primary' : 'text-secondary/50'}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-12 h-px mx-3 ${i < current ? 'bg-accent/50' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-primary">{label}</span>
      {hint && <span className="text-xs text-secondary/50 ml-2">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls = 'w-full bg-[#0F172A] border border-border rounded-lg px-3 py-2.5 text-sm text-primary focus:outline-none focus:border-accent placeholder-secondary/30';
const selectCls = inputCls;
const textareaCls = `${inputCls} resize-none leading-relaxed`;

// ── Main page ─────────────────────────────────────────────────────────────────

export function SchedulingSetupPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { data: staffList = [] } = useStaff();
  const { data: serviceList = [] } = useServices();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardState>(DEFAULTS);
  const [mode, setMode] = useState<'wizard' | 'ai'>('wizard');
  const [aiPrompt, setAiPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const patch = (p: Partial<WizardState>) => setForm(f => ({ ...f, ...p }));

  const selectedService = serviceList.find((s: any) => s.id === form.serviceId);
  const selectedStaff = staffList.find((s: any) => s.id === form.staffId);

  // Auto-update flow name when service is selected
  const handleServiceChange = (serviceId: string) => {
    const svc = serviceList.find((s: any) => s.id === serviceId);
    patch({
      serviceId,
      name: svc ? `${svc.name} Scheduling Flow` : form.name,
      agentInstructions: svc
        ? `Help the buyer book a "${svc.name}" consultation. Check availability, present available slots, confirm the booking, and notify the assigned staff. Be friendly and respond in the same language as the buyer.`
        : form.agentInstructions,
    });
  };

  // ── Option A: create flow from wizard form ────────────────────────────────

  async function handleCreate(activate: boolean) {
    if (!form.serviceId || !form.staffId) {
      addToast('Please select a service and staff member.', 'error');
      return;
    }
    const keywords = form.keywords.split(',').map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) {
      addToast('Please enter at least one trigger keyword.', 'error');
      return;
    }

    const triggerId = 'trigger_1';
    const agentId = 'agent_1';

    const definition = {
      nodes: [
        {
          id: triggerId,
          type: 'TRIGGER',
          config: { keywords },
          position: { x: 80, y: 200 },
        },
        {
          id: agentId,
          type: 'AGENT',
          config: {
            instructions: form.agentInstructions,
            memoryEnabled: true,
            introMessage: form.introMessage,
            assignedStaffId: form.staffId,
            staffMessage: form.staffMessage,
            actions: [
              { label: 'Booking Sent', instructions: 'After booking request is sent to staff for confirmation' },
              { label: 'Done', instructions: 'When the conversation ends or buyer declines' },
            ],
          },
          position: { x: 380, y: 200 },
        },
      ],
      edges: [
        { id: 'e1', source: triggerId, target: agentId },
      ],
    };

    setLoading(true);
    try {
      const res = await flowsApi.create({
        name: form.name,
        triggerType: 'inbound_keyword',
        triggerConfig: { keywords },
        definition,
      });
      const flowId = res.data?.id;
      if (!flowId) throw new Error('No flow ID returned');

      if (activate) {
        await flowsApi.updateStatus(flowId, 'active');
        addToast('Scheduling flow created and activated!', 'success');
        navigate('/dashboard/appointments');
      } else {
        addToast('Flow saved as draft.', 'success');
        navigate(`/dashboard/flows/${flowId}/edit`);
      }
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Failed to create flow.', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ── Option B: generate from AI prompt ────────────────────────────────────

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setLoading(true);
    try {
      const res = await aiApi.generateFlow({ prompt: aiPrompt });
      const { flowDefinition } = res.data;
      if (!flowDefinition?.nodes?.length) throw new Error('AI returned an empty flow.');

      const created = await flowsApi.create({
        name: 'AI Scheduling Flow',
        triggerType: 'inbound_keyword',
        triggerConfig: {},
        definition: flowDefinition,
      });
      const flowId = created.data?.id;
      addToast('AI flow generated — review and activate in the editor.', 'success');
      navigate(`/dashboard/flows/${flowId}/edit`);
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'AI generation failed. Try rephrasing.', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-secondary/60 hover:text-secondary mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-primary">Set Up Scheduling</h1>
        <p className="text-sm text-secondary/60 mt-1">
          Create a WhatsApp flow that lets buyers book appointments automatically.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6 p-1 bg-white/5 rounded-xl w-fit">
        {(['wizard', 'ai'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              mode === m
                ? 'bg-accent text-white shadow'
                : 'text-secondary/60 hover:text-secondary'
            }`}
          >
            {m === 'wizard' ? '📋 Step-by-step' : '✨ Describe with AI'}
          </button>
        ))}
      </div>

      {/* ── Option A: Wizard ─────────────────────────────────────────────── */}
      {mode === 'wizard' && (
        <div className="bg-surface border border-border rounded-2xl p-6">
          <Steps current={step} />

          {/* Step 0 — Trigger */}
          {step === 0 && (
            <div className="space-y-5">
              <div className="rounded-lg bg-accent/10 border border-accent/20 px-4 py-3 text-sm text-accent/90">
                When a buyer sends a message containing any of these keywords, the scheduling assistant will start automatically.
              </div>

              <Field label="Flow name">
                <input
                  className={inputCls}
                  placeholder="Skin Consultation Scheduling"
                  value={form.name}
                  onChange={e => patch({ name: e.target.value })}
                />
              </Field>

              <Field label="Trigger keywords" hint="comma-separated">
                <input
                  className={inputCls}
                  placeholder="booking, jadwal, schedule, konsultasi"
                  value={form.keywords}
                  onChange={e => patch({ keywords: e.target.value })}
                />
                <p className="text-xs text-secondary/40 mt-1.5">
                  The flow starts when a buyer's message contains any of these words.
                </p>
              </Field>

              <button
                onClick={() => setStep(1)}
                disabled={!form.name.trim() || !form.keywords.trim()}
                className="w-full py-2.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                Continue →
              </button>
            </div>
          )}

          {/* Step 1 — Configure */}
          {step === 1 && (
            <div className="space-y-5">
              <Field label="Service to book">
                <select
                  className={selectCls}
                  value={form.serviceId}
                  onChange={e => handleServiceChange(e.target.value)}
                >
                  <option value="">— Select a service —</option>
                  {serviceList.filter((s: any) => s.isActive !== false).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} min)</option>
                  ))}
                </select>
                {serviceList.length === 0 && (
                  <p className="text-xs text-yellow-400/80 mt-1.5">
                    No services found.{' '}
                    <button onClick={() => navigate('/dashboard/services')} className="underline">Create one first →</button>
                  </p>
                )}
              </Field>

              <Field label="Staff to notify for approval">
                <select
                  className={selectCls}
                  value={form.staffId}
                  onChange={e => patch({ staffId: e.target.value })}
                >
                  <option value="">— Select staff —</option>
                  {staffList.filter((s: any) => s.isActive !== false).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}{s.role ? ` — ${s.role}` : ''}</option>
                  ))}
                </select>
                {staffList.length === 0 && (
                  <p className="text-xs text-yellow-400/80 mt-1.5">
                    No staff found.{' '}
                    <button onClick={() => navigate('/dashboard/staff')} className="underline">Add staff first →</button>
                  </p>
                )}
              </Field>

              <Field label="Intro message to buyer" hint="optional">
                <textarea
                  rows={3}
                  className={textareaCls}
                  value={form.introMessage}
                  onChange={e => patch({ introMessage: e.target.value })}
                />
              </Field>

              <Field label="Agent instructions">
                <textarea
                  rows={4}
                  className={textareaCls}
                  value={form.agentInstructions}
                  onChange={e => patch({ agentInstructions: e.target.value })}
                />
                <p className="text-xs text-secondary/40 mt-1.5">
                  The AI agent will follow these instructions during the booking conversation.
                </p>
              </Field>

              <Field label="Staff notification message" hint="supports {{buyerName}}, {{serviceName}}, {{time}}">
                <textarea
                  rows={4}
                  className={`${textareaCls} font-mono text-xs`}
                  value={form.staffMessage}
                  onChange={e => patch({ staffMessage: e.target.value })}
                />
              </Field>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setStep(0)}
                  className="px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-secondary hover:text-primary hover:bg-white/5 transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!form.serviceId || !form.staffId}
                  className="flex-1 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
                >
                  Review →
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Review */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-3">
                {[
                  { label: 'Flow name', value: form.name },
                  { label: 'Trigger keywords', value: form.keywords },
                  { label: 'Service', value: selectedService?.name ?? '—' },
                  { label: 'Staff notified', value: selectedStaff?.name ?? '—' },
                ].map(row => (
                  <div key={row.label} className="flex justify-between items-start py-2.5 border-b border-border/50 last:border-0">
                    <span className="text-sm text-secondary/60">{row.label}</span>
                    <span className="text-sm font-medium text-primary text-right max-w-[60%]">{row.value}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-lg bg-white/5 border border-border p-4 space-y-2">
                <p className="text-xs font-semibold text-secondary uppercase tracking-wider">What happens</p>
                <ol className="text-sm text-secondary/80 space-y-1.5 list-none">
                  {[
                    `Buyer sends a message with a keyword (e.g. "${form.keywords.split(',')[0]?.trim()}")`,
                    'AI assistant greets buyer and checks available slots',
                    'Buyer picks a time — AI creates the appointment',
                    `${selectedStaff?.name ?? 'Staff'} receives a WhatsApp notification to confirm`,
                    'Buyer gets confirmation once staff approves',
                  ].map((step, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="text-accent font-bold shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-secondary hover:text-primary hover:bg-white/5 transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => handleCreate(false)}
                  disabled={loading}
                  className="px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-secondary hover:text-primary hover:bg-white/5 disabled:opacity-40 transition-colors"
                >
                  Save as draft
                </button>
                <button
                  onClick={() => handleCreate(true)}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : '⚡'}
                  Create & Activate
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Option B: AI ─────────────────────────────────────────────────── */}
      {mode === 'ai' && (
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
          <div className="rounded-lg bg-purple-900/20 border border-purple-700/30 px-4 py-3 text-sm text-purple-300/90">
            Describe your scheduling setup in plain language. The AI will generate the flow and open it in the editor for you to review before activating.
          </div>

          <Field label="Describe your scheduling flow">
            <textarea
              rows={6}
              className={textareaCls}
              placeholder={`Examples:\n• "Set up booking for skin consultations with Dr. Alice, triggered by keywords booking or konsultasi"\n• "Create a scheduling flow for haircut appointments, staff Jana should confirm bookings, intro message in Indonesian"\n• "Booking flow for physiotherapy sessions, 60 minutes each, Dr. Rudi approves, keywords jadwal and fisio"`}
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
            />
          </Field>

          <button
            onClick={handleAiGenerate}
            disabled={loading || !aiPrompt.trim()}
            className="w-full py-2.5 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-500 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : '✨'}
            {loading ? 'Generating…' : 'Generate flow'}
          </button>

          <p className="text-xs text-secondary/40 text-center">
            The AI generates a draft — you'll review it in the editor before it goes live.
          </p>
        </div>
      )}
    </div>
  );
}
