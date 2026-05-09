import { useRef } from 'react';
import { VariablePicker } from './VariablePicker';

interface MessageEditorProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}

export function MessageEditor({
  label,
  value,
  onChange,
  placeholder,
  rows = 5,
  hint,
}: MessageEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef = useRef<number>(value.length);

  const saveCursor = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    cursorRef.current = e.currentTarget.selectionStart ?? value.length;
  };

  const handleInsert = (token: string) => {
    const pos = cursorRef.current;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const newVal = before + token + after;
    const newPos = pos + token.length;
    cursorRef.current = newPos;
    onChange(newVal);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newPos, newPos);
      }
    });
  };

  return (
    <div className="space-y-0">
      <label className="block">
        <span className="text-xs font-medium text-secondary">{label}</span>
        <textarea
          ref={taRef}
          rows={rows}
          className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent resize-none font-mono leading-relaxed"
          placeholder={placeholder}
          value={value}
          onChange={(e) => { onChange(e.target.value); saveCursor(e); }}
          onMouseUp={saveCursor}
          onKeyUp={saveCursor}
          onSelect={saveCursor}
        />
        {hint && <span className="text-[10px] text-secondary/50 mt-1 block">{hint}</span>}
      </label>
      <VariablePicker onInsert={handleInsert} />
    </div>
  );
}
