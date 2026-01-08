import { CustomToolResultFallback } from '@/services/tools/custom-tool-ui-fallback';
import type { CustomToolDefinition } from '@/types/custom-tool';

interface CustomToolResultProps {
  definition: CustomToolDefinition;
  input: Record<string, unknown>;
  output: unknown;
}

export function CustomToolResult({ definition, input, output }: CustomToolResultProps) {
  if (definition.ui?.Result) {
    return definition.ui.Result(output, input, { toolName: definition.name });
  }

  if (output && typeof output === 'object') {
    const outputObj = output as { success?: boolean; error?: string };
    if (outputObj.success === false || outputObj.error) {
      return (
        <CustomToolResultFallback
          success={outputObj.success ?? false}
          error={outputObj.error || 'Custom tool failed'}
        />
      );
    }
  }

  const message = typeof output === 'string' ? output : 'Custom tool executed';
  return <CustomToolResultFallback message={message} success={true} />;
}
