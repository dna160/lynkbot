import { useCallback } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { RFNode, RFEdge } from '@/lib/flowConvert';
import { NODE_WIDTH, NODE_HEIGHT } from '@/lib/flowConvert';

const elk = new ELK();

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.spacing.nodeNode': '40',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
};

export function useELKLayout() {
  const autoLayout = useCallback(async (nodes: RFNode[], edges: RFEdge[]): Promise<RFNode[]> => {
    if (nodes.length === 0) return nodes;

    const graph = {
      id: 'root',
      layoutOptions: ELK_OPTIONS,
      children: nodes.map((n) => ({
        id: n.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT + (
          n.data.nodeType === 'SEND_INTERACTIVE' ? 30 : 0
        ),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    const layout = await elk.layout(graph);

    return nodes.map((n) => {
      const laid = layout.children?.find((c) => c.id === n.id);
      if (laid?.x == null || laid?.y == null) return n;
      return { ...n, position: { x: laid.x, y: laid.y } };
    });
  }, []);

  return { autoLayout };
}
