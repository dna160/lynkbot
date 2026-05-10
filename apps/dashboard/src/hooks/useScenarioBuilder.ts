import { useState, useCallback } from 'react';
import { FlowDefinition, TriggerConfig } from '@/types/flow';
import { buildScenarioFlow } from '@/lib/scenarioBuilders';

export interface ScenarioFormState {
  [key: string]: string | boolean | string[] | undefined;
}

export function useScenarioBuilder(templateId: string, initialData?: Partial<ScenarioFormState>) {
  const [formData, setFormData] = useState<ScenarioFormState>(initialData ?? {});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback((key: string, value: string | boolean | string[] | undefined) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const buildFlow = useCallback((): FlowDefinition => {
    try {
      setError(null);
      return buildScenarioFlow(templateId, formData);
    } catch (err: any) {
      const message = err?.message || 'Failed to build flow';
      setError(message);
      throw new Error(message);
    }
  }, [templateId, formData]);

  const saveFlow = useCallback(
    async (flowName: string, activate: boolean = false) => {
      try {
        setIsLoading(true);
        setError(null);
        const definition = buildFlow();

        // Derive the API triggerType from the flow's trigger node type or config.
        // v3 typed trigger nodes map directly to API trigger type strings.
        // Legacy TRIGGER node falls back to config.triggerType for backward compat.
        const triggerNode = definition.nodes.find((n) =>
          n.type === 'TRIGGER' || n.type === 'TRIGGER_INBOUND_KEYWORD' ||
          n.type === 'TRIGGER_ORDER_EVENT' || n.type === 'TRIGGER_TIME_SINCE_EVENT'
        );
        let triggerType: string;
        if (triggerNode?.type === 'TRIGGER_INBOUND_KEYWORD') {
          triggerType = 'inbound_keyword';
        } else if (triggerNode?.type === 'TRIGGER_ORDER_EVENT') {
          triggerType = 'order_event';
        } else if (triggerNode?.type === 'TRIGGER_TIME_SINCE_EVENT') {
          triggerType = 'time_based';
        } else {
          // Legacy TRIGGER node — read from config
          const cfg = (triggerNode?.config as TriggerConfig | undefined);
          const cfgType = cfg?.triggerType as string | undefined;
          triggerType = cfgType === 'broadcast' ? 'time_based' : (cfgType ?? 'inbound_keyword');
        }

        const { flowsApi } = await import('@/lib/api');
        const response = await flowsApi.create({
          name: flowName,
          definition,
          triggerType,
        });

        const flowId = response.data?.id;
        if (activate && flowId) {
          await flowsApi.updateStatus(flowId, 'active');
        }

        return response.data;
      } catch (err: any) {
        const message = err?.response?.data?.message ?? err?.message ?? 'Failed to save flow';
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [buildFlow],
  );

  return {
    formData,
    updateField,
    buildFlow,
    saveFlow,
    isLoading,
    error,
  };
}
