import type { NodeType } from '@/types/flow';
import type { IntentKey } from '@/hooks/useIntentPlaybooks';
import { INTENT_KEY_LABELS } from '@/hooks/useIntentPlaybooks';

export interface NodePaletteEntry {
  type: NodeType;
  label: string;
  icon: string;
  color: string;
  description: string;
  category: 'trigger' | 'message' | 'logic' | 'action' | 'control' | 'handoff';
}

export const PALETTE_NODES: NodePaletteEntry[] = [
  { type: 'TRIGGER',               label: 'Trigger',          icon: '⚡', color: '#6366F1', description: 'Starts the flow',                   category: 'trigger'  },
  { type: 'SEND_TEMPLATE',         label: 'Send Template',    icon: '📨', color: '#3B82F6', description: 'WhatsApp template message',          category: 'message'  },
  { type: 'SEND_TEXT',             label: 'Send Text',        icon: '💬', color: '#3B82F6', description: 'Plain text message',                 category: 'message'  },
  { type: 'SEND_INTERACTIVE',      label: 'Interactive',      icon: '🔘', color: '#8B5CF6', description: 'Buttons or list message',            category: 'message'  },
  { type: 'DELAY',                 label: 'Delay',            icon: '⏱',  color: '#F59E0B', description: 'Wait before next step',              category: 'control'  },
  { type: 'WAIT_FOR_REPLY',        label: 'Wait for Reply',   icon: '⌛', color: '#F59E0B', description: 'Pause until buyer responds',         category: 'control'  },
  { type: 'IF_CONDITION',          label: 'If / Else',        icon: '🔀', color: '#10B981', description: 'Branch on a condition',              category: 'logic'    },
  { type: 'KEYWORD_ROUTER',        label: 'Keyword Router',   icon: '🗝',  color: '#10B981', description: 'Route by keyword match',             category: 'logic'    },
  { type: 'TAG_BUYER',             label: 'Tag Buyer',        icon: '🏷',  color: '#EC4899', description: 'Add or remove a tag',               category: 'action'   },
  { type: 'UPDATE_BUYER',          label: 'Update Buyer',     icon: '✏️', color: '#EC4899', description: 'Update buyer profile field',         category: 'action'   },
  { type: 'SEGMENT_QUALITY_GATE',  label: 'Quality Gate',     icon: '🛡',  color: '#EF4444', description: 'Filter low-quality contacts',        category: 'logic'    },
  { type: 'END_FLOW',              label: 'End Flow',         icon: '🔚', color: '#64748B', description: 'Terminate the flow',                 category: 'control'  },
  { type: 'START_SCHEDULING',      label: 'Start Scheduling', icon: '📅', color: '#0EA5E9', description: 'Hand off to the scheduling system',  category: 'handoff'  },
  { type: 'ACTIVATE_PLAYBOOK',     label: 'Activate Playbook',icon: '🤖', color: '#A855F7', description: 'Use a specific AI Playbook next',    category: 'handoff'  },
  { type: 'NOTIFY_STAFF',          label: 'Notify Staff',     icon: '📣', color: '#F97316', description: 'Send a WhatsApp message to staff',   category: 'action'   },
  { type: 'AGENT',                 label: 'Agent',            icon: '🧠', color: '#6366F1', description: 'AI agent — 2 parallel action exits', category: 'action'   },
  { type: 'COLLECT_INFO',         label: 'Collect Info',     icon: '📋', color: '#10B981', description: 'Ask a series of questions, store answers', category: 'logic' },
];

export const CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Trigger',
  message: 'Messages',
  logic: 'Logic',
  action: 'Actions',
  control: 'Flow Control',
  handoff: 'Handoffs',
};

export function nodeSourceHandles(type: NodeType): string[] {
  if (type === 'END_FLOW' || type === 'START_SCHEDULING' || type === 'ACTIVATE_PLAYBOOK') return [];
  if (type === 'IF_CONDITION') return ['true', 'false'];
  if (type === 'KEYWORD_ROUTER') return ['0', '1'];
  if (type === 'AGENT') return ['action_0', 'action_1'];
  if (type === 'COLLECT_INFO') return ['default'];
  return ['output'];
}

export function nodeHasTargetHandle(type: NodeType): boolean {
  return type !== 'TRIGGER';
}

export function nodePreview(type: NodeType, config: Record<string, unknown>): string {
  switch (type) {
    case 'TRIGGER': {
      const tt = (config.triggerType as string) ?? 'inbound_keyword';
      if (tt === 'inbound_keyword') {
        const kw = Array.isArray(config.keywords) && config.keywords.length
          ? (config.keywords as string[]).join(', ') : '';
        return kw ? `Keywords: ${kw}` : 'Set keywords →';
      }
      if (tt === 'time_based') return config.cronExpression ? `Cron: ${config.cronExpression}` : 'Set schedule →';
      if (tt === 'order_event') return `Event: ${config.orderEvent ?? 'order_confirmed'}`;
      return 'Manual trigger';
    }
    case 'SEND_TEMPLATE':
      return config.templateName ? `📋 ${config.templateName}` : 'Set template →';
    case 'SEND_TEXT': {
      const msg = String(config.message ?? '');
      return msg ? `"${msg.slice(0, 40)}${msg.length > 40 ? '…' : ''}"` : 'Set message →';
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
      const kws = Array.isArray(config.keywords) ? (config.keywords as string[]) : [];
      return kws.length ? `Match: ${kws.join(', ')}` : 'Set keywords →';
    }
    case 'TAG_BUYER':
      return config.tag ? `${config.action ?? 'add'} "${config.tag}"` : 'Set tag →';
    case 'UPDATE_BUYER':
      return config.field ? `Set ${config.field}` : 'Set field →';
    case 'SEGMENT_QUALITY_GATE':
      return 'Filters contacts by quality';
    case 'END_FLOW':
      return config.reason ? `Reason: ${config.reason}` : 'End conversation';
    case 'START_SCHEDULING':
      return config.consultationType ? `📅 ${config.consultationType}` : 'Hand off to scheduling →';
    case 'ACTIVATE_PLAYBOOK':
      return config.intentKey
        ? `🤖 ${INTENT_KEY_LABELS[config.intentKey as IntentKey] ?? config.intentKey}`
        : 'Select a playbook →';
    case 'NOTIFY_STAFF': {
      const msg = String(config.message ?? '');
      return msg ? `"${msg.slice(0, 40)}${msg.length > 40 ? '…' : ''}"` : 'Configure message →';
    }
    case 'AGENT': {
      const instr = String(config.instructions ?? '');
      return instr ? `"${instr.slice(0, 40)}${instr.length > 40 ? '…' : ''}"` : 'Configure instructions →';
    }
    case 'COLLECT_INFO': {
      const qs = Array.isArray(config.questions) ? config.questions : [];
      return qs.length ? `${qs.length} question${qs.length > 1 ? 's' : ''}` : 'Add questions →';
    }
    default:
      return '';
  }
}
