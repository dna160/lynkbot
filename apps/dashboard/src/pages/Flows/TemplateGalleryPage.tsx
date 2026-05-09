/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/TemplateGalleryPage.tsx
 * Role    : Template gallery for all 5 scenarios (S1-S5) with language toggle.
 *           Entry point: /dashboard/automations/new (Phase 2)
 *           Links to Scenario Builder (Phase 3): /dashboard/automations/new/:templateId
 */

import { useNavigate } from 'react-router-dom';
import { TEMPLATES } from '@/data/templates';
import { useTemplateGallery } from '@/hooks/useTemplateGallery';
import { TemplateCard } from './components/TemplateCard';
import { LanguageToggle } from './components/LanguageToggle';

export function TemplateGalleryPage() {
  const navigate = useNavigate();
  const { language, switchLanguage, mounted } = useTemplateGallery();

  if (!mounted) return null;

  const templateIds = ['S1', 'S2', 'S3', 'S4', 'S5'];

  const handleTemplateSelect = (templateId: string) => {
    navigate(`/dashboard/automations/new/${templateId}`);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            {language === 'en' ? 'Choose a Template' : 'Pilih Template'}
          </h1>
          <p className="text-sm text-secondary mt-0.5">
            {language === 'en'
              ? 'Select a pre-built template to get started with your first automation'
              : 'Pilih template yang sudah dibuat untuk memulai automasi pertama Anda'}
          </p>
        </div>
        <LanguageToggle language={language} onChange={switchLanguage} />
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templateIds.map((id) => {
          const template = TEMPLATES[id];
          return (
            <TemplateCard
              key={id}
              id={id}
              icon={template.icon}
              title={language === 'en' ? template.labelEn : template.labelId}
              subtitle={language === 'en' ? template.labelId : template.labelEn}
              category={template.category}
              preview={language === 'en' ? template.previewEn : template.previewId}
              onSelect={handleTemplateSelect}
            />
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="mt-8 pt-6 border-t border-border">
        <p className="text-xs text-secondary">
          {language === 'en'
            ? 'Each template comes with pre-configured settings that you can customize in the scenario builder.'
            : 'Setiap template dilengkapi dengan pengaturan awal yang dapat Anda sesuaikan di pembangun skenario.'}
        </p>
      </div>
    </div>
  );
}
