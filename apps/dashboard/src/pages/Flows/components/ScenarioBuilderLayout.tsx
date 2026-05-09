/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/components/ScenarioBuilderLayout.tsx
 * Role    : Two-column layout for scenario builder (Phase 3)
 *           Left: scrollable form
 *           Right: sticky WhatsApp preview
 */

import { ReactNode } from 'react';
import { TemplatePreview } from '@/pages/Templates/components/TemplatePreview';

interface ScenarioBuilderLayoutProps {
  form: ReactNode;
  previewText: string;
  previewHeader?: string;
  actions: ReactNode;
}

export function ScenarioBuilderLayout({
  form,
  previewText,
  previewHeader,
  actions,
}: ScenarioBuilderLayoutProps) {
  return (
    <div className="flex gap-6 p-6 max-w-7xl mx-auto">
      {/* Left: Form (scrollable) */}
      <div className="flex-1 space-y-6">
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-primary">Configure Your Automation</h1>
          <div className="bg-surface border border-border rounded-xl p-6">
            {form}
          </div>
        </div>

        {/* Actions */}
        <div className="bg-surface border border-border rounded-xl p-6">
          {actions}
        </div>
      </div>

      {/* Right: Sticky Preview */}
      <div className="w-80 sticky top-6 h-fit">
        <div className="space-y-3">
          <p className="text-xs text-secondary font-medium">WHATSAPP PREVIEW</p>
          <TemplatePreview
            headerText={previewHeader}
            bodyText={previewText || 'Message preview...'}
            buttons={[{ type: 'action', text: 'View Details' }]}
          />
        </div>
      </div>
    </div>
  );
}
