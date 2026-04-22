/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Onboarding/steps/Step5Complete.tsx
 * Role    : Celebration screen with summary checklist and "Open Dashboard" CTA.
 */
interface Props { onFinish: () => void; }

export function Step5Complete({ onFinish }: Props) {
  const checks = [
    'Store name and shipping origin configured',
    'WhatsApp (WATI) connected',
    'First product created',
    'Payment provider set up',
  ];

  return (
    <div className="text-center">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-2xl font-bold text-white mb-2">You're all set!</h2>
      <p className="text-slate-400 text-sm mb-8">
        LynkBot is ready to handle WhatsApp conversations and take orders automatically.
      </p>

      <ul className="text-left space-y-3 mb-10 max-w-sm mx-auto">
        {checks.map((c, i) => (
          <li key={i} className="flex items-center gap-3 text-sm text-slate-300">
            <span className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center text-xs text-white flex-shrink-0">✓</span>
            {c}
          </li>
        ))}
      </ul>

      <button
        onClick={onFinish}
        className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3 rounded-xl text-base transition-colors"
      >
        Open Dashboard →
      </button>
    </div>
  );
}
