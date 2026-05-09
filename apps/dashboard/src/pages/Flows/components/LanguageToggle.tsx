interface LanguageToggleProps {
  language: 'en' | 'id';
  onChange: (lang: 'en' | 'id') => void;
}

export function LanguageToggle({ language, onChange }: LanguageToggleProps) {
  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-lg p-1">
      <button
        onClick={() => onChange('en')}
        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
          language === 'en'
            ? 'bg-accent text-white'
            : 'text-secondary hover:text-primary'
        }`}
      >
        English
      </button>
      <button
        onClick={() => onChange('id')}
        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
          language === 'id'
            ? 'bg-accent text-white'
            : 'text-secondary hover:text-primary'
        }`}
      >
        Bahasa
      </button>
    </div>
  );
}
