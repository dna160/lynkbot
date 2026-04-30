/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Flows/FlowEditorPage.tsx
 * Role    : Visual flow editor with Drawflow canvas, node palette, config panel,
 *           and AI generation panel (PRD §13.2).
 *           Uses drawflow@0.0.60 — pinned in package.json.
 *           Nodes with validationErrors shown with red border.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Drawflow from 'drawflow';
import 'drawflow/dist/drawflow.min.css';
import { flowsApi, aiApi } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeType =
  | 'TRIGGER' | 'SEND_TEMPLATE' | 'SEND_TEXT' | 'SEND_INTERACTIVE'
  | 'DELAY' | 'WAIT_FOR_REPLY' | 'IF_CONDITION' | 'KEYWORD_ROUTER'
  | 'TAG_BUYER' | 'UPDATE_BUYER' | 'SEGMENT_QUALITY_GATE' | 'END_FLOW';

interface FlowNode {
  id: string;
  type: NodeType;
  label?: string;
  config: Record<string, unknown>;
  validationErrors?: string[];
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
}

interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface MissingTemplate {
  nodeId: string;
  suggestedName: string;
  suggestedBody: string;
}

type TriggerType = 'inbound_keyword' | 'time_based' | 'order_event' | 'manual';

// ── Node Palette Config ───────────────────────────────────────────────────────

const PALETTE_NODES: Array<{ type: NodeType; label: string; icon: string; color: string }> = [
  { type: 'TRIGGER',               label: 'Trigger',         icon: '⚡', color: '#6366F1' },
  { type: 'SEND_TEMPLATE',         label: 'Send Template',   icon: '📨', color: '#3B82F6' },
  { type: 'SEND_TEXT',             label: 'Send Text',       icon: '💬', color: '#3B82F6' },
  { type: 'SEND_INTERACTIVE',      label: 'Interactive',     icon: '🔘', color: '#8B5CF6' },
  { type: 'DELAY',                 label: 'Delay',           icon: '⏱', color: '#F59E0B' },
  { type: 'WAIT_FOR_REPLY',        label: 'Wait Reply',      icon: '⌛', color: '#F59E0B' },
  { type: 'IF_CONDITION',          label: 'If Condition',    icon: '🔀', color: '#10B981' },
  { type: 'KEYWORD_ROUTER',        label: 'Keyword Router',  icon: '🗝', color: '#10B981' },
  { type: 'TAG_BUYER',             label: 'Tag Buyer',       icon: '🏷', color: '#EC4899' },
  { type: 'UPDATE_BUYER',          label: 'Update Buyer',    icon: '✏️', color: '#EC4899' },
  { type: 'SEGMENT_QUALITY_GATE',  label: 'Quality Gate',    icon: '🛡', color: '#EF4444' },
  { type: 'END_FLOW',              label: 'End Flow',        icon: '🔚', color: '#64748B' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function nodeLabel(type: NodeType, config: Record<string, unknown>): string {
  switch (type) {
    case 'TRIGGER':               return 'Trigger';
    case 'SEND_TEMPLATE':         return `Template: ${config.templateName ?? '?'}`;
    case 'SEND_TEXT':             return `Text: ${String(config.message ?? '').slice(0, 30)}`;
    case 'SEND_INTERACTIVE':      return `Interactive: ${config.type ?? 'button'}`;
    case 'DELAY':                 return `Delay ${config.delayMs ?? 3000}ms`;
    case 'WAIT_FOR_REPLY':        return 'Wait for Reply';
    case 'IF_CONDITION':          return 'If Condition';
    case 'KEYWORD_ROUTER':        return 'Keyword Router';
    case 'TAG_BUYER':             return `Tag: ${config.action ?? 'add'} "${config.tag ?? ''}"`;
    case 'UPDATE_BUYER':          return `Update: ${config.field ?? 'field'}`;
    case 'SEGMENT_QUALITY_GATE':  return 'Quality Gate';
    case 'END_FLOW':              return `End: ${config.reason ?? 'complete'}`;
    default:                      return type;
  }
}

function nodeColor(type: NodeType): string {
  return PALETTE_NODES.find(p => p.type === type)?.color ?? '#475569';
}

/** Convert our FlowDefinition → Drawflow import format */
function toDrawflow(flow: FlowDefinition): object {
  const drawflow: Record<string, { data: Record<string, object> }> = { Home: { data: {} } };
  const nodeMap: Record<string, number> = {};

  flow.nodes.forEach((node, idx) => {
    const dfId = idx + 1;
    nodeMap[node.id] = dfId;
    const hasError = (node.validationErrors?.length ?? 0) > 0;
    drawflow.Home.data[dfId] = {
      id: dfId,
      name: node.type,
      data: { nodeId: node.id, type: node.type, config: node.config, hasError },
      class: hasError ? 'error' : '',
      html: `<div class="df-node-inner" style="border-left:4px solid ${nodeColor(node.type as NodeType)}">
        <div class="df-node-type" style="color:${nodeColor(node.type as NodeType)}">${node.type}</div>
        <div class="df-node-label">${nodeLabel(node.type as NodeType, node.config)}</div>
        ${hasError ? '<div class="df-node-error">⚠ Errors</div>' : ''}
      </div>`,
      typenode: false,
      inputs: node.type === 'TRIGGER' ? {} : { input_1: { connections: [] } },
      outputs: node.type === 'END_FLOW' ? {} : { output_1: { connections: [] } },
      pos_x: 80 + (idx % 4) * 220,
      pos_y: 60 + Math.floor(idx / 4) * 140,
    };
  });

  // Wire edges
  flow.edges.forEach(edge => {
    const srcId = nodeMap[edge.source];
    const tgtId = nodeMap[edge.target];
    if (!srcId || !tgtId) return;
    const srcNode = drawflow.Home.data[srcId] as any;
    const tgtNode = drawflow.Home.data[tgtId] as any;
    if (!srcNode || !tgtNode) return;
    const outKey = 'output_1';
    const inKey  = 'input_1';
    if (!srcNode.outputs[outKey]) srcNode.outputs[outKey] = { connections: [] };
    if (!tgtNode.inputs[inKey])   tgtNode.inputs[inKey]   = { connections: [] };
    srcNode.outputs[outKey].connections.push({ node: String(tgtId), output: inKey });
    tgtNode.inputs[inKey].connections.push({ node: String(srcId), input: outKey });
  });

  return { drawflow };
}

/** Convert Drawflow export → FlowDefinition */
function fromDrawflow(exported: any): FlowDefinition {
  const home = exported?.drawflow?.Home?.data ?? {};
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const idMap: Record<string, string> = {};

  Object.keys(home).forEach(dfId => {
    const n = home[dfId];
    const origId: string = n.data?.nodeId ?? `node_${dfId}`;
    idMap[dfId] = origId;
    nodes.push({
      id: origId,
      type: n.data?.type ?? n.name,
      config: n.data?.config ?? {},
    });
  });

  // Extract edges from outputs
  Object.keys(home).forEach(dfId => {
    const n = home[dfId];
    const srcOrigId = idMap[dfId];
    Object.values<any>(n.outputs ?? {}).forEach((out) => {
      (out.connections ?? []).forEach((conn: any, connIdx: number) => {
        const tgtOrigId = idMap[conn.node];
        if (tgtOrigId) {
          edges.push({ id: `edge_${srcOrigId}_${tgtOrigId}_${connIdx}`, source: srcOrigId, target: tgtOrigId });
        }
      });
    });
  });

  return { nodes, edges };
}

// ── Node Config Editor ────────────────────────────────────────────────────────

interface ConfigEditorProps {
  node: FlowNode | null;
  onChange: (updated: FlowNode) => void;
}

function NodeConfigEditor({ node, onChange }: ConfigEditorProps) {
  if (!node) {
    return (
      <div className="text-center py-8 text-secondary/40 text-xs">
        Click a node to edit its config
      </div>
    );
  }

  const update = (patch: Partial<Record<string, unknown>>) => {
    onChange({ ...node, config: { ...node.config, ...patch } });
  };

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-secondary uppercase tracking-wider">
        {node.type}
      </div>

      {node.type === 'SEND_TEMPLATE' && (
        <>
          <label className="block">
            <span className="text-xs text-secondary">Template Name (snake_case)</span>
            <input
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
              value={String(node.config.templateName ?? '')}
              onChange={e => update({ templateName: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs text-secondary">Language Code</span>
            <input
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={String(node.config.languageCode ?? 'id')}
              onChange={e => update({ languageCode: e.target.value })}
            />
          </label>
        </>
      )}

      {node.type === 'SEND_TEXT' && (
        <label className="block">
          <span className="text-xs text-secondary">Message (use {'{{buyer.name}}'})</span>
          <textarea
            rows={4}
            className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent resize-none"
            value={String(node.config.message ?? '')}
            onChange={e => update({ message: e.target.value })}
          />
        </label>
      )}

      {node.type === 'DELAY' && (
        <label className="block">
          <span className="text-xs text-secondary">Delay (ms, min 500)</span>
          <input
            type="number"
            min={500}
            className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
            value={Number(node.config.delayMs ?? 3000)}
            onChange={e => update({ delayMs: Number(e.target.value) })}
          />
        </label>
      )}

      {node.type === 'WAIT_FOR_REPLY' && (
        <label className="block">
          <span className="text-xs text-secondary">Timeout (ms, optional)</span>
          <input
            type="number"
            min={0}
            className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
            value={Number(node.config.timeoutMs ?? 0)}
            onChange={e => update({ timeoutMs: Number(e.target.value) || undefined })}
          />
        </label>
      )}

      {node.type === 'TAG_BUYER' && (
        <>
          <label className="block">
            <span className="text-xs text-secondary">Action</span>
            <select
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={String(node.config.action ?? 'add')}
              onChange={e => update({ action: e.target.value })}
            >
              <option value="add">Add</option>
              <option value="remove">Remove</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-secondary">Tag</span>
            <input
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={String(node.config.tag ?? '')}
              onChange={e => update({ tag: e.target.value })}
            />
          </label>
        </>
      )}

      {node.type === 'UPDATE_BUYER' && (
        <>
          <label className="block">
            <span className="text-xs text-secondary">Field</span>
            <select
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={String(node.config.field ?? 'displayName')}
              onChange={e => update({ field: e.target.value })}
            >
              <option value="displayName">Display Name</option>
              <option value="notes">Notes</option>
              <option value="preferredLanguage">Preferred Language</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-secondary">Value</span>
            <input
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={String(node.config.value ?? '')}
              onChange={e => update({ value: e.target.value })}
            />
          </label>
        </>
      )}

      {node.type === 'END_FLOW' && (
        <label className="block">
          <span className="text-xs text-secondary">Reason</span>
          <input
            className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
            value={String(node.config.reason ?? '')}
            onChange={e => update({ reason: e.target.value })}
          />
        </label>
      )}

      {node.type === 'KEYWORD_ROUTER' && (
        <label className="block">
          <span className="text-xs text-secondary">Keywords (comma-separated)</span>
          <input
            className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
            value={(Array.isArray(node.config.keywords) ? node.config.keywords : []).join(', ')}
            onChange={e => update({ keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          />
        </label>
      )}

      {node.type === 'TRIGGER' && (
        <p className="text-xs text-secondary/60">Trigger node has no config. Set trigger type in the bottom bar.</p>
      )}

      {node.type === 'SEGMENT_QUALITY_GATE' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(node.config.requireOrders)}
              onChange={e => update({ requireOrders: e.target.checked })}
              className="w-4 h-4 rounded border-border text-accent"
            />
            <span className="text-xs text-secondary">Require at least 1 order</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(node.config.requireInboundHistory)}
              onChange={e => update({ requireInboundHistory: e.target.checked })}
              className="w-4 h-4 rounded border-border text-accent"
            />
            <span className="text-xs text-secondary">Require inbound message history</span>
          </label>
        </div>
      )}

      {(node.validationErrors?.length ?? 0) > 0 && (
        <div className="mt-2 p-2 bg-red-900/20 border border-red-800/40 rounded-lg">
          <div className="text-xs font-semibold text-red-400 mb-1">Validation errors:</div>
          {node.validationErrors!.map((e, i) => (
            <div key={i} className="text-xs text-red-300">• {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<InstanceType<typeof Drawflow> | null>(null);

  const [flowName, setFlowName] = useState('New Flow');
  const [triggerType, setTriggerType] = useState<TriggerType>('inbound_keyword');
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!id);

  // AI Panel state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [missingTemplates, setMissingTemplates] = useState<MissingTemplate[]>([]);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  // Current flow definition (source of truth outside drawflow)
  const [flowDef, setFlowDef] = useState<FlowDefinition>({ nodes: [], edges: [] });

  // ── Init Drawflow ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = new Drawflow(containerRef.current);
    editor.reroute = true;
    editor.start();
    editorRef.current = editor;

    editor.on('nodeSelected', (dfId: number) => {
      const exported = editor.export() as any;
      const nodeData = exported?.drawflow?.Home?.data?.[dfId];
      if (nodeData?.data) {
        setSelectedNode({
          id: nodeData.data.nodeId ?? `node_${dfId}`,
          type: nodeData.data.type,
          config: nodeData.data.config ?? {},
          validationErrors: nodeData.data.hasError ? ['Node has validation errors'] : [],
        });
      }
    });

    editor.on('nodeUnselected', () => setSelectedNode(null));

    return () => {
      try { editor.destroy?.(); } catch { /* ignore */ }
    };
  }, []);

  // ── Load existing flow ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    flowsApi.get(id)
      .then(res => {
        const flow = res.data as any;
        setFlowName(flow.name ?? 'Flow');
        setTriggerType(flow.triggerType ?? 'inbound_keyword');
        const def: FlowDefinition = flow.definition ?? { nodes: [], edges: [] };
        setFlowDef(def);
        if (editorRef.current && def.nodes.length > 0) {
          editorRef.current.clear();
          editorRef.current.import(toDrawflow(def) as any);
        }
      })
      .catch(() => addToast('Failed to load flow', 'error'))
      .finally(() => setLoading(false));
  }, [id, addToast]);

  // ── Load AI-generated flow into canvas ────────────────────────────────────

  const loadFlowIntoCanvas = useCallback((def: FlowDefinition) => {
    if (!editorRef.current) return;
    editorRef.current.clear();
    if (def.nodes.length > 0) {
      editorRef.current.import(toDrawflow(def) as any);
    }
    setFlowDef(def);
  }, []);

  // ── Drag to add node ──────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, type: NodeType) => {
    e.dataTransfer.setData('nodeType', type);
  }, []);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('nodeType') as NodeType;
    if (!type || !editorRef.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const nodeId = `${type.toLowerCase()}_${Date.now()}`;
    const defaultConfig = type === 'DELAY' ? { delayMs: 3000 }
      : type === 'TAG_BUYER' ? { action: 'add', tag: '' }
      : type === 'SEND_TEMPLATE' ? { templateName: '', languageCode: 'id' }
      : type === 'SEND_TEXT' ? { message: '' }
      : {};

    editorRef.current.addNode(
      type,
      type === 'TRIGGER' ? 0 : 1,
      type === 'END_FLOW' ? 0 : 1,
      x, y,
      '',
      { nodeId, type, config: defaultConfig },
      `<div class="df-node-inner" style="border-left:4px solid ${nodeColor(type)}">
         <div class="df-node-type" style="color:${nodeColor(type)}">${type}</div>
         <div class="df-node-label">${nodeLabel(type, defaultConfig)}</div>
       </div>`,
    );
  }, []);

  // ── Update selected node config in Drawflow ───────────────────────────────

  const handleConfigChange = useCallback((updated: FlowNode) => {
    setSelectedNode(updated);
    // Update the node's data in drawflow
    if (editorRef.current) {
      const exported = editorRef.current.export() as any;
      const home = exported?.drawflow?.Home?.data ?? {};
      const dfId = Object.keys(home).find(k => home[k]?.data?.nodeId === updated.id);
      if (dfId) {
        editorRef.current.updateNodeDataFromId(Number(dfId), { ...home[dfId].data, config: updated.config });
      }
    }
  }, []);

  // ── AI Generate ───────────────────────────────────────────────────────────

  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiWarnings([]);
    setMissingTemplates([]);
    try {
      const res = await aiApi.generateFlow({ prompt: aiPrompt });
      const data = res.data as any;
      loadFlowIntoCanvas(data.flowDefinition ?? { nodes: [], edges: [] });
      setAiWarnings(data.warnings ?? []);
      setMissingTemplates(data.missingTemplates ?? []);
      if (data.parseError) addToast(`Parse warning: ${data.parseError}`, 'error');
      else addToast('Flow generated — review and save as draft', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'AI generation failed', 'error');
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, loadFlowIntoCanvas, addToast]);

  // ── AI Modify ─────────────────────────────────────────────────────────────

  const handleAiModify = useCallback(async () => {
    if (!id || !aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const res = await aiApi.modifyFlow({ flowId: id, instruction: aiPrompt });
      const data = res.data as any;
      loadFlowIntoCanvas(data.flowDefinition ?? { nodes: [], edges: [] });
      setAiWarnings(data.warnings ?? []);
      setMissingTemplates(data.missingTemplates ?? []);
      addToast('Flow modified — review and save', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'AI modification failed', 'error');
    } finally {
      setAiLoading(false);
    }
  }, [id, aiPrompt, loadFlowIntoCanvas, addToast]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    setSaving(true);
    try {
      const exported = editorRef.current.export();
      const definition = fromDrawflow(exported);

      if (id) {
        await flowsApi.update(id, { name: flowName, triggerType, definition } as any);
        addToast('Flow saved', 'success');
      } else {
        const res = await flowsApi.create({ name: flowName, triggerType, definition } as any);
        const newId = (res.data as any)?.id;
        addToast('Flow created', 'success');
        if (newId) navigate(`/dashboard/flows/${newId}/edit`, { replace: true });
      }
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [id, flowName, triggerType, navigate, addToast]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Bottom bar (flow metadata) */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border bg-surface shrink-0">
        <input
          className="bg-transparent border-b border-border text-primary font-semibold text-sm focus:outline-none focus:border-accent px-1 py-0.5 w-56"
          value={flowName}
          onChange={e => setFlowName(e.target.value)}
          placeholder="Flow name…"
        />
        <select
          value={triggerType}
          onChange={e => setTriggerType(e.target.value as TriggerType)}
          className="bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent"
        >
          <option value="inbound_keyword">Keyword Trigger</option>
          <option value="time_based">Scheduled</option>
          <option value="order_event">Order Event</option>
          <option value="manual">Manual</option>
        </select>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setAiPanelOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent border border-accent/40 rounded-lg hover:bg-accent/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            {aiPanelOpen ? 'Close AI' : 'AI Assistant'}
          </button>
          <button
            onClick={() => navigate('/dashboard/flows')}
            className="px-3 py-1.5 text-xs text-secondary hover:text-primary border border-border rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : id ? 'Save' : 'Create Draft'}
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Node Palette */}
        <div className="w-48 shrink-0 bg-surface border-r border-border overflow-y-auto py-3 px-2">
          <div className="text-[10px] font-semibold text-secondary uppercase tracking-wider px-2 mb-2">Nodes</div>
          {PALETTE_NODES.map(p => (
            <div
              key={p.type}
              draggable
              onDragStart={e => handleDragStart(e, p.type)}
              className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-grab hover:bg-white/5 active:cursor-grabbing transition-colors mb-1 select-none"
            >
              <span className="text-base leading-none">{p.icon}</span>
              <div>
                <div className="text-xs text-primary font-medium leading-tight">{p.label}</div>
                <div className="text-[10px] text-secondary/60 font-mono">{p.type}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Center: Canvas */}
        <div
          className="flex-1 relative overflow-hidden bg-[#0B1120]"
          onDragOver={e => e.preventDefault()}
          onDrop={handleCanvasDrop}
        >
          {/* Drawflow custom CSS (overrides) */}
          <style>{`
            .drawflow { background: #0B1120; }
            .drawflow .drawflow-node { background: #1E293B; border: 1px solid #334155; border-radius: 8px; padding: 0; overflow: hidden; min-width: 180px; }
            .drawflow .drawflow-node.selected { border-color: #6366F1; box-shadow: 0 0 0 2px rgba(99,102,241,0.3); }
            .drawflow .drawflow-node.error { border-color: #EF4444 !important; }
            .df-node-inner { padding: 8px 10px; }
            .df-node-type { font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
            .df-node-label { font-size: 11px; color: #CBD5E1; line-height: 1.4; }
            .df-node-error { font-size: 9px; color: #F87171; margin-top: 3px; }
            .drawflow .input, .drawflow .output { background: #6366F1; border: 2px solid #4F46E5; width: 10px; height: 10px; }
            .drawflow .connection .main-path { stroke: #6366F1; stroke-width: 2px; }
          `}</style>

          {flowDef.nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <svg className="w-12 h-12 text-secondary/20 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-secondary/40 text-sm">Drag nodes from the palette or generate with AI</p>
            </div>
          )}

          <div ref={containerRef} className="w-full h-full" />
        </div>

        {/* Right panels */}
        <div className="w-64 shrink-0 border-l border-border bg-surface flex flex-col">
          {/* AI Panel */}
          {aiPanelOpen && (
            <div className="border-b border-border p-3">
              <div className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">AI Generate</div>
              <textarea
                rows={3}
                placeholder="Describe the flow you want to build…"
                className="w-full bg-[#0F172A] border border-border rounded-lg px-2 py-2 text-xs text-primary resize-none focus:outline-none focus:border-accent"
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleAiGenerate}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="flex-1 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors"
                >
                  {aiLoading ? 'Generating…' : 'Generate'}
                </button>
                {id && (
                  <button
                    onClick={handleAiModify}
                    disabled={aiLoading || !aiPrompt.trim()}
                    className="flex-1 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-500 disabled:opacity-40 transition-colors"
                  >
                    {aiLoading ? 'Modifying…' : 'Modify'}
                  </button>
                )}
              </div>

              {/* Warnings */}
              {aiWarnings.length > 0 && (
                <div className="mt-2 p-2 bg-yellow-900/20 border border-yellow-800/40 rounded-lg">
                  <div className="text-[10px] font-semibold text-yellow-400 mb-1">Compliance warnings:</div>
                  {aiWarnings.map((w, i) => (
                    <div key={i} className="text-[10px] text-yellow-300">• {w}</div>
                  ))}
                </div>
              )}

              {/* Missing Templates */}
              {missingTemplates.length > 0 && (
                <div className="mt-2 p-2 bg-blue-900/20 border border-blue-800/40 rounded-lg">
                  <div className="text-[10px] font-semibold text-blue-400 mb-1">Templates to create:</div>
                  {missingTemplates.map((t, i) => (
                    <div key={i} className="text-[10px] text-blue-300">• {t.suggestedName}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Node Config Panel */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">
              {selectedNode ? 'Node Config' : 'Properties'}
            </div>
            <NodeConfigEditor node={selectedNode} onChange={handleConfigChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
