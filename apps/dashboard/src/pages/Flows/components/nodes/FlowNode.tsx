import { useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node, useReactFlow } from '@xyflow/react';
import type { RFNodeData } from '@/lib/flowConvert';
import { PALETTE_NODES, nodeSourceHandles, nodeHasTargetHandle, nodePreview } from './nodeConfig';

export type FlowNodeType = Node<RFNodeData, 'flowNode'>;

interface FlowNodeProps extends NodeProps<FlowNodeType> {
  onAddStep?: (nodeId: string, screenX: number, screenY: number) => void;
}

export function FlowNode({ id, data, selected, onAddStep }: FlowNodeProps) {
  const { getNode } = useReactFlow();
  const palette = PALETTE_NODES.find((p) => p.type === data.nodeType);
  if (!palette) return null;

  const hasTarget = nodeHasTargetHandle(data.nodeType);
  const sourceHandles = nodeSourceHandles(data.nodeType);
  const preview = nodePreview(data.nodeType, data.config);
  const isBranching = data.nodeType === 'IF_CONDITION' || data.nodeType === 'KEYWORD_ROUTER';

  const handleAddStep = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const node = getNode(id);
      if (!node || !onAddStep) return;
      onAddStep(id, e.clientX, e.clientY);
    },
    [id, getNode, onAddStep],
  );

  const borderColor = selected ? palette.color : 'transparent';

  return (
    <div
      className="relative bg-[#1E293B] rounded-xl shadow-lg transition-all"
      style={{
        width: 220,
        border: `2px solid ${selected ? palette.color : '#334155'}`,
        boxShadow: selected ? `0 0 0 3px ${palette.color}30` : undefined,
      }}
    >
      {/* Target handle */}
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-slate-600 !border-slate-500 hover:!bg-slate-400 transition-colors"
        />
      )}

      {/* Header */}
      <div
        className="px-3 py-2 rounded-t-xl flex items-center gap-2"
        style={{ background: `${palette.color}18`, borderBottom: `1px solid ${palette.color}30` }}
      >
        <span className="text-base leading-none">{palette.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold truncate" style={{ color: palette.color }}>
            {palette.label}
          </div>
          {data.label && data.label !== palette.label && (
            <div className="text-[10px] text-secondary/60 truncate">{data.label}</div>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="px-3 py-2 min-h-[28px]">
        <p className="text-[11px] text-secondary/70 leading-snug line-clamp-2">
          {preview || <span className="italic opacity-40">Not configured</span>}
        </p>
      </div>

      {/* Branch labels for conditional nodes */}
      {isBranching && (
        <div className="px-3 pb-2 flex justify-between text-[9px] font-bold uppercase tracking-wider">
          <span className="text-emerald-400">
            {data.nodeType === 'IF_CONDITION' ? '✓ Yes' : 'Match'}
          </span>
          <span className="text-red-400">
            {data.nodeType === 'IF_CONDITION' ? '✗ No' : 'Other'}
          </span>
        </div>
      )}

      {/* Add step button (single-output nodes only) */}
      {sourceHandles.length === 1 && onAddStep && (
        <div className="px-3 pb-2.5">
          <button
            onMouseDown={handleAddStep}
            className="w-full text-[10px] font-medium text-secondary/50 hover:text-secondary border border-dashed border-slate-700 hover:border-slate-500 rounded-lg py-1 transition-colors"
          >
            ＋ Add step
          </button>
        </div>
      )}

      {/* Source handles */}
      {isBranching ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id={sourceHandles[0]}
            style={{ left: '28%' }}
            className="!w-3 !h-3 !bg-emerald-600 !border-emerald-500 hover:!bg-emerald-400 transition-colors"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id={sourceHandles[1]}
            style={{ left: '72%' }}
            className="!w-3 !h-3 !bg-red-600 !border-red-500 hover:!bg-red-400 transition-colors"
          />
        </>
      ) : sourceHandles.length === 1 ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id={sourceHandles[0]}
          className="!w-3 !h-3 !bg-slate-600 !border-slate-500 hover:!bg-slate-400 transition-colors"
        />
      ) : null}
    </div>
  );
}
