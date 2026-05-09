import type { NodeType } from '@/types/flow';
import { PALETTE_NODES, CATEGORY_LABELS } from './nodes/nodeConfig';

interface NodePickerPopupProps {
  x: number;
  y: number;
  onPick: (type: NodeType) => void;
  onClose: () => void;
}

export function NodePickerPopup({ x, y, onPick, onClose }: NodePickerPopupProps) {
  const pickable = PALETTE_NODES.filter((p) => p.type !== 'TRIGGER');
  const categories = [...new Set(pickable.map((p) => p.category))];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-[#1E293B] border border-border rounded-xl shadow-2xl overflow-hidden w-60"
        style={{
          left: Math.min(x, window.innerWidth - 256),
          top: Math.min(y, window.innerHeight - 400),
        }}
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
            Add Next Step
          </span>
          <button
            onClick={onClose}
            className="text-secondary/40 hover:text-secondary transition-colors text-xs"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto max-h-80">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="px-3 pt-3 pb-1 text-[9px] font-bold text-secondary/50 uppercase tracking-widest">
                {CATEGORY_LABELS[cat]}
              </div>
              {pickable
                .filter((p) => p.category === cat)
                .map((p) => (
                  <button
                    key={p.type}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left transition-colors"
                    onMouseDown={(e) => { e.stopPropagation(); onPick(p.type); }}
                  >
                    <span className="text-base w-5 text-center leading-none shrink-0">
                      {p.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-primary leading-tight">{p.label}</div>
                      <div className="text-[10px] text-secondary/50 truncate">{p.description}</div>
                    </div>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
