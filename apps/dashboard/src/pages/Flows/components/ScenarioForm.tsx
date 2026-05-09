/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/components/ScenarioForm.tsx
 * Role    : Generic scenario form component for Phase 3 (adapts per template)
 */

import type { ReactNode } from 'react';
import { ScenarioFormState } from '@/hooks/useScenarioBuilder';

const inputCls = 'w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50';
const textareaCls = `${inputCls} resize-none`;

function KeywordsField({
  value,
  onChange,
  placeholder = 'hello, hi, start',
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-secondary">Trigger keywords</label>
      <input
        type="text"
        value={value.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        placeholder={placeholder}
        disabled={disabled}
        className={inputCls}
      />
      <p className="text-[10px] text-secondary/50 mt-1">
        Comma-separated. The automation starts when a buyer sends any of these words.
      </p>
    </div>
  );
}

function TriggerSection({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">⚡</span>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Trigger</span>
        <span className="text-[10px] text-secondary/50">— how this automation starts</span>
      </div>
      {children}
    </div>
  );
}

interface ScenarioFormProps {
  templateId: string;
  formData: ScenarioFormState;
  onFieldChange: (key: string, value: string | boolean | string[] | undefined) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ScenarioForm({
  templateId,
  formData,
  onFieldChange,
  isLoading = false,
  error,
}: ScenarioFormProps) {
  const getFieldValue = (key: string): string => {
    const val = formData[key];
    return typeof val === 'string' ? val : '';
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {templateId === 'S1' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Book an Appointment</h3>
          <TriggerSection>
            <div>
              <label className="text-xs text-secondary">Trigger type</label>
              <select
                value={getFieldValue('triggerType') || 'inbound_keyword'}
                onChange={(e) => onFieldChange('triggerType', e.target.value)}
                disabled={isLoading}
                className={inputCls}
              >
                <option value="inbound_keyword">Keyword — buyer sends a keyword</option>
                <option value="button_click">Button click — buyer taps a WhatsApp button</option>
              </select>
            </div>
            {(getFieldValue('triggerType') || 'inbound_keyword') === 'inbound_keyword' ? (
              <KeywordsField
                value={Array.isArray(formData.triggerKeywords) ? formData.triggerKeywords as string[] : ['book', 'appointment']}
                onChange={(v) => onFieldChange('triggerKeywords', v)}
                placeholder="book, appointment, jadwal"
                disabled={isLoading}
              />
            ) : (
              <div>
                <label className="text-xs text-secondary">Button payload prefix</label>
                <input
                  type="text"
                  value={getFieldValue('triggerButtonPayload') || 'book_'}
                  onChange={(e) => onFieldChange('triggerButtonPayload', e.target.value)}
                  placeholder="book_"
                  disabled={isLoading}
                  className={inputCls}
                />
                <p className="text-[10px] text-secondary/50 mt-1">Starts when a button whose payload begins with this prefix is tapped.</p>
              </div>
            )}
          </TriggerSection>
          <div>
            <label className="text-xs text-secondary">Service Name</label>
            <input type="text" value={getFieldValue('serviceName')} onChange={(e) => onFieldChange('serviceName', e.target.value)} placeholder="e.g., Hair Cut, Consultation" disabled={isLoading} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-secondary">Intro Message</label>
            <textarea value={getFieldValue('introMessage')} onChange={(e) => onFieldChange('introMessage', e.target.value)} placeholder="Welcome message..." disabled={isLoading} className={textareaCls} rows={2} />
          </div>
        </div>
      )}

      {templateId === 'S2' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Answer Product Questions</h3>
          <TriggerSection>
            <KeywordsField
              value={Array.isArray(formData.triggerKeywords) ? formData.triggerKeywords as string[] : ['info', 'product', 'price']}
              onChange={(v) => onFieldChange('triggerKeywords', v)}
              placeholder="info, product, price, harga"
              disabled={isLoading}
            />
          </TriggerSection>
          <div>
            <label className="text-xs text-secondary">Question Prompt</label>
            <input type="text" value={getFieldValue('questionPrompt')} onChange={(e) => onFieldChange('questionPrompt', e.target.value)} placeholder="What product are you interested in?" disabled={isLoading} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-secondary">Answer Template</label>
            <textarea value={getFieldValue('answerTemplate')} onChange={(e) => onFieldChange('answerTemplate', e.target.value)} placeholder="Answer text..." disabled={isLoading} className={textareaCls} rows={2} />
          </div>
        </div>
      )}

      {templateId === 'S3' && (() => {
        const questions: string[] = Array.isArray(formData.qualifyingQuestions)
          ? (formData.qualifyingQuestions as string[])
          : ["What's your name?"];
        const setQuestions = (qs: string[]) => onFieldChange('qualifyingQuestions', qs);
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary">Collect a Lead</h3>
            <TriggerSection>
              <KeywordsField
                value={Array.isArray(formData.triggerKeywords) ? formData.triggerKeywords as string[] : ['lead', 'interested', 'info']}
                onChange={(v) => onFieldChange('triggerKeywords', v)}
                placeholder="lead, interested, daftar"
                disabled={isLoading}
              />
            </TriggerSection>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-secondary">Qualifying Questions</label>
                <button type="button" onClick={() => setQuestions([...questions, ''])} disabled={isLoading || questions.length >= 8} className="text-xs text-accent hover:text-accent/80 disabled:opacity-40 disabled:cursor-not-allowed">
                  + Add question
                </button>
              </div>
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <span className="text-xs text-secondary/50 w-4 shrink-0">{i + 1}.</span>
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => { const u = [...questions]; u[i] = e.target.value; setQuestions(u); }}
                      placeholder="e.g. What's your name?"
                      disabled={isLoading}
                      className="flex-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                    {questions.length > 1 && (
                      <button type="button" onClick={() => setQuestions(questions.filter((_, idx) => idx !== i))} disabled={isLoading} className="text-secondary/40 hover:text-red-400 transition-colors disabled:opacity-40" aria-label="Remove question">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-secondary/50 mt-1">Each question is asked in sequence. The bot waits for a reply before moving on.</p>
            </div>
            <div>
              <label className="text-xs text-secondary">Follow-up Message</label>
              <textarea value={getFieldValue('followUpMessage')} onChange={(e) => onFieldChange('followUpMessage', e.target.value)} placeholder="Thanks for sharing!" disabled={isLoading} className={textareaCls} rows={2} />
            </div>
          </div>
        );
      })()}

      {templateId === 'S4' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Broadcast Announcement</h3>
          <TriggerSection>
            <div className="rounded-lg bg-amber-900/20 border border-amber-700/30 px-3 py-2 text-xs text-amber-300/80">
              Broadcasts are sent manually from the Automations list or via the API — no keyword needed. The quality gate filters contacts before sending.
            </div>
          </TriggerSection>
          <div>
            <label className="text-xs text-secondary">Broadcast Message *</label>
            <textarea value={getFieldValue('broadcastMessage')} onChange={(e) => onFieldChange('broadcastMessage', e.target.value)} placeholder="Your announcement here..." disabled={isLoading} required className={textareaCls} rows={3} />
          </div>
          <div>
            <label className="text-xs text-secondary">Follow-up Message</label>
            <textarea value={getFieldValue('followUpMessage')} onChange={(e) => onFieldChange('followUpMessage', e.target.value)} placeholder="Optional follow-up..." disabled={isLoading} className={textareaCls} rows={2} />
          </div>
        </div>
      )}

      {templateId === 'S5' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Human Handoff</h3>
          <TriggerSection>
            <KeywordsField
              value={Array.isArray(formData.triggerKeywords) ? formData.triggerKeywords as string[] : ['help', 'support', 'agent']}
              onChange={(v) => onFieldChange('triggerKeywords', v)}
              placeholder="help, support, agent, bantuan"
              disabled={isLoading}
            />
          </TriggerSection>
          <div>
            <label className="text-xs text-secondary">Handoff Message</label>
            <textarea value={getFieldValue('handoffMessage')} onChange={(e) => onFieldChange('handoffMessage', e.target.value)} placeholder="Connecting you to our team..." disabled={isLoading} className={textareaCls} rows={2} />
          </div>
        </div>
      )}
    </div>
  );
}
