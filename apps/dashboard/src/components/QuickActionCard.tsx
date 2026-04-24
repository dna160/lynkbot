/*
 * package: @lynkbot/dashboard
 * file: src/components/QuickActionCard.tsx
 * role: Action card for overview quick actions
 * exports: QuickActionCard
 */
import { type ReactNode } from 'react';

interface QuickActionCardProps {
  icon: ReactNode;
  label: string;
  description?: string;
  onClick?: () => void;
  href?: string;
  color?: 'indigo' | 'green' | 'violet' | 'amber' | 'blue';
}

const colorMap = {
  indigo: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30 hover:bg-indigo-600/30',
  green: 'bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/30',
  violet: 'bg-violet-600/20 text-violet-400 border-violet-600/30 hover:bg-violet-600/30',
  amber: 'bg-amber-600/20 text-amber-400 border-amber-600/30 hover:bg-amber-600/30',
  blue: 'bg-blue-600/20 text-blue-400 border-blue-600/30 hover:bg-blue-600/30',
};

export function QuickActionCard({ icon, label, description, onClick, href, color = 'indigo' }: QuickActionCardProps) {
  const className = `flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors cursor-pointer ${colorMap[color]}`;

  const content = (
    <>
      <div className="w-9 h-9 rounded-lg bg-black/20 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs opacity-70">{description}</div>}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      {content}
    </button>
  );
}
