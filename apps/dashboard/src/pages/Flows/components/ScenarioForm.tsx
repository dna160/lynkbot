/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/components/ScenarioForm.tsx
 * Role    : Generic scenario form component for Phase 3 (adapts per template)
 */

import { ScenarioFormState } from '@/hooks/useScenarioBuilder';

interface ScenarioFormProps {
  templateId: string;
  formData: ScenarioFormState;
  onFieldChange: (key: string, value: string | boolean | undefined) => void;
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
          <div>
            <label className="text-xs text-secondary">Service Name</label>
            <input
              type="text"
              value={getFieldValue('serviceName')}
              onChange={(e) => onFieldChange('serviceName', e.target.value)}
              placeholder="e.g., Hair Cut, Consultation"
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-secondary">Intro Message</label>
            <textarea
              value={getFieldValue('introMessage')}
              onChange={(e) => onFieldChange('introMessage', e.target.value)}
              placeholder="Welcome message..."
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
              rows={2}
            />
          </div>
        </div>
      )}

      {templateId === 'S2' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Answer Product Questions</h3>
          <div>
            <label className="text-xs text-secondary">Question Prompt</label>
            <input
              type="text"
              value={getFieldValue('questionPrompt')}
              onChange={(e) => onFieldChange('questionPrompt', e.target.value)}
              placeholder="What product are you interested in?"
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-secondary">Answer Template</label>
            <textarea
              value={getFieldValue('answerTemplate')}
              onChange={(e) => onFieldChange('answerTemplate', e.target.value)}
              placeholder="Answer text..."
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
              rows={2}
            />
          </div>
        </div>
      )}

      {templateId === 'S3' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Collect a Lead</h3>
          <div>
            <label className="text-xs text-secondary">Lead Question</label>
            <input
              type="text"
              value={getFieldValue('leadQuestion')}
              onChange={(e) => onFieldChange('leadQuestion', e.target.value)}
              placeholder="What's your name?"
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-secondary">Follow-up Message</label>
            <textarea
              value={getFieldValue('followUpMessage')}
              onChange={(e) => onFieldChange('followUpMessage', e.target.value)}
              placeholder="Thanks for sharing!"
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
              rows={2}
            />
          </div>
        </div>
      )}

      {templateId === 'S4' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Broadcast Announcement</h3>
          <div>
            <label className="text-xs text-secondary">Broadcast Message *</label>
            <textarea
              value={getFieldValue('broadcastMessage')}
              onChange={(e) => onFieldChange('broadcastMessage', e.target.value)}
              placeholder="Your announcement here..."
              disabled={isLoading}
              required
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs text-secondary">Follow-up Message</label>
            <textarea
              value={getFieldValue('followUpMessage')}
              onChange={(e) => onFieldChange('followUpMessage', e.target.value)}
              placeholder="Optional follow-up..."
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
              rows={2}
            />
          </div>
        </div>
      )}

      {templateId === 'S5' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary">Human Handoff</h3>
          <div>
            <label className="text-xs text-secondary">Handoff Message</label>
            <textarea
              value={getFieldValue('handoffMessage')}
              onChange={(e) => onFieldChange('handoffMessage', e.target.value)}
              placeholder="Connecting you to our team..."
              disabled={isLoading}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
              rows={2}
            />
          </div>
        </div>
      )}
    </div>
  );
}
