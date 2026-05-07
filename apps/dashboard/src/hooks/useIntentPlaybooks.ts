/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/hooks/useIntentPlaybooks.ts
 * Role    : React Query hooks for Intent Playbooks CRUD.
 *           Wraps the /v1/intent-playbooks API endpoints.
 * Exports : useIntentPlaybooks, useCreatePlaybook, useUpdatePlaybook,
 *           useDeletePlaybook, useTogglePlaybook, PlaybookRow, IntentKey,
 *           NextStepType, INTENT_KEY_LABELS, NEXT_STEP_LABELS
 * DO NOT  : Import from apps/api or packages/db directly
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type IntentKey =
  | 'GREETING' | 'BROWSING' | 'PRODUCT_INQUIRY' | 'OBJECTION_HANDLING'
  | 'CHECKOUT_INTENT' | 'OUT_OF_STOCK' | 'WANTS_CONSULTATION' | 'GENERAL_INQUIRY'
  | 'SCHEDULING';

export type NextStepType =
  | 'continue_conversation' | 'checkout' | 'schedule_consultation'
  | 'human_handoff' | 'collect_info';

export interface PlaybookRow {
  id: string;
  tenantId: string;
  intentKey: IntentKey;
  label: string;
  description: string | null;
  isActive: boolean;
  priority: number;
  systemPromptAddition: string;
  toneNote: string | null;
  nextStepType: NextStepType;
  nextStepConfig: Record<string, unknown> | null;
  detectionKeywords: string[] | null;
  fallbackMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const INTENT_KEY_LABELS: Record<IntentKey, string> = {
  GREETING: 'Greeting',
  BROWSING: 'Browsing',
  PRODUCT_INQUIRY: 'Product Inquiry',
  OBJECTION_HANDLING: 'Objection Handling',
  CHECKOUT_INTENT: 'Checkout Intent',
  OUT_OF_STOCK: 'Out of Stock',
  WANTS_CONSULTATION: 'Wants Consultation (asks to book, no date yet)',
  GENERAL_INQUIRY: 'General Inquiry',
  SCHEDULING: 'Scheduling (giving a specific date/time)',
};

export const NEXT_STEP_LABELS: Record<NextStepType, string> = {
  continue_conversation: 'Continue Conversation',
  checkout: 'Guide to Checkout',
  schedule_consultation: 'Schedule Consultation',
  human_handoff: 'Hand Off to Human',
  collect_info: 'Collect Information',
};

export function useIntentPlaybooks() {
  return useQuery({
    queryKey: ['intent-playbooks'],
    queryFn: async () => {
      const res = await api.get('/intent-playbooks');
      return res.data.playbooks as PlaybookRow[];
    },
  });
}

export function useCreatePlaybook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<PlaybookRow>) => {
      const res = await api.post('/intent-playbooks', data);
      return res.data.playbook as PlaybookRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intent-playbooks'] }),
  });
}

export function useUpdatePlaybook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<PlaybookRow> & { id: string }) => {
      const res = await api.put(`/intent-playbooks/${id}`, data);
      return res.data.playbook as PlaybookRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intent-playbooks'] }),
  });
}

export function useDeletePlaybook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/intent-playbooks/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intent-playbooks'] }),
  });
}

export function useTogglePlaybook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.patch(`/intent-playbooks/${id}/toggle`);
      return res.data.playbook as PlaybookRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intent-playbooks'] }),
  });
}
