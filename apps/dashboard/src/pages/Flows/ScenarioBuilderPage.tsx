/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/ScenarioBuilderPage.tsx
 * Role    : Scenario Builder page at /dashboard/automations/new/:templateId (Phase 3)
 *           Two-column form + sticky WhatsApp preview
 *           Deterministic flow builders (no LLM)
 *           Save Draft or Activate
 */

import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { TEMPLATES } from '@/data/templates';
import { useScenarioBuilder } from '@/hooks/useScenarioBuilder';
import { useToast } from '@/components/ToastProvider';
import { ScenarioBuilderLayout } from './components/ScenarioBuilderLayout';
import { ScenarioForm } from './components/ScenarioForm';

export function ScenarioBuilderPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useToast();
  const [flowName, setFlowName] = useState('');

  const routerState = location.state as { qualifyingQuestions?: string[] } | null;
  const initialData = routerState?.qualifyingQuestions?.length
    ? { qualifyingQuestions: routerState.qualifyingQuestions }
    : undefined;

  const { formData, updateField, saveFlow, isLoading, error } = useScenarioBuilder(
    templateId || 'S1',
    initialData,
  );

  if (!templateId || !TEMPLATES[templateId]) {
    return (
      <div className="p-6 text-center text-red-400">
        <p>Invalid template ID</p>
      </div>
    );
  }

  const template = TEMPLATES[templateId];

  const handleSaveDraft = async () => {
    if (!flowName.trim()) {
      addToast('Please enter a flow name', 'error');
      return;
    }
    try {
      await saveFlow(flowName, false);
      addToast('Flow saved as draft', 'success');
      navigate(`/dashboard/automations`);
    } catch (err: any) {
      addToast(err?.message || 'Failed to save flow', 'error');
    }
  };

  const handleActivate = async () => {
    if (!flowName.trim()) {
      addToast('Please enter a flow name', 'error');
      return;
    }
    try {
      await saveFlow(flowName, true);
      addToast('Flow created and activated', 'success');
      navigate(`/dashboard/automations`);
    } catch (err: any) {
      addToast(err?.message || 'Failed to activate flow', 'error');
    }
  };

  // Show the most relevant user-entered message field in the preview, with sensible defaults
  const PREVIEW_DEFAULTS: Record<string, string> = {
    S1: 'Hi! Let me help you book an appointment.',
    S2: "Here's the information you need.",
    S3: "Thanks! We'll be in touch soon.",
    S4: 'Your announcement here...',
    S5: 'Connecting you to our team...',
  };
  const previewText =
    (typeof formData.broadcastMessage === 'string' && formData.broadcastMessage) ||
    (typeof formData.answerTemplate === 'string' && formData.answerTemplate) ||
    (typeof formData.introMessage === 'string' && formData.introMessage) ||
    (typeof formData.followUpMessage === 'string' && formData.followUpMessage) ||
    (typeof formData.handoffMessage === 'string' && formData.handoffMessage) ||
    PREVIEW_DEFAULTS[templateId] ||
    'Your automation message will appear here...';

  return (
    <ScenarioBuilderLayout
      form={
        <ScenarioForm
          templateId={templateId}
          formData={formData}
          onFieldChange={updateField}
          isLoading={isLoading}
          error={error}
        />
      }
      previewText={previewText}
      previewHeader={template.labelEn}
      actions={
        <div className="space-y-4">
          <div>
            <label className="text-xs text-secondary">Flow Name *</label>
            <input
              type="text"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              placeholder={`My ${template.labelEn} Flow`}
              disabled={isLoading}
              className="w-full mt-2 px-3 py-2 bg-slate-950 border border-border text-primary text-sm rounded-lg focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSaveDraft}
              disabled={isLoading || !flowName.trim()}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              onClick={handleActivate}
              disabled={isLoading || !flowName.trim()}
              className="flex-1 px-4 py-2 bg-accent hover:bg-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Creating...' : 'Create & Activate'}
            </button>
          </div>

          <p className="text-xs text-secondary">
            After saving, you can customize further in the editor or activate immediately.
          </p>
        </div>
      }
    />
  );
}
