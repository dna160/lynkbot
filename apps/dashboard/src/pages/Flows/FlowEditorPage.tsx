import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { flowsApi, aiApi } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import type { FlowDefinition } from '@/types/flow';
import type { NodeType } from '@/types/flow';
import { useFlowEditor } from '@/hooks/useFlowEditor';
import { useELKLayout } from '@/hooks/useELKLayout';
import { FlowCanvas } from './components/FlowCanvas';
import { NodePickerPopup } from './components/NodePickerPopup';
import { NodeConfigEditor } from './components/NodeConfigEditor';
import { PALETTE_NODES, CATEGORY_LABELS } from './components/nodes/nodeConfig';

type TriggerType = 'inbound_keyword' | 'time_based' | 'order_event' | 'manual';
type FlowStatus = 'draft' | 'active' | 'paused' | 'archived';

interface MissingTemplate {
  nodeId: string;
  suggestedName: string;
  suggestedBody: string;
}

function FlowEditorInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [flowName, setFlowName] = useState('New Flow');
  const [flowStatus, setFlowStatus] = useState<FlowStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [missingTemplates, setMissingTemplates] = useState<MissingTemplate[]>([]);

  const [picker, setPicker] = useState<{ x: number; y: number; sourceNodeId: string } | null>(null);

  const {
    rfNodes,
    setRFNodes,
    rfEdges,
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
  } = useFlowEditor();

  const { autoLayout } = useELKLayout();

  // ── Load existing flow ────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    flowsApi
      .get(id)
      .then((res) => {
        const flow = res.data as any;
        setFlowName(flow.name ?? 'Flow');
        setFlowStatus(flow.status ?? 'draft');
        const def: FlowDefinition = flow.definition ?? { nodes: [], edges: [] };
        loadDefinition(def);
        if (flow.triggerType) setTriggerType(flow.triggerType as TriggerType);
      })
      .catch(() => addToast('Failed to load flow', 'error'))
      .finally(() => setLoading(false));
  }, [id, addToast, loadDefinition, setTriggerType]);

  // ── Add node from palette ─────────────────────────────────────────────────

  const handlePaletteClick = useCallback(
    (type: NodeType) => {
      addNode(type);
    },
    [addNode],
  );

  // ── Add step from node's "+ Add step" button ──────────────────────────────

  const handleAddStep = useCallback(
    (sourceNodeId: string, screenX: number, screenY: number) => {
      setPicker({ x: screenX + 8, y: screenY, sourceNodeId });
    },
    [],
  );

  const handlePickerAdd = useCallback(
    (type: NodeType) => {
      if (!picker) return;
      addNode(type, picker.sourceNodeId);
      setPicker(null);
    },
    [picker, addNode],
  );

  // ── Auto-layout ───────────────────────────────────────────────────────────

  const handleAutoLayout = useCallback(async () => {
    try {
      const laid = await autoLayout(rfNodes, rfEdges);
      setRFNodes(laid);
    } catch {
      addToast('Auto-layout failed', 'error');
    }
  }, [rfNodes, rfEdges, autoLayout, setRFNodes, addToast]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const definition = getDefinition();
      const triggerNode = definition.nodes.find((n) => n.type === 'TRIGGER');
      const triggerConfig: Record<string, unknown> = { triggerType };
      if (triggerType === 'inbound_keyword' && triggerNode) {
        triggerConfig.keywords = Array.isArray(triggerNode.config?.keywords)
          ? triggerNode.config.keywords
          : [];
      }

      if (id) {
        await flowsApi.update(id, {
          name: flowName,
          triggerType,
          triggerConfig,
          definition,
        } as any);
        addToast('Flow saved', 'success');
      } else {
        const res = await flowsApi.create({
          name: flowName,
          triggerType,
          definition,
        } as any);
        const newId = (res.data as any)?.id;
        addToast('Flow created', 'success');
        if (newId) navigate(`/dashboard/flows/${newId}/edit`, { replace: true });
      }
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [id, flowName, triggerType, getDefinition, navigate, addToast]);

  // ── Activate / Pause ──────────────────────────────────────────────────────

  const handleActivate = useCallback(async () => {
    if (!id) return;
    setActivating(true);
    try {
      await flowsApi.updateStatus(id, 'active');
      setFlowStatus('active');
      addToast('Flow activated', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Activation failed', 'error');
    } finally {
      setActivating(false);
    }
  }, [id, addToast]);

  const handlePause = useCallback(async () => {
    if (!id) return;
    setActivating(true);
    try {
      await flowsApi.updateStatus(id, 'paused');
      setFlowStatus('paused');
      addToast('Flow paused', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Pause failed', 'error');
    } finally {
      setActivating(false);
    }
  }, [id, addToast]);

  // ── AI Generate ───────────────────────────────────────────────────────────

  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiWarnings([]);
    setMissingTemplates([]);
    try {
      const res = await aiApi.generateFlow({ prompt: aiPrompt });
      const data = res.data as any;
      const def: FlowDefinition = data.flowDefinition ?? { nodes: [], edges: [] };
      if (!def.nodes || def.nodes.length === 0) {
        addToast('AI returned an empty flow — try rephrasing your prompt', 'error');
        return;
      }
      loadDefinition(def);
      setAiWarnings(data.warnings ?? []);
      setMissingTemplates(data.missingTemplates ?? []);
      addToast('Flow generated — review and save', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'AI generation failed', 'error');
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, loadDefinition, addToast]);

  const handleAiModify = useCallback(async () => {
    if (!id || !aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const res = await aiApi.modifyFlow({ flowId: id, instruction: aiPrompt });
      const data = res.data as any;
      loadDefinition(data.flowDefinition ?? { nodes: [], edges: [] });
      setAiWarnings(data.warnings ?? []);
      setMissingTemplates(data.missingTemplates ?? []);
      addToast('Flow modified — review and save', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'AI modification failed', 'error');
    } finally {
      setAiLoading(false);
    }
  }, [id, aiPrompt, loadDefinition, addToast]);

  const categories = [...new Set(PALETTE_NODES.map((p) => p.category))];

  return (
    <div className="flex flex-col h-full relative">
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0F172A]/70 backdrop-blur-sm">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-surface shrink-0">
        <input
          className="bg-transparent text-primary font-semibold text-sm focus:outline-none focus:border-b focus:border-accent px-1 py-0.5 min-w-0 w-44"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          placeholder="Flow name…"
        />
        {flowStatus && (
          <span
            className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              flowStatus === 'active'
                ? 'bg-green-900/40 text-green-400'
                : flowStatus === 'paused'
                  ? 'bg-yellow-900/40 text-yellow-400'
                  : flowStatus === 'archived'
                    ? 'bg-red-900/40 text-red-400'
                    : 'bg-slate-700 text-slate-300'
            }`}
          >
            {flowStatus.charAt(0).toUpperCase() + flowStatus.slice(1)}
          </span>
        )}
        <div className="h-4 w-px bg-border shrink-0" />
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as TriggerType)}
          className="bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent shrink-0"
        >
          <option value="inbound_keyword">⚡ Keyword Trigger</option>
          <option value="time_based">🕐 Scheduled</option>
          <option value="order_event">📦 Order Event</option>
          <option value="manual">✋ Manual</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleAutoLayout}
            title="Auto-layout (ELK)"
            className="p-1.5 text-secondary/60 hover:text-secondary border border-border/50 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 6h16M4 12h8m-8 6h16" />
            </svg>
          </button>
          <button
            onClick={() => setAiPanelOpen((o) => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
              aiPanelOpen
                ? 'bg-accent text-white border-accent'
                : 'text-accent border-accent/40 hover:bg-accent/10'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI
          </button>
          <button
            onClick={() => navigate('/dashboard/flows')}
            className="px-3 py-1.5 text-xs text-secondary hover:text-primary border border-border rounded-lg transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold bg-accent/20 text-accent border border-accent/40 rounded-lg hover:bg-accent/30 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : id ? 'Save' : 'Create Draft'}
          </button>
          {id && (flowStatus === 'draft' || flowStatus === 'paused') && (
            <button
              onClick={async () => { await handleSave(); await handleActivate(); }}
              disabled={saving || activating}
              className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {activating ? 'Activating…' : '▶ Activate'}
            </button>
          )}
          {id && flowStatus === 'active' && (
            <button
              onClick={handlePause}
              disabled={activating}
              className="px-4 py-1.5 text-xs font-semibold bg-yellow-600/20 text-yellow-400 border border-yellow-600/40 rounded-lg hover:bg-yellow-600/30 disabled:opacity-50 transition-colors"
            >
              {activating ? '…' : '⏸ Pause'}
            </button>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Node palette */}
        <div className="w-52 shrink-0 bg-surface border-r border-border overflow-y-auto py-3">
          <div className="px-3 mb-2 text-[9px] font-bold text-secondary/50 uppercase tracking-widest">
            Nodes
          </div>
          {categories.map((cat) => (
            <div key={cat}>
              <div className="px-3 pt-2 pb-0.5 text-[9px] font-bold text-secondary/40 uppercase tracking-widest">
                {CATEGORY_LABELS[cat]}
              </div>
              {PALETTE_NODES.filter((p) => p.category === cat).map((p) => (
                <button
                  key={p.type}
                  onClick={() => handlePaletteClick(p.type)}
                  className="w-full flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-white/5 active:bg-white/10 transition-colors mb-0.5 select-none group text-left"
                  title={`Add ${p.label}`}
                  style={{ width: 'calc(100% - 16px)' }}
                >
                  <span className="text-base leading-none w-5 text-center shrink-0">{p.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs text-primary font-medium leading-tight truncate">
                      {p.label}
                    </div>
                    <div className="text-[9px] text-secondary/50 leading-tight truncate">
                      {p.description}
                    </div>
                  </div>
                  <svg
                    className="w-3 h-3 text-secondary/20 group-hover:text-secondary/40 shrink-0 ml-auto"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ))}
            </div>
          ))}
          <div className="mx-3 mt-3 pt-3 border-t border-border">
            <p className="text-[9px] text-secondary/30 leading-relaxed">
              Click to add · Drag from handles to connect · Delete key removes selection
            </p>
          </div>
        </div>

        {/* Center: React Flow canvas */}
        <div className="flex-1 relative min-w-0">
          <FlowCanvas
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onAddStep={handleAddStep}
          />
        </div>

        {/* Right: AI + Config panels */}
        <div className="w-72 shrink-0 border-l border-border bg-surface flex flex-col">
          {/* AI Panel */}
          {aiPanelOpen && (
            <div className="border-b border-border p-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">
                  AI Assistant
                </div>
                <button
                  onClick={() => setAiPanelOpen(false)}
                  className="text-secondary/40 hover:text-secondary text-xs"
                >
                  ✕
                </button>
              </div>
              <textarea
                rows={3}
                placeholder="Describe the flow you want to build…"
                className="w-full bg-[#0F172A] border border-border rounded-lg px-2 py-2 text-xs text-primary resize-none focus:outline-none focus:border-accent"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
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
              {aiWarnings.length > 0 && (
                <div className="mt-2 p-2 bg-yellow-900/20 border border-yellow-800/40 rounded-lg">
                  <div className="text-[10px] font-semibold text-yellow-400 mb-1">
                    Compliance warnings:
                  </div>
                  {aiWarnings.map((w, i) => (
                    <div key={i} className="text-[10px] text-yellow-300">• {w}</div>
                  ))}
                </div>
              )}
              {missingTemplates.length > 0 && (
                <div className="mt-2 p-2 bg-blue-900/20 border border-blue-800/40 rounded-lg">
                  <div className="text-[10px] font-semibold text-blue-400 mb-1">
                    Templates to create:
                  </div>
                  {missingTemplates.map((t, i) => (
                    <div key={i} className="text-[10px] text-blue-300">• {t.suggestedName}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Config panel */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {!selectedFlowNode && (
              <div className="px-4 pt-3 pb-2 border-b border-border">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">
                  Properties
                </div>
              </div>
            )}
            <NodeConfigEditor
              node={selectedFlowNode}
              triggerType={triggerType}
              onTriggerTypeChange={setTriggerType}
              onChange={updateSelectedNodeConfig}
              onDelete={deleteSelectedNode}
            />
          </div>
        </div>
      </div>

      {/* Node picker popup */}
      {picker && (
        <NodePickerPopup
          x={picker.x}
          y={picker.y}
          onPick={handlePickerAdd}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

export function FlowEditorPage() {
  return (
    <ReactFlowProvider>
      <FlowEditorInner />
    </ReactFlowProvider>
  );
}
