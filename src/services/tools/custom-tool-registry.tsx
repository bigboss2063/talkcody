import { createTool } from '@/lib/create-tool';
import type { CustomToolDefinition } from '@/types/custom-tool';
import type { ToolWithUI } from '@/types/tool';
import { ensureCustomToolPermissions } from './custom-tool-permission';
import { CustomToolDoingFallback, CustomToolResultFallback } from './custom-tool-ui-fallback';

function fallbackDescription(definition: CustomToolDefinition) {
  return definition.description?.en || definition.description?.zh || definition.name;
}

export function adaptCustomTool(definition: CustomToolDefinition): ToolWithUI {
  const description = fallbackDescription(definition);

  const renderToolDoing = (params: Record<string, unknown>) => {
    if (definition.ui?.Doing) {
      return definition.ui.Doing(params, { toolName: definition.name });
    }

    return <CustomToolDoingFallback toolName={definition.name} />;
  };

  const renderToolResult = (result: unknown, params: Record<string, unknown>) => {
    if (definition.ui?.Result) {
      return definition.ui.Result(result, params, { toolName: definition.name });
    }

    if (result && typeof result === 'object') {
      const resultObj = result as { success?: boolean; error?: string };
      if (resultObj.success === false || resultObj.error) {
        return (
          <CustomToolResultFallback
            success={resultObj.success ?? false}
            error={resultObj.error || 'Custom tool failed'}
          />
        );
      }
    }

    const message = typeof result === 'string' ? result : 'Custom tool executed';
    return <CustomToolResultFallback message={message} success={true} />;
  };

  return createTool({
    name: definition.name,
    description,
    inputSchema: definition.args,
    canConcurrent: false,
    hidden: definition.hidden,
    execute: async (params, context) => {
      const requested = definition.permissions ?? [];
      if (requested.length > 0) {
        ensureCustomToolPermissions(definition.name, requested);
      }

      return await definition.execute(params, context);
    },
    renderToolDoing,
    renderToolResult,
  });
}

export function adaptCustomTools(definitions: CustomToolDefinition[]): Record<string, ToolWithUI> {
  const tools: Record<string, ToolWithUI> = {};

  for (const definition of definitions) {
    tools[definition.name] = adaptCustomTool(definition);
  }

  return tools;
}
