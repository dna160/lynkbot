import type { Node, Edge } from '@xyflow/react';
import type { FlowDefinition, FlowNode, FlowEdge, NodeType } from '@/types/flow';

export interface RFNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  label?: string;
  config: Record<string, unknown>;
}

export type RFNode = Node<RFNodeData, 'flowNode'>;
export type RFEdge = Edge<Record<string, unknown>>;

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;
const H_GAP = 60;
const V_GAP = 40;

/** Assign simple cascade positions when no layout data is available. */
function cascadePositions(nodes: FlowNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    positions.set(n.id, { x: 100, y: 80 + i * (NODE_HEIGHT + V_GAP) });
  });
  return positions;
}

export function toRFNodes(nodes: FlowNode[]): RFNode[] {
  const pos = cascadePositions(nodes);
  return nodes.map((n) => ({
    id: n.id,
    type: 'flowNode' as const,
    position: pos.get(n.id) ?? { x: 100, y: 100 },
    data: {
      nodeType: n.type,
      label: n.label,
      config: n.config ?? {},
    },
  }));
}

export function toRFEdges(edges: FlowEdge[]): RFEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
    type: 'deletable',
  }));
}

export function fromRFNodes(rfNodes: RFNode[]): FlowNode[] {
  return rfNodes.map((n) => ({
    id: n.id,
    type: n.data.nodeType,
    label: n.data.label,
    config: n.data.config,
  }));
}

export function fromRFEdges(rfEdges: RFEdge[]): FlowEdge[] {
  return rfEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourcePort: e.sourceHandle } : {}),
  }));
}

export function toFlowDefinition(rfNodes: RFNode[], rfEdges: RFEdge[]): FlowDefinition {
  return { nodes: fromRFNodes(rfNodes), edges: fromRFEdges(rfEdges) };
}

export function fromFlowDefinition(def: FlowDefinition): { rfNodes: RFNode[]; rfEdges: RFEdge[] } {
  return { rfNodes: toRFNodes(def.nodes), rfEdges: toRFEdges(def.edges) };
}

export { NODE_WIDTH, NODE_HEIGHT, H_GAP, V_GAP };
