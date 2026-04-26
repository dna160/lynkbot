import { useState, useEffect } from 'react';

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SearchInput({ placeholder = 'Search...', value, onChange, className = '' }: SearchInputProps) {
  const [internal, setInternal] = useState(value ?? '');

  useEffect(() => {
    if (value !== undefined) setInternal(value);
  }, [value]);

  const handleChange = (v: string) => {
    setInternal(v);
    onChange(v);
  };

  return (
    <div className={`relative ${className}`}>
      <svg className="w-4 h-4 text-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={internal}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-8 py-2 bg-surface border border-border rounded-lg text-sm text-primary placeholder-secondary/50 focus:outline-none focus:border-accent transition-colors"
      />
      {internal && (
        <button onClick={() => handleChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary transition-colors" aria-label="Clear search">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
