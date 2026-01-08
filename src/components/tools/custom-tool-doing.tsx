import { CustomToolDoingFallback } from '@/services/tools/custom-tool-ui-fallback';
import type { CustomToolDefinition } from '@/types/custom-tool';

interface CustomToolDoingProps {
  definition: CustomToolDefinition;
  input: Record<string, unknown>;
}

export function CustomToolDoing({ definition, input }: CustomToolDoingProps) {
  if (definition.ui?.Doing) {
    return definition.ui.Doing(input, { toolName: definition.name });
  }

  return <CustomToolDoingFallback toolName={definition.name} />;
}
