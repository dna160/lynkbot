/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Flows/FlowEditorPage.tsx
 * Role    : Visual flow editor with Drawflow canvas, node palette, config panel,
 *           and AI generation panel (PRD §13.2).
 *           Uses drawflow@0.0.60 — pinned in package.json.
 *           UX model: N8N-style — click "+" on a node to add the next step,
 *           drag from palette as alternative, connections drawn automatically.
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

interface NodePaletteEntry {
  type: NodeType;
  label: string;
  icon: string;
  color: string;
  description: string;
  category: 'trigger' | 'message' | 'logic' | 'action' | 'control';
}

// ── Node Palette Config ───────────────────────────────────────────────────────

const PALETTE_NODES: NodePaletteEntry[] = [
  { type: 'TRIGGER',              label: 'Trigger',         icon: '⚡', color: '#6366F1', description: 'Starts the flow',            category: 'trigger'  },
  { type: 'SEND_TEMPLATE',        label: 'Send Template',   icon: '📨', color: '#3B82F6', description: 'WhatsApp template message',   category: 'message'  },
  { type: 'SEND_TEXT',            label: 'Send Text',       icon: '💬', color: '#3B82F6', description: 'Plain text message',          category: 'message'  },
  { type: 'SEND_INTERACTIVE',     label: 'Interactive',     icon: '🔘', color: '#8B5CF6', description: 'Buttons or list message',     category: 'message'  },
  { type: 'DELAY',                label: 'Delay',           icon: '⏱',  color: '#F59E0B', description: 'Wait before next step',       category: 'control'  },
  { type: 'WAIT_FOR_REPLY',       label: 'Wait for Reply',  icon: '⌛', color: '#F59E0B', description: 'Pause until buyer responds',  category: 'control'  },
  { type: 'IF_CONDITION',         label: 'If / Else',       icon: '🔀', color: '#10B981', description: 'Branch on a condition',       category: 'logic'    },
  { type: 'KEYWORD_ROUTER',       label: 'Keyword Router',  icon: '🗝',  color: '#10B981', description: 'Route by keyword match',      category: 'logic'    },
  { type: 'TAG_BUYER',            label: 'Tag Buyer',       icon: '🏷',  color: '#EC4899', description: 'Add or remove a tag',        category: 'action'   },
  { type: 'UPDATE_BUYER',         label: 'Update Buyer',    icon: '✏️', color: '#EC4899', description: 'Update buyer profile field',  category: 'action'   },
  { type: 'SEGMENT_QUALITY_GATE', label: 'Quality Gate',    icon: '🛡',  color: '#EF4444', description: 'Filter low-quality contacts', category: 'logic'    },
  { type: 'END_FLOW',             label: 'End Flow',        icon: '🔚', color: '#64748B', description: 'Terminate the flow',          category: 'control'  },
];

const CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Trigger',
  message: 'Messages',
  logic: 'Logic',
  action: 'Actions',
  control: 'Flow Control',
};

// ── Node I/O counts ───────────────────────────────────────────────────────────

function nodeOutputCount(type: NodeType): number {
  if (type === 'END_FLOW') return 0;
  if (type === 'IF_CONDITION' || type === 'KEYWORD_ROUTER') return 2;
  return 1;
}

function nodeInputCount(type: NodeType): number {
  return type === 'TRIGGER' ? 0 : 1;
}

// ── Config preview for node cards ────────────────────────────────────────────

function nodePreview(type: NodeType, config: Record<string, unknown>): string {
  switch (type) {
    case 'TRIGGER': {
      const tt = (config.triggerType as string) ?? 'inbound_keyword';
      if (tt === 'inbound_keyword') {
        const kw = Array.isArray(config.keywords) && config.keywords.length
          ? config.keywords.join(', ') : '';
        return kw ? `Keywords: ${kw}` : 'Set keywords in panel →';
      }
      if (tt === 'time_based') return config.cronExpression ? `Cron: ${config.cronExpression}` : 'Set schedule in panel →';
      if (tt === 'order_event') return `Event: ${config.orderEvent ?? 'order_confirmed'}`;
      return 'Manual trigger';
    }
    case 'SEND_TEMPLATE':
      return config.templateName ? `📋 ${config.templateName}` : 'Set template name →';
    case 'SEND_TEXT': {
      const msg = String(config.message ?? '');
      return msg ? `"${msg.slice(0, 45)}${msg.length > 45 ? '…' : ''}"` : 'Set message →';
    }
    case 'SEND_INTERACTIVE':
      return `Type: ${config.type ?? 'button'}`;
    case 'DELAY': {
      const ms = Number(config.delayMs ?? 3000);
      return ms >= 60000 ? `Wait ${Math.round(ms / 60000)}m` : `Wait ${ms}ms`;
    }
    case 'WAIT_FOR_REPLY':
      return config.timeoutMs ? `Timeout: ${config.timeoutMs}ms` : 'Wait indefinitely';
    case 'IF_CONDITION':
      return 'Yes → / No →';
    case 'KEYWORD_ROUTER': {
      const kws = Array.isArray(config.keywords) ? config.keywords : [];
      return kws.length ? `Match: ${(kws as string[]).join(', ')}` : 'Set keywords →';
    }
    case 'TAG_BUYER':
      return config.tag ? `${config.action ?? 'add'} "${config.tag}"` : 'Set tag →';
    case 'UPDATE_BUYER':
      return config.field ? `Set ${config.field}` : 'Set field →';
    case 'SEGMENT_QUALITY_GATE':
      return 'Filters contacts by quality';
    case 'END_FLOW':
      return config.reason ? `Reason: ${config.reason}` : 'End conversation';
    default:
      return '';
  }
}

// ── Node HTML template (rendered inside Drawflow) ─────────────────────────────

function buildNodeHtml(type: NodeType, config: Record<string, unknown>, nodeId: string, hasError: boolean): string {
  const p = PALETTE_NODES.find(x => x.type === type)!;
  const preview = nodePreview(type, config);
  const outCount = nodeOutputCount(type);

  // Branch labels for conditional nodes
  let branchLabels = '';
  if (type === 'IF_CONDITION') {
    branchLabels = `
      <div class="df-branch-row">
        <span class="df-branch-yes">✓ Yes</span>
        <span class="df-branch-no">✗ No</span>
      </div>`;
  } else if (type === 'KEYWORD_ROUTER') {
    branchLabels = `
      <div class="df-branch-row">
        <span class="df-branch-yes">Match</span>
        <span class="df-branch-no">Other</span>
      </div>`;
  }

  // "Add step" button — only for single-output, non-end nodes
  const addBtn = (outCount === 1)
    ? `<div class="df-add-btn" data-nodeid="${nodeId}" onmousedown="event.stopPropagation()">＋ Add step</div>`
    : '';

  return `
    <div class="df-card">
      <div class="df-card-header" style="background:${p.color}1A;border-bottom:1px solid ${p.color}33">
        <span class="df-card-icon">${p.icon}</span>
        <div class="df-card-meta">
          <div class="df-card-type" style="color:${p.color}">${p.label}</div>
          <div class="df-card-preview">${preview}</div>
        </div>
        ${hasError ? '<span class="df-err-badge" title="Config errors">!</span>' : ''}
      </div>
      ${branchLabels}
      ${addBtn}
    </div>`;
}

// ── Drawflow ↔ FlowDefinition conversion ─────────────────────────────────────

function toDrawflow(flow: FlowDefinition): object {
  const drawflow: Record<string, { data: Record<string, object> }> = { Home: { data: {} } };
  const nodeMap: Record<string, number> = {};

  flow.nodes.forEach((node, idx) => {
    const dfId = idx + 1;
    nodeMap[node.id] = dfId;
    const hasError = (node.validationErrors?.length ?? 0) > 0;
    const type = node.type as NodeType;
    const outCount = nodeOutputCount(type);
    const inCount = nodeInputCount(type);

    const outputs: Record<string, { connections: unknown[] }> = {};
    for (let i = 0; i < outCount; i++) outputs[`output_${i + 1}`] = { connections: [] };

    const inputs: Record<string, { connections: unknown[] }> = {};
    for (let i = 0; i < inCount; i++) inputs[`input_${i + 1}`] = { connections: [] };

    drawflow.Home.data[dfId] = {
      id: dfId,
      name: type,
      data: { nodeId: node.id, type, config: node.config, hasError },
      class: hasError ? 'error' : '',
      html: buildNodeHtml(type, node.config, node.id, hasError),
      typenode: false,
      inputs,
      outputs,
      pos_x: 100 + (idx % 3) * 300,
      pos_y: 80 + Math.floor(idx / 3) * 200,
    };
  });

  flow.edges.forEach(edge => {
    const srcId = nodeMap[edge.source];
    const tgtId = nodeMap[edge.target];
    if (!srcId || !tgtId) return;
    const srcNode = drawflow.Home.data[srcId] as any;
    const tgtNode = drawflow.Home.data[tgtId] as any;
    if (!srcNode || !tgtNode) return;
    const outKey = edge.sourcePort ?? 'output_1';
    const inKey  = 'input_1';
    if (!srcNode.outputs[outKey]) srcNode.outputs[outKey] = { connections: [] };
    if (!tgtNode.inputs[inKey])   tgtNode.inputs[inKey]   = { connections: [] };
    srcNode.outputs[outKey].connections.push({ node: String(tgtId), output: inKey });
    tgtNode.inputs[inKey].connections.push({ node: String(srcId), input: outKey });
  });

  return { drawflow };
}

function fromDrawflow(exported: any): FlowDefinition {
  const home = exported?.drawflow?.Home?.data ?? {};
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const idMap: Record<string, string> = {};

  Object.keys(home).forEach(dfId => {
    const n = home[dfId];
    const origId: string = n.data?.nodeId ?? `node_${dfId}`;
    idMap[dfId] = origId;
    nodes.push({ id: origId, type: n.data?.type ?? n.name, config: n.data?.config ?? {} });
  });

  Object.keys(home).forEach(dfId => {
    const n = home[dfId];
    const srcOrigId = idMap[dfId];
    Object.entries<any>(n.outputs ?? {}).forEach(([outKey, out]) => {
      (out.connections ?? []).forEach((conn: any, connIdx: number) => {
        const tgtOrigId = idMap[conn.node];
        if (tgtOrigId) {
          edges.push({
            id: `edge_${srcOrigId}_${tgtOrigId}_${connIdx}`,
            source: srcOrigId,
            target: tgtOrigId,
            sourcePort: outKey,
          });
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
  triggerType?: TriggerType;
  onTriggerTypeChange?: (t: TriggerType) => void;
  onDelete?: () => void;
}

function NodeConfigEditor({ node, onChange, triggerType, onTriggerTypeChange, onDelete }: ConfigEditorProps) {
  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
          <svg className="w-5 h-5 text-secondary/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
        </div>
        <p className="text-sm text-secondary/50 font-medium">Click a node to configure it</p>
        <p className="text-xs text-secondary/30 mt-1">Select any node on the canvas</p>
      </div>
    );
  }

  const p = PALETTE_NODES.find(x => x.type === node.type)!;
  const update = (patch: Partial<Record<string, unknown>>) => {
    onChange({ ...node, config: { ...node.config, ...patch } });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Node header in panel */}
      <div className="px-4 py-3 border-b border-border shrink-0" style={{ borderLeftColor: p.color, borderLeftWidth: 3 }}>
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{p.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-primary leading-tight">{p.label}</div>
            <div className="text-[10px] text-secondary/50 mt-0.5">{p.description}</div>
          </div>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-900/20 text-secondary/40 hover:text-red-400 transition-colors shrink-0"
            title="Delete node"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Config fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {node.type === 'TRIGGER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Trigger Type</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={triggerType ?? 'inbound_keyword'}
                onChange={e => onTriggerTypeChange?.(e.target.value as TriggerType)}
              >
                <option value="inbound_keyword">Keyword Trigger</option>
                <option value="time_based">Scheduled (Cron)</option>
                <option value="order_event">Order Event</option>
                <option value="manual">Manual</option>
              </select>
            </label>

            {(triggerType === 'inbound_keyword' || !triggerType) && (
              <label className="block">
                <span className="text-xs font-medium text-secondary">Keywords</span>
                <input
                  className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                  placeholder="hello, hi, halo"
                  value={(Array.isArray(node.config.keywords) ? node.config.keywords : []).join(', ')}
                  onChange={e => update({ keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                />
                <span className="text-[10px] text-secondary/50 mt-1 block">Comma-separated. Flow starts when buyer sends any of these.</span>
              </label>
            )}

            {triggerType === 'time_based' && (
              <label className="block">
                <span className="text-xs font-medium text-secondary">Cron Expression (Jakarta UTC+7)</span>
                <input
                  className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                  placeholder="0 9 * * 1  (Mon 9am)"
                  value={String(node.config.cronExpression ?? '')}
                  onChange={e => update({ cronExpression: e.target.value })}
                />
                <span className="text-[10px] text-secondary/50 mt-1 block">Format: min hour day month weekday</span>
              </label>
            )}

            {triggerType === 'order_event' && (
              <label className="block">
                <span className="text-xs font-medium text-secondary">Order Event</span>
                <select
                  className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                  value={String(node.config.orderEvent ?? 'order_confirmed')}
                  onChange={e => update({ orderEvent: e.target.value })}
                >
                  <option value="order_confirmed">Order Confirmed</option>
                  <option value="order_shipped">Order Shipped</option>
                  <option value="order_delivered">Order Delivered</option>
                  <option value="payment_expired">Payment Expired</option>
                </select>
              </label>
            )}

            {triggerType === 'manual' && (
              <p className="text-xs text-secondary/50 bg-white/5 rounded-lg p-3">
                Manual flows are started via the API or a broadcast campaign. No extra config needed.
              </p>
            )}
          </div>
        )}

        {node.type === 'SEND_TEMPLATE' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Template Name (snake_case)</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                placeholder="order_confirmation"
                value={String(node.config.templateName ?? '')}
                onChange={e => update({ templateName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">Language Code</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="id"
                value={String(node.config.languageCode ?? 'id')}
                onChange={e => update({ languageCode: e.target.value })}
              />
            </label>
          </div>
        )}

        {node.type === 'SEND_TEXT' && (
          <label className="block">
            <span className="text-xs font-medium text-secondary">Message</span>
            <textarea
              rows={5}
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent resize-none"
              placeholder="Hi {{buyer.name}}, your order is ready!"
              value={String(node.config.message ?? '')}
              onChange={e => update({ message: e.target.value })}
            />
            <span className="text-[10px] text-secondary/50 mt-1 block">Use {'{{buyer.name}}'}, {'{{buyer.phone}}'} for personalization.</span>
          </label>
        )}

        {node.type === 'SEND_INTERACTIVE' && (
          <label className="block">
            <span className="text-xs font-medium text-secondary">Interaction Type</span>
            <select
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={String(node.config.type ?? 'button')}
              onChange={e => update({ type: e.target.value })}
            >
              <option value="button">Button</option>
              <option value="list">List</option>
            </select>
          </label>
        )}

        {node.type === 'DELAY' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Delay (milliseconds)</span>
              <input
                type="number"
                min={500}
                step={500}
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={Number(node.config.delayMs ?? 3000)}
                onChange={e => update({ delayMs: Number(e.target.value) })}
              />
            </label>
            <div className="flex gap-2">
              {[1000, 3000, 5000, 30000, 60000].map(ms => (
                <button
                  key={ms}
                  onClick={() => update({ delayMs: ms })}
                  className="flex-1 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-secondary hover:text-primary transition-colors"
                >
                  {ms >= 60000 ? `${ms / 60000}m` : `${ms / 1000}s`}
                </button>
              ))}
            </div>
          </div>
        )}

        {node.type === 'WAIT_FOR_REPLY' && (
          <label className="block">
            <span className="text-xs font-medium text-secondary">Timeout (ms, 0 = wait forever)</span>
            <input
              type="number"
              min={0}
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              value={Number(node.config.timeoutMs ?? 0)}
              onChange={e => update({ timeoutMs: Number(e.target.value) || undefined })}
            />
          </label>
        )}

        {node.type === 'IF_CONDITION' && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-secondary mb-2">Branch Outputs</div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-green-900/10 border border-green-800/30">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-green-400 font-medium">Output 1 — Yes / True</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-900/10 border border-red-800/30">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span className="text-xs text-red-400 font-medium">Output 2 — No / False</span>
            </div>
            <p className="text-[10px] text-secondary/50 pt-1">Drag from the right-side ports to connect each branch.</p>
          </div>
        )}

        {node.type === 'KEYWORD_ROUTER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Match Keywords (comma-separated)</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent font-mono"
                placeholder="pay, bayar, order"
                value={(Array.isArray(node.config.keywords) ? node.config.keywords : []).join(', ')}
                onChange={e => update({ keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              />
            </label>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-green-900/10 border border-green-800/30">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-green-400 font-medium">Output 1 — Keyword matched</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/60 border border-slate-700/30">
              <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
              <span className="text-xs text-secondary font-medium">Output 2 — No match</span>
            </div>
          </div>
        )}

        {node.type === 'TAG_BUYER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Action</span>
              <select
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                value={String(node.config.action ?? 'add')}
                onChange={e => update({ action: e.target.value })}
              >
                <option value="add">Add tag</option>
                <option value="remove">Remove tag</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">Tag name</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="vip_customer"
                value={String(node.config.tag ?? '')}
                onChange={e => update({ tag: e.target.value })}
              />
            </label>
          </div>
        )}

        {node.type === 'UPDATE_BUYER' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">Field to update</span>
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
              <span className="text-xs font-medium text-secondary">New value</span>
              <input
                className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
                placeholder="{{buyer.name}}"
                value={String(node.config.value ?? '')}
                onChange={e => update({ value: e.target.value })}
              />
            </label>
          </div>
        )}

        {node.type === 'SEGMENT_QUALITY_GATE' && (
          <div className="space-y-3">
            <div className="text-xs font-medium text-secondary mb-1">Pass criteria</div>
            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5">
              <input
                type="checkbox"
                checked={Boolean(node.config.requireOrders)}
                onChange={e => update({ requireOrders: e.target.checked })}
                className="w-4 h-4 rounded border-border text-accent"
              />
              <span className="text-sm text-secondary">Require ≥1 order</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5">
              <input
                type="checkbox"
                checked={Boolean(node.config.requireInboundHistory)}
                onChange={e => update({ requireInboundHistory: e.target.checked })}
                className="w-4 h-4 rounded border-border text-accent"
              />
              <span className="text-sm text-secondary">Require inbound message history</span>
            </label>
          </div>
        )}

        {node.type === 'END_FLOW' && (
          <label className="block">
            <span className="text-xs font-medium text-secondary">End reason (optional)</span>
            <input
              className="w-full mt-1 bg-[#0F172A] border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent"
              placeholder="completed, opted_out…"
              value={String(node.config.reason ?? '')}
              onChange={e => update({ reason: e.target.value })}
            />
          </label>
        )}

        {(node.validationErrors?.length ?? 0) > 0 && (
          <div className="p-3 bg-red-900/20 border border-red-800/40 rounded-lg">
            <div className="text-xs font-semibold text-red-400 mb-1">⚠ Validation errors</div>
            {node.validationErrors!.map((e, i) => (
              <div key={i} className="text-xs text-red-300">• {e}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Node Picker Popup ─────────────────────────────────────────────────────────

interface NodePickerProps {
  x: number;
  y: number;
  onPick: (type: NodeType) => void;
  onClose: () => void;
}

function NodePickerPopup({ x, y, onPick, onClose }: NodePickerProps) {
  const pickable = PALETTE_NODES.filter(p => p.type !== 'TRIGGER');
  const categories = [...new Set(pickable.map(p => p.category))];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Popup */}
      <div
        className="fixed z-50 bg-[#1E293B] border border-border rounded-xl shadow-2xl overflow-hidden w-60"
        style={{ left: Math.min(x, window.innerWidth - 256), top: Math.min(y, window.innerHeight - 400) }}
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Add Next Step</span>
          <button onClick={onClose} className="text-secondary/40 hover:text-secondary transition-colors text-xs">✕</button>
        </div>
        <div className="overflow-y-auto max-h-80">
          {categories.map(cat => (
            <div key={cat}>
              <div className="px-3 pt-3 pb-1 text-[9px] font-bold text-secondary/50 uppercase tracking-widest">
                {CATEGORY_LABELS[cat]}
              </div>
              {pickable.filter(p => p.category === cat).map(p => (
                <button
                  key={p.type}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left transition-colors"
                  onMouseDown={e => { e.stopPropagation(); onPick(p.type); }}
                >
                  <span className="text-base w-5 text-center leading-none shrink-0">{p.icon}</span>
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

// ── Main Component ────────────────────────────────────────────────────────────

export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<InstanceType<typeof Drawflow> | null>(null);

  const [flowName, setFlowName] = useState('New Flow');
  const [triggerType, setTriggerType] = useState<TriggerType>('inbound_keyword');
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [selectedDfId, setSelectedDfId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [hasNodes, setHasNodes] = useState(false);

  // Node picker popup state (for "＋ Add step" button)
  const [picker, setPicker] = useState<{ x: number; y: number; sourceNodeId: string } | null>(null);

  // AI panel state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [missingTemplates, setMissingTemplates] = useState<MissingTemplate[]>([]);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  // ── Drawflow init ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = new Drawflow(containerRef.current);
    editor.reroute = true;
    editor.reroute_fix_curvature = true;
    editor.start();
    editorRef.current = editor;

    editor.on('nodeSelected', (dfId: number) => {
      const exported = editor.export() as any;
      const nodeData = exported?.drawflow?.Home?.data?.[dfId];
      if (nodeData?.data) {
        setSelectedDfId(dfId);
        setSelectedNode({
          id: nodeData.data.nodeId ?? `node_${dfId}`,
          type: nodeData.data.type,
          config: nodeData.data.config ?? {},
          validationErrors: nodeData.data.hasError ? ['Node has validation errors'] : [],
        });
      }
    });

    editor.on('nodeUnselected', () => {
      setSelectedNode(null);
      setSelectedDfId(null);
    });

    editor.on('nodeCreated', () => setHasNodes(true));
    editor.on('nodeRemoved', () => {
      const exported = editor.export() as any;
      const count = Object.keys(exported?.drawflow?.Home?.data ?? {}).length;
      setHasNodes(count > 0);
    });

    return () => {
      try { (editor as any).destroy?.(); } catch { /* ignore */ }
    };
  }, []);

  // ── Keyboard: Delete removes selected node ─────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDfId !== null) {
        // Only if focus is NOT in an input/textarea
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        editorRef.current?.removeNodeId(`node-${selectedDfId}`);
        setSelectedNode(null);
        setSelectedDfId(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [selectedDfId]);

  // ── Click delegation: catch "＋ Add step" clicks inside Drawflow DOM ───────

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    const handleClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.df-add-btn') as HTMLElement | null;
      if (btn) {
        e.stopPropagation();
        const sourceNodeId = btn.getAttribute('data-nodeid');
        if (!sourceNodeId) return;
        const rect = btn.getBoundingClientRect();
        setPicker({ x: rect.right + 8, y: rect.top, sourceNodeId });
      }
    };

    wrap.addEventListener('click', handleClick);
    return () => wrap.removeEventListener('click', handleClick);
  }, []);

  // ── Add node from "+" picker ───────────────────────────────────────────────

  const handlePickerAdd = useCallback((newType: NodeType) => {
    const editor = editorRef.current;
    if (!editor || !picker) return;

    // Find source node's drawflow ID and position
    const exported = editor.export() as any;
    const home = exported?.drawflow?.Home?.data ?? {};
    const srcEntry = Object.entries<any>(home).find(([, v]) => v.data?.nodeId === picker.sourceNodeId);
    if (!srcEntry) { setPicker(null); return; }

    const [srcDfId, srcData] = srcEntry;
    const newX = srcData.pos_x + 300;
    const newY = srcData.pos_y;
    const newNodeId = `${newType.toLowerCase()}_${Date.now()}`;
    const defaultConfig = newType === 'DELAY' ? { delayMs: 3000 }
      : newType === 'TAG_BUYER' ? { action: 'add', tag: '' }
      : newType === 'SEND_TEMPLATE' ? { templateName: '', languageCode: 'id' }
      : newType === 'SEND_TEXT' ? { message: '' }
      : {};

    const inCount = nodeInputCount(newType);
    const outCount = nodeOutputCount(newType);

    const newDfId = editor.addNode(
      newType,
      inCount,
      outCount,
      newX, newY,
      '',
      { nodeId: newNodeId, type: newType, config: defaultConfig },
      buildNodeHtml(newType, defaultConfig, newNodeId, false),
    );

    // Connect source output_1 → new node input_1
    if (inCount > 0) {
      try { editor.addConnection(Number(srcDfId), newDfId, 'output_1', 'input_1'); } catch { /* skip */ }
    }

    setPicker(null);
    setHasNodes(true);
  }, [picker]);

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
        if (editorRef.current && def.nodes.length > 0) {
          editorRef.current.clear();
          editorRef.current.import(toDrawflow(def) as any);
          setHasNodes(def.nodes.length > 0);
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
    setHasNodes(def.nodes.length > 0);
  }, []);

  // ── Drag-to-canvas (palette → drop) ───────────────────────────────────────

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
      nodeInputCount(type),
      nodeOutputCount(type),
      x, y, '',
      { nodeId, type, config: defaultConfig },
      buildNodeHtml(type, defaultConfig, nodeId, false),
    );
    setHasNodes(true);
  }, []);

  // ── Click-to-add from palette ──────────────────────────────────────────────

  const handlePaletteClick = useCallback((type: NodeType) => {
    if (!editorRef.current) return;
    const nodeId = `${type.toLowerCase()}_${Date.now()}`;
    const defaultConfig = type === 'DELAY' ? { delayMs: 3000 }
      : type === 'TAG_BUYER' ? { action: 'add', tag: '' }
      : type === 'SEND_TEMPLATE' ? { templateName: '', languageCode: 'id' }
      : type === 'SEND_TEXT' ? { message: '' }
      : {};
    // Place new nodes in a cascading position
    const exported = editorRef.current.export() as any;
    const home = exported?.drawflow?.Home?.data ?? {};
    const count = Object.keys(home).length;
    const x = 120 + (count % 3) * 300;
    const y = 80 + Math.floor(count / 3) * 200;

    editorRef.current.addNode(
      type, nodeInputCount(type), nodeOutputCount(type),
      x, y, '',
      { nodeId, type, config: defaultConfig },
      buildNodeHtml(type, defaultConfig, nodeId, false),
    );
    setHasNodes(true);
  }, []);

  // ── Update selected node config in Drawflow ───────────────────────────────

  const handleConfigChange = useCallback((updated: FlowNode) => {
    setSelectedNode(updated);
    if (editorRef.current) {
      const exported = editorRef.current.export() as any;
      const home = exported?.drawflow?.Home?.data ?? {};
      const dfId = Object.keys(home).find(k => home[k]?.data?.nodeId === updated.id);
      if (dfId) {
        editorRef.current.updateNodeDataFromId(Number(dfId), {
          ...home[dfId].data,
          config: updated.config,
        });
        // Refresh node HTML so preview text updates
        const el = document.querySelector(`#node-${dfId} .drawflow_content_node`) as HTMLElement | null;
        if (el) {
          el.innerHTML = buildNodeHtml(updated.type, updated.config, updated.id, false);
        }
      }
    }
  }, []);

  // ── Delete selected node ───────────────────────────────────────────────────

  const handleDeleteNode = useCallback(() => {
    if (selectedDfId === null) return;
    editorRef.current?.removeNodeId(`node-${selectedDfId}`);
    setSelectedNode(null);
    setSelectedDfId(null);
  }, [selectedDfId]);

  // ── Zoom controls ──────────────────────────────────────────────────────────

  const zoomIn  = () => editorRef.current?.zoom_in();
  const zoomOut = () => editorRef.current?.zoom_out();

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
      else addToast('Flow generated — review and save', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'AI generation failed', 'error');
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, loadFlowIntoCanvas, addToast]);

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

      // Build triggerConfig from the TRIGGER node so the engine can match
      // keywords without having to parse the full definition graph.
      const triggerNode = (definition as any).nodes?.find((n: any) => n.type === 'TRIGGER');
      const triggerConfig: Record<string, unknown> = { triggerType };
      if (triggerType === 'inbound_keyword' && triggerNode) {
        const kws = Array.isArray(triggerNode.config?.keywords) ? triggerNode.config.keywords : [];
        triggerConfig.keywords = kws;
      }

      if (id) {
        await flowsApi.update(id, { name: flowName, triggerType, triggerConfig, definition } as any);
        addToast('Flow saved', 'success');
      } else {
        const res = await flowsApi.create({ name: flowName, triggerType, triggerConfig, definition } as any);
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
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const categories = [...new Set(PALETTE_NODES.map(p => p.category))];

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-surface shrink-0">
        <input
          className="bg-transparent text-primary font-semibold text-sm focus:outline-none focus:border-b focus:border-accent px-1 py-0.5 min-w-0 w-44"
          value={flowName}
          onChange={e => setFlowName(e.target.value)}
          placeholder="Flow name…"
        />
        <div className="h-4 w-px bg-border shrink-0" />
        <select
          value={triggerType}
          onChange={e => setTriggerType(e.target.value as TriggerType)}
          className="bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent shrink-0"
        >
          <option value="inbound_keyword">⚡ Keyword Trigger</option>
          <option value="time_based">🕐 Scheduled</option>
          <option value="order_event">📦 Order Event</option>
          <option value="manual">✋ Manual</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setAiPanelOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
              aiPanelOpen ? 'bg-accent text-white border-accent' : 'text-accent border-accent/40 hover:bg-accent/10'
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
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : id ? 'Save' : 'Create Draft'}
          </button>
        </div>
      </div>

      {/* ── Editor area ── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: Node Palette */}
        <div className="w-52 shrink-0 bg-surface border-r border-border overflow-y-auto py-3">
          <div className="px-3 mb-2 text-[9px] font-bold text-secondary/50 uppercase tracking-widest">Nodes</div>
          {categories.map(cat => (
            <div key={cat}>
              <div className="px-3 pt-2 pb-0.5 text-[9px] font-bold text-secondary/40 uppercase tracking-widest">
                {CATEGORY_LABELS[cat]}
              </div>
              {PALETTE_NODES.filter(p => p.category === cat).map(p => (
                <div
                  key={p.type}
                  draggable
                  onDragStart={e => handleDragStart(e, p.type)}
                  onClick={() => handlePaletteClick(p.type)}
                  className="flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-white/5 active:bg-white/10 transition-colors mb-0.5 select-none group"
                  title={`Click or drag to add ${p.label}`}
                >
                  <span className="text-base leading-none w-5 text-center shrink-0">{p.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs text-primary font-medium leading-tight truncate">{p.label}</div>
                    <div className="text-[9px] text-secondary/50 leading-tight truncate">{p.description}</div>
                  </div>
                  <svg className="w-3 h-3 text-secondary/20 group-hover:text-secondary/40 shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
              ))}
            </div>
          ))}
          <div className="mx-3 mt-3 pt-3 border-t border-border">
            <p className="text-[9px] text-secondary/30 leading-relaxed">
              Click to add at center, or drag onto the canvas. Then click <strong className="text-secondary/50">＋ Add step</strong> on a node to chain the next one.
            </p>
          </div>
        </div>

        {/* Center: Canvas */}
        <div
          ref={canvasWrapRef}
          className="flex-1 relative overflow-hidden bg-[#080F1E]"
          onDragOver={e => e.preventDefault()}
          onDrop={handleCanvasDrop}
          onClick={() => setPicker(null)}
        >
          {/* Drawflow CSS overrides */}
          <style>{`
            /* Canvas background — dot grid */
            .drawflow {
              background-color: #080F1E;
              background-image: radial-gradient(circle, #1E2D45 1.2px, transparent 1.2px);
              background-size: 28px 28px;
            }
            /* Node card base */
            .drawflow .drawflow-node {
              background: #0F1C2E !important;
              border: 1.5px solid #1E2D45 !important;
              border-radius: 10px !important;
              padding: 0 !important;
              overflow: visible !important;
              min-width: 210px !important;
              box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
            }
            .drawflow .drawflow-node:hover {
              border-color: #334155 !important;
              box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
            }
            /* Selected node */
            .drawflow .drawflow-node.selected {
              background: #0F1C2E !important;
              border-color: #6366F1 !important;
              box-shadow: 0 0 0 3px rgba(99,102,241,0.25), 0 4px 20px rgba(0,0,0,0.5) !important;
            }
            /* Error node */
            .drawflow .drawflow-node.error {
              border-color: #EF4444 !important;
            }
            /* Connection ports — make them big and obvious */
            .drawflow .input, .drawflow .output {
              background: #1E293B !important;
              border: 2px solid #6366F1 !important;
              width: 14px !important;
              height: 14px !important;
              border-radius: 50% !important;
            }
            .drawflow .input:hover, .drawflow .output:hover {
              background: #6366F1 !important;
              transform: scale(1.3);
              cursor: crosshair;
            }
            /* Port labels for IF_CONDITION / KEYWORD_ROUTER */
            .drawflow .output_1::after { content: ''; }
            /* Connection lines */
            .drawflow .connection .main-path {
              stroke: #6366F1 !important;
              stroke-width: 2.5px !important;
            }
            .drawflow .connection .main-path:hover {
              stroke: #818CF8 !important;
              stroke-width: 3px !important;
            }
            /* Node card inner */
            .df-card {
              display: flex;
              flex-direction: column;
              border-radius: 9px;
              overflow: hidden;
            }
            .df-card-header {
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 9px 12px;
            }
            .df-card-icon {
              font-size: 17px;
              line-height: 1;
              width: 22px;
              text-align: center;
              flex-shrink: 0;
            }
            .df-card-meta { flex: 1; min-width: 0; }
            .df-card-type {
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.04em;
              line-height: 1.2;
            }
            .df-card-preview {
              font-size: 10px;
              color: #94A3B8;
              margin-top: 2px;
              line-height: 1.4;
              overflow: hidden;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
            }
            .df-err-badge {
              width: 16px;
              height: 16px;
              background: #EF4444;
              color: white;
              border-radius: 50%;
              font-size: 10px;
              font-weight: 700;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
            }
            /* Branch labels for IF/ROUTER */
            .df-branch-row {
              display: flex;
              justify-content: space-between;
              padding: 4px 12px 4px;
              border-top: 1px solid #1E2D45;
            }
            .df-branch-yes {
              font-size: 9px;
              font-weight: 600;
              color: #34D399;
            }
            .df-branch-no {
              font-size: 9px;
              font-weight: 600;
              color: #F87171;
            }
            /* ＋ Add step button */
            .df-add-btn {
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 6px 12px;
              border-top: 1px solid #1E2D45;
              font-size: 10px;
              font-weight: 600;
              color: #6366F1;
              cursor: pointer;
              transition: background 0.15s;
              user-select: none;
            }
            .df-add-btn:hover {
              background: rgba(99,102,241,0.12);
              color: #818CF8;
            }
          `}</style>

          {/* Empty state guide */}
          {!hasNodes && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
              <div className="bg-[#0F1C2E]/90 border border-border rounded-2xl p-8 max-w-sm text-center">
                <div className="text-3xl mb-3">⚡</div>
                <h3 className="text-sm font-semibold text-primary mb-1">Build your flow</h3>
                <p className="text-xs text-secondary/60 mb-5 leading-relaxed">
                  Click any node in the left panel to add it to the canvas, then use <strong className="text-secondary/80">＋ Add step</strong> to chain nodes together.
                </p>
                <div className="space-y-2 text-left">
                  {[
                    { step: '1', text: 'Click Trigger in the panel →', icon: '⚡' },
                    { step: '2', text: 'Click the node to configure', icon: '⚙️' },
                    { step: '3', text: 'Click ＋ Add step to continue', icon: '➕' },
                  ].map(s => (
                    <div key={s.step} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold flex items-center justify-center shrink-0">
                        {s.step}
                      </span>
                      <span className="text-xs text-secondary/70">{s.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-20">
            <button onClick={zoomIn}  className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-white/5 transition-colors text-sm font-medium">+</button>
            <button onClick={zoomOut} className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-white/5 transition-colors text-sm font-medium">−</button>
          </div>

          {/* Connection hint */}
          {hasNodes && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className="bg-surface/80 border border-border rounded-full px-3 py-1 text-[10px] text-secondary/50">
                Drag from a <span className="text-indigo-400 font-medium">●</span> port to connect · Scroll to pan · Delete key removes selected node
              </div>
            </div>
          )}

          <div ref={containerRef} className="w-full h-full" />
        </div>

        {/* Right: Config + AI panels */}
        <div className="w-72 shrink-0 border-l border-border bg-surface flex flex-col">

          {/* AI Panel */}
          {aiPanelOpen && (
            <div className="border-b border-border p-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">AI Assistant</div>
                <button onClick={() => setAiPanelOpen(false)} className="text-secondary/40 hover:text-secondary text-xs">✕</button>
              </div>
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
              {aiWarnings.length > 0 && (
                <div className="mt-2 p-2 bg-yellow-900/20 border border-yellow-800/40 rounded-lg">
                  <div className="text-[10px] font-semibold text-yellow-400 mb-1">Compliance warnings:</div>
                  {aiWarnings.map((w, i) => <div key={i} className="text-[10px] text-yellow-300">• {w}</div>)}
                </div>
              )}
              {missingTemplates.length > 0 && (
                <div className="mt-2 p-2 bg-blue-900/20 border border-blue-800/40 rounded-lg">
                  <div className="text-[10px] font-semibold text-blue-400 mb-1">Templates to create:</div>
                  {missingTemplates.map((t, i) => <div key={i} className="text-[10px] text-blue-300">• {t.suggestedName}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Node Config Panel */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {!selectedNode && (
              <div className="px-4 pt-3 pb-2 border-b border-border">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">Properties</div>
              </div>
            )}
            <NodeConfigEditor
              node={selectedNode}
              onChange={handleConfigChange}
              triggerType={triggerType}
              onTriggerTypeChange={setTriggerType}
              onDelete={handleDeleteNode}
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
