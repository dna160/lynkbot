import { useState, useCallback } from 'react';
import { addEdge, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { Connection, NodeChange, EdgeChange } from '@xyflow/react';
import type { FlowNode, FlowDefinition } from '@/types/flow';
import type { NodeType } from '@/types/flow';
import type { RFNode, RFEdge } from '@/lib/flowConvert';
import { fromFlowDefinition, toFlowDefinition } from '@/lib/flowConvert';

type TriggerType = 'inbound_keyword' | 'time_based' | 'order_event' | 'manual';

let nodeCounter = 1000;
function nextNodeId() {
  return `node_${++nodeCounter}`;
}

export function useFlowEditor(initialDef?: FlowDefinition) {
  const init = initialDef
    ? fromFlowDefinition(initialDef)
    : { rfNodes: [], rfEdges: [] };

  const [rfNodes, setRFNodes] = useState<RFNode[]>(init.rfNodes);
  const [rfEdges, setRFEdges] = useState<RFEdge[]>(init.rfEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [triggerType, setTriggerType] = useState<TriggerType>('inbound_keyword');

  const selectedFlowNode: FlowNode | null = (() => {
    if (!selectedNodeId) return null;
    const rfNode = rfNodes.find((n) => n.id === selectedNodeId);
    if (!rfNode) return null;
    return {
      id: rfNode.id,
      type: rfNode.data.nodeType,
      label: rfNode.data.label,
      config: rfNode.data.config,
    };
  })();

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      setRFNodes((nds) => applyNodeChanges(changes, nds));
    },
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RFEdge>[]) => {
      setRFEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setRFEdges((eds) =>
        addEdge({ ...connection, type: 'deletable' }, eds) as RFEdge[],
      );
    },
    [],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const addNode = useCallback(
    (type: NodeType, sourceNodeId?: string): string => {
      const id = nextNodeId();
      const sourceNode = rfNodes.find((n) => n.id === sourceNodeId);
      const position = sourceNode
        ? { x: sourceNode.position.x, y: sourceNode.position.y + 160 }
        : { x: 100, y: 100 + rfNodes.length * 160 };

      const newNode: RFNode = {
        id,
        type: 'flowNode',
        position,
        data: {
          nodeType: type,
          config: {},
        },
      };

      setRFNodes((nds) => [...nds, newNode]);

      // Auto-connect from source node's single output handle
      if (sourceNodeId) {
        const edgeId = `e_${sourceNodeId}_${id}`;
        setRFEdges((eds) => [
          ...eds,
          { id: edgeId, source: sourceNodeId, target: id, sourceHandle: 'output', type: 'deletable' },
        ]);
      }

      setSelectedNodeId(id);
      return id;
    },
    [rfNodes],
  );

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setRFNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setRFEdges((eds) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
    );
    setSelectedNodeId(null);
  }, [selectedNodeId]);

  const updateSelectedNodeConfig = useCallback(
    (updated: FlowNode) => {
      setRFNodes((nds) =>
        nds.map((n) =>
          n.id === updated.id
            ? { ...n, data: { ...n.data, config: updated.config, label: updated.label } }
            : n,
        ),
      );
      // Sync triggerType from TRIGGER node config
      if (updated.type === 'TRIGGER' && updated.config.triggerType) {
        setTriggerType(updated.config.triggerType as TriggerType);
      }
    },
    [],
  );

  const loadDefinition = useCallback((def: FlowDefinition) => {
    const { rfNodes: newNodes, rfEdges: newEdges } = fromFlowDefinition(def);
    setRFNodes(newNodes);
    setRFEdges(newEdges);
    setSelectedNodeId(null);

    // Extract triggerType from TRIGGER node
    const triggerNode = def.nodes.find((n) => n.type === 'TRIGGER');
    if (triggerNode?.config.triggerType) {
      setTriggerType(triggerNode.config.triggerType as TriggerType);
    }
  }, []);

  const getDefinition = useCallback((): FlowDefinition => {
    // Sync triggerType back into TRIGGER node config
    const syncedNodes = rfNodes.map((n) => {
      if (n.data.nodeType === 'TRIGGER') {
        return {
          ...n,
          data: {
            ...n.data,
            config: { ...n.data.config, triggerType },
          },
        };
      }
      return n;
    });
    return toFlowDefinition(syncedNodes, rfEdges);
  }, [rfNodes, rfEdges, triggerType]);

  return {
    rfNodes,
    setRFNodes,
    rfEdges,
    setRFEdges,
    selectedNodeId,
    setSelectedNodeId,
    selectedFlowNode,
    triggerType,
    setTriggerType,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    onPaneClick,
    addNode,
    deleteSelectedNode,
    updateSelectedNodeConfig,
    loadDefinition,
    getDefinition,
  };
}
