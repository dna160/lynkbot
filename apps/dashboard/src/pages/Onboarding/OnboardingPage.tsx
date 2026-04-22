/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Onboarding/OnboardingPage.tsx
 * Role    : 5-step onboarding wizard with progress bar.
 * Exports : OnboardingPage
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Step1StoreName } from './steps/Step1StoreName';
import { Step2WhatsApp } from './steps/Step2WhatsApp';
import { Step3Products } from './steps/Step3Products';
import { Step4Payment } from './steps/Step4Payment';
import { Step5Complete } from './steps/Step5Complete';

const STEPS = [
  { label: 'Store Info' },
  { label: 'WhatsApp' },
  { label: 'First Product' },
  { label: 'Payments' },
  { label: 'Done!' },
];

export function OnboardingPage() {
  const [step, setStep] = useState(1);
  const navigate = useNavigate();

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  function next() { setStep(s => Math.min(s + 1, STEPS.length)); }
  function back() { setStep(s => Math.max(s - 1, 1)); }
  function finish() { navigate('/dashboard/orders'); }

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-3xl font-bold text-indigo-400">LynkBot</span>
          <p className="text-slate-400 mt-1 text-sm">Set up your WhatsApp AI store</p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {STEPS.map((s, i) => (
              <span
                key={i}
                className={`text-xs ${i + 1 <= step ? 'text-indigo-400' : 'text-slate-500'}`}
              >
                {s.label}
              </span>
            ))}
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-slate-400 text-xs mt-2 text-right">Step {step} of {STEPS.length}</p>
        </div>

        {/* Step content */}
        <div className="bg-[#1E293B] border border-[#334155] rounded-xl p-8">
          {step === 1 && <Step1StoreName onNext={next} />}
          {step === 2 && <Step2WhatsApp onNext={next} onBack={back} />}
          {step === 3 && <Step3Products onNext={next} onBack={back} />}
          {step === 4 && <Step4Payment onNext={next} onBack={back} />}
          {step === 5 && <Step5Complete onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
