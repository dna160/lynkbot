import { ReactNode } from 'react';

interface TemplateCardProps {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  category: 'Scheduling' | 'Sales' | 'Marketing' | 'Support';
  preview: string[];
  onSelect: (id: string) => void;
  isLoading?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  Scheduling: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  Sales: 'bg-green-500/20 text-green-400 border border-green-500/30',
  Marketing: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  Support: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
};

const CATEGORY_BG: Record<string, string> = {
  Scheduling: 'hover:bg-slate-800/50',
  Sales: 'hover:bg-slate-800/50',
  Marketing: 'hover:bg-slate-800/50',
  Support: 'hover:bg-slate-800/50',
};

export function TemplateCard({
  id,
  icon,
  title,
  subtitle,
  category,
  preview,
  onSelect,
  isLoading = false,
}: TemplateCardProps) {
  return (
    <div
      className={`p-5 border border-slate-700 rounded-lg bg-slate-900/40 transition-all cursor-pointer ${CATEGORY_BG[category]} ${
        isLoading ? 'opacity-50 pointer-events-none' : ''
      }`}
      onClick={() => !isLoading && onSelect(id)}
    >
      {/* Icon + Title */}
      <div className="flex items-start gap-3 mb-4">
        <div className="text-3xl">{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-white text-sm">{title}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
        </div>
      </div>

      {/* Category Tag */}
      <div className="mb-3">
        <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${CATEGORY_COLORS[category]}`}>
          {category}
        </span>
      </div>

      {/* Preview Snippet */}
      <div className="mb-4 p-3 bg-slate-950 rounded-lg border border-slate-800">
        <div className="space-y-1.5">
          {preview.map((line, i) => (
            <div key={i} className="text-xs text-slate-500 leading-relaxed">
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* CTA Button */}
      <button
        className="w-full py-2 px-3 bg-accent/10 text-accent border border-accent/40 rounded-md text-sm font-medium hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={isLoading}
      >
        {isLoading ? 'Loading...' : 'Use this template'}
      </button>
    </div>
  );
}
