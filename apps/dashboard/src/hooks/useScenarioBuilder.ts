import { useState, useCallback } from 'react';
import { FlowDefinition, TriggerConfig } from '@/types/flow';
import { buildScenarioFlow } from '@/lib/scenarioBuilders';

export interface ScenarioFormState {
  [key: string]: string | boolean | undefined;
}

export function useScenarioBuilder(templateId: string) {
  const [formData, setFormData] = useState<ScenarioFormState>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback((key: string, value: string | boolean | undefined) => {
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

        // Derive triggerType from the TRIGGER node config so S4 broadcasts correctly
        const triggerNode = definition.nodes.find((n) => n.type === 'TRIGGER');
        const triggerType =
          (triggerNode?.config as TriggerConfig | undefined)?.triggerType ?? 'button_click';

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
