import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '@/hooks/useOnboarding';
import { TemplateCard } from './TemplateCard';

type BusinessType = 'clinic' | 'salon' | 'retail' | 'restaurant' | 'other';
type Goal = 'booking' | 'questions' | 'leads' | 'promotions';

interface TemplateConfig {
  id: string;
  labelEn: string;
  labelId: string;
  icon: string;
  category: 'Scheduling' | 'Sales' | 'Marketing' | 'Support';
  previewEn: string[];
  previewId: string[];
}

const TEMPLATES: Record<string, TemplateConfig> = {
  S1: {
    id: 'S1',
    labelEn: 'Book an Appointment',
    labelId: 'Buat Jadwal',
    icon: '📅',
    category: 'Scheduling',
    previewEn: ['Bot: "What service do you need?"', 'Buyer: "Haircut"'],
    previewId: ['Bot: "Layanan apa yang kamu butuhkan?"', 'Pembeli: "Potong rambut"'],
  },
  S2: {
    id: 'S2',
    labelEn: 'Answer Product Questions',
    labelId: 'Jawab Pertanyaan Produk',
    icon: '💬',
    category: 'Sales',
    previewEn: ['Buyer: "Do you have sizes XL?"', 'Bot: "Yes, we do!"'],
    previewId: ['Pembeli: "Ada ukuran XL?"', 'Bot: "Tentu saja!"'],
  },
  S3: {
    id: 'S3',
    labelEn: 'Collect a Lead',
    labelId: 'Kumpulkan Prospek',
    icon: '👤',
    category: 'Marketing',
    previewEn: ['Bot: "What\'s your name?"', 'Buyer: "John"'],
    previewId: ['Bot: "Siapa nama Anda?"', 'Pembeli: "John"'],
  },
  S4: {
    id: 'S4',
    labelEn: 'Broadcast Announcement',
    labelId: 'Kirim Pengumuman',
    icon: '📢',
    category: 'Marketing',
    previewEn: ['Bot: "New sale! 50% off today"', 'Buyer: "Thanks!"'],
    previewId: ['Bot: "Diskon besar! 50% hari ini"', 'Pembeli: "Terima kasih!"'],
  },
  S5: {
    id: 'S5',
    labelEn: 'Human Handoff',
    labelId: 'Alihkan ke Tim',
    icon: '👥',
    category: 'Support',
    previewEn: ['Buyer: "Talk to someone"', 'Bot: "Connecting to team..."'],
    previewId: ['Pembeli: "Bicara dengan tim"', 'Bot: "Menghubungkan ke tim..."'],
  },
};

function getTemplatesSuggested(business: BusinessType, goal: Goal): string[] {
  if (business === 'clinic') {
    if (goal === 'booking') return ['S1', 'S5'];
    if (goal === 'questions') return ['S2', 'S1'];
  }
  if (business === 'salon') {
    if (goal === 'booking') return ['S1', 'S3'];
  }
  if (business === 'retail' || business === 'restaurant') {
    if (goal === 'promotions') return ['S4', 'S2'];
  }
  return ['S1', 'S2', 'S3'];
}

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OnboardingWizard({ isOpen, onClose }: OnboardingWizardProps) {
  const navigate = useNavigate();
  const { markComplete } = useOnboarding();
  const [screen, setScreen] = useState<'q1' | 'q2' | 'q3' | 'templates'>('q1');
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [staffApprovalNeeded, setStaffApprovalNeeded] = useState<boolean | null>(null);

  if (!isOpen) return null;

  const handleQ1 = (type: BusinessType) => {
    setBusinessType(type);
    setScreen('q2');
  };

  const handleQ2 = (g: Goal) => {
    setGoal(g);
    setScreen('q3');
  };

  const handleQ3 = (needsApproval: boolean) => {
    setStaffApprovalNeeded(needsApproval);
    setScreen('templates');
  };

  const handleTemplateSelect = (templateId: string) => {
    markComplete();
    navigate(`/dashboard/automations/new/${templateId}`);
  };

  const handleSkip = () => {
    markComplete();
    onClose();
  };

  const suggestedIds =
    businessType && goal ? getTemplatesSuggested(businessType, goal) : ['S1', 'S2', 'S3'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header with Close */}
        <div className="sticky top-0 bg-slate-900/95 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-white">Let's set up your first automation</h2>
            <p className="text-sm text-slate-400 mt-1">
              {screen === 'q1' && 'Question 1 of 3'}
              {screen === 'q2' && 'Question 2 of 3'}
              {screen === 'q3' && 'Question 3 of 3'}
              {screen === 'templates' && 'Pick a template to get started'}
            </p>
          </div>
          <button
            onClick={handleSkip}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close wizard"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Screen 1: Business Type */}
          {screen === 'q1' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">What kind of business do you run?</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { id: 'clinic', label: 'Clinic / Medical', icon: '🏥' },
                  { id: 'salon', label: 'Salon & Beauty', icon: '💇' },
                  { id: 'retail', label: 'Retail & Fashion', icon: '👗' },
                  { id: 'restaurant', label: 'F&B / Restaurant', icon: '🍽️' },
                  { id: 'other', label: 'Other', icon: '🌐' },
                ].map(({ id, label, icon }) => (
                  <button
                    key={id}
                    onClick={() => handleQ1(id as BusinessType)}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      businessType === id
                        ? 'border-accent bg-accent/10'
                        : 'border-slate-700 hover:border-slate-600 bg-slate-800/40 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="text-2xl mb-2">{icon}</div>
                    <span className="text-white font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Screen 2: Goal */}
          {screen === 'q2' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">What's your main goal right now?</h3>
              <div className="space-y-2">
                {[
                  { id: 'booking', label: 'Book appointments' },
                  { id: 'questions', label: 'Answer product questions' },
                  { id: 'leads', label: 'Collect customer leads' },
                  { id: 'promotions', label: 'Send promotions' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => handleQ2(id as Goal)}
                    className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                      goal === id
                        ? 'border-accent bg-accent/10'
                        : 'border-slate-700 hover:border-slate-600 bg-slate-800/40 hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="text-white font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Screen 3: Staff Approval */}
          {screen === 'q3' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Do staff need to approve first?</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { id: true, label: 'Yes — staff approve before confirming', icon: '✋' },
                  { id: false, label: 'No — auto-confirm is fine', icon: '✅' },
                ].map(({ id, label, icon }) => (
                  <button
                    key={id.toString()}
                    onClick={() => handleQ3(id)}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      staffApprovalNeeded === id
                        ? 'border-accent bg-accent/10'
                        : 'border-slate-700 hover:border-slate-600 bg-slate-800/40 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="text-2xl mb-2">{icon}</div>
                    <span className="text-white font-medium text-sm">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Screen 4: Template Suggestions */}
          {screen === 'templates' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Choose a template to get started</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suggestedIds.map((id) => {
                  const template = TEMPLATES[id];
                  return (
                    <TemplateCard
                      key={id}
                      id={id}
                      icon={template.icon}
                      title={template.labelEn}
                      subtitle={template.labelId}
                      category={template.category}
                      preview={template.previewEn}
                      onSelect={handleTemplateSelect}
                    />
                  );
                })}
              </div>
              <button
                onClick={handleSkip}
                className="w-full mt-4 py-2 px-4 text-slate-400 hover:text-white border border-slate-700 rounded-lg transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="sticky bottom-0 border-t border-slate-700 bg-slate-900/95 px-6 py-4 flex justify-between">
          {screen !== 'q1' && (
            <button
              onClick={() => {
                if (screen === 'q2') {
                  setBusinessType(null);
                  setScreen('q1');
                } else if (screen === 'q3') {
                  setGoal(null);
                  setScreen('q2');
                } else if (screen === 'templates') {
                  setStaffApprovalNeeded(null);
                  setScreen('q3');
                }
              }}
              className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
            >
              ← Back
            </button>
          )}
          {screen !== 'templates' && (
            <button
              onClick={() => {
                if (screen === 'q1' && businessType) handleQ2(goal || 'booking');
                if (screen === 'q2' && goal) handleQ3(staffApprovalNeeded ?? false);
              }}
              disabled={
                (screen === 'q1' && !businessType) ||
                (screen === 'q2' && !goal) ||
                (screen === 'q3' && staffApprovalNeeded === null)
              }
              className="ml-auto px-6 py-2 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
