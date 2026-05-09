import { useState } from 'react';

const VARIABLE_GROUPS: Array<{
  label: string;
  emoji: string;
  color: string;
  vars: Array<{ label: string; token: string; hint: string }>;
}> = [
  {
    label: 'Buyer',
    emoji: '👤',
    color: '#3B82F6',
    vars: [
      { label: 'Name',      token: '{{buyer.name}}',        hint: "Buyer's display name" },
      { label: 'Phone',     token: '{{buyer.phone}}',       hint: 'WhatsApp number' },
      { label: '# Orders',  token: '{{buyer.totalOrders}}', hint: 'Total order count' },
      { label: 'Tags',      token: '{{buyer.tags}}',        hint: 'Comma-separated tags' },
      { label: 'Language',  token: '{{buyer.language}}',    hint: 'Preferred language code' },
      { label: 'Notes',     token: '{{buyer.notes}}',       hint: 'Buyer notes field' },
    ],
  },
  {
    label: 'Order',
    emoji: '📦',
    color: '#10B981',
    vars: [
      { label: 'Order Code', token: '{{order.code}}', hint: 'Current order reference code' },
    ],
  },
  {
    label: 'Conversation',
    emoji: '💬',
    color: '#F59E0B',
    vars: [
      { label: 'Last Reply', token: '{{trigger.message}}', hint: "What the buyer just typed" },
    ],
  },
];

export function VariablePicker({ onInsert }: { onInsert: (token: string) => void }) {
  const [customVar, setCustomVar] = useState('');

  return (
    <div className="mt-2 rounded-lg border border-border/50 bg-white/[0.02] p-3 space-y-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-secondary/50">
        Insert variable
      </div>

      {VARIABLE_GROUPS.map((group) => (
        <div key={group.label}>
          <div
            className="text-[9px] font-bold uppercase tracking-widest mb-1.5"
            style={{ color: group.color }}
          >
            {group.emoji} {group.label}
          </div>
          <div className="flex flex-wrap gap-1">
            {group.vars.map((v) => (
              <button
                key={v.token}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onInsert(v.token); }}
                title={`${v.token} — ${v.hint}`}
                className="px-2 py-0.5 text-[11px] font-mono rounded-md border transition-all hover:scale-105 active:scale-95"
                style={{
                  borderColor: `${group.color}40`,
                  color: group.color,
                  background: `${group.color}12`,
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5 text-purple-400">
          ✦ Custom variable
        </div>
        <div className="flex gap-1.5">
          <input
            className="flex-1 bg-[#0F172A] border border-border rounded-md px-2 py-1 text-[11px] text-primary font-mono focus:outline-none focus:border-purple-500/60 placeholder-secondary/30"
            placeholder="variable_name"
            value={customVar}
            onChange={(e) => setCustomVar(e.target.value.replace(/[\s{}]/g, '_'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customVar.trim()) {
                e.preventDefault();
                onInsert(`{{flow.variable.${customVar.trim()}}}`);
                setCustomVar('');
              }
            }}
          />
          <button
            type="button"
            disabled={!customVar.trim()}
            onMouseDown={(e) => {
              e.preventDefault();
              if (customVar.trim()) {
                onInsert(`{{flow.variable.${customVar.trim()}}}`);
                setCustomVar('');
              }
            }}
            className="px-2.5 py-1 text-[11px] rounded-md border border-purple-700/40 bg-purple-900/20 text-purple-400 hover:bg-purple-900/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Insert
          </button>
        </div>
        <span className="text-[9px] text-secondary/40 mt-1 block">
          Resolves to{' '}
          <span className="font-mono">{'{{flow.variable.name}}'}</span> at runtime.
        </span>
      </div>
    </div>
  );
}
