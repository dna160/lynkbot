import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeMouseHandler,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { RFNode, RFEdge } from '@/lib/flowConvert';
import type { NodeType } from '@/types/flow';
import { FlowNode } from './nodes/FlowNode';
import { CustomEdge } from './CustomEdge';

interface FlowCanvasProps {
  nodes: RFNode[];
  edges: RFEdge[];
  onNodesChange: OnNodesChange<RFNode>;
  onEdgesChange: OnEdgesChange<RFEdge>;
  onConnect: OnConnect;
  onNodeClick: NodeMouseHandler<RFNode>;
  onPaneClick: () => void;
  onAddStep: (sourceNodeId: string, screenX: number, screenY: number) => void;
}

export function FlowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onPaneClick,
  onAddStep,
}: FlowCanvasProps) {
  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      flowNode: (props) => (
        <FlowNode {...(props as Parameters<typeof FlowNode>[0])} onAddStep={onAddStep} />
      ),
    }),
    [onAddStep],
  );

  const edgeTypes = useMemo<EdgeTypes>(
    () => ({ deletable: CustomEdge }),
    [],
  );

  return (
    <div className="w-full h-full bg-[#0B1120]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange as OnNodesChange<Node>}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick as NodeMouseHandler<Node>}
        onPaneClick={onPaneClick}
        deleteKeyCode="Delete"
        fitView
        fitViewOptions={{ padding: 0.3 }}
        defaultEdgeOptions={{ type: 'deletable' }}
        minZoom={0.25}
        maxZoom={2}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#1E293B"
        />
        <Controls
          className="[&_.react-flow__controls-button]:bg-slate-800 [&_.react-flow__controls-button]:border-slate-700 [&_.react-flow__controls-button]:text-slate-400 [&_.react-flow__controls-button:hover]:bg-slate-700"
          showInteractive={false}
        />
        <MiniMap
          className="!bg-slate-900 !border-slate-700 rounded-lg overflow-hidden"
          nodeColor={(n) => {
            const nodeType = (n as RFNode).data?.nodeType as NodeType | undefined;
            if (!nodeType) return '#334155';
            const colors: Partial<Record<NodeType, string>> = {
              TRIGGER: '#6366F1',
              SEND_TEXT: '#3B82F6',
              SEND_TEMPLATE: '#3B82F6',
              IF_CONDITION: '#10B981',
              END_FLOW: '#64748B',
              START_SCHEDULING: '#0EA5E9',
              ACTIVATE_PLAYBOOK: '#A855F7',
            };
            return colors[nodeType] ?? '#334155';
          }}
          maskColor="rgba(11, 17, 32, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
