import { tool } from 'ai';
import type { ToolInput, ToolOutput, ToolWithUI } from '@/types/tool';

// Global registry to store UI renderers for tools
const toolUIRegistry = new Map<
  string,
  {
    renderToolDoing: (params: ToolInput) => React.ReactElement;
    renderToolResult: (result: ToolOutput, params: ToolInput) => React.ReactElement;
  }
>();

export function registerToolUIRenderers(toolWithUI: ToolWithUI, keyName: string) {
  if (toolUIRegistry.has(keyName)) return;

  toolUIRegistry.set(keyName, {
    renderToolDoing: toolWithUI.renderToolDoing,
    renderToolResult: toolWithUI.renderToolResult,
  });
}

/**
 * Convert ToolWithUI to ai library compatible tool and register UI renderers
 */
export function convertToolForAI(toolWithUI: ToolWithUI, keyName: string) {
  registerToolUIRenderers(toolWithUI, keyName);

  // Return vercel ai library compatible tool
  return Object.defineProperty(
    tool({
      description: toolWithUI.description,
      inputSchema: toolWithUI.inputSchema,
      execute: toolWithUI.execute,
    }),
    'description',
    {
      get: () => toolWithUI.description,
      enumerable: true,
      configurable: true,
    }
  );
}

/**
 * Get UI renderers for a tool
 */
export function getToolUIRenderers(toolName: string) {
  return toolUIRegistry.get(toolName);
}

/**
 * Convert a set of tools (mixed ToolWithUI and legacy) to ai library format
 */
export function convertToolsForAI(tools: Record<string, unknown>) {
  const aiTools: Record<string, any> = {};

  for (const [key, toolObj] of Object.entries(tools)) {
    if (toolObj && typeof toolObj === 'object') {
      // logger.info('[ToolAdapter] Processing tool:', key, {
      //   hasRenderToolDoing: 'renderToolDoing' in toolObj,
      //   hasRenderToolResult: 'renderToolResult' in toolObj,
      //   hasExecute: 'execute' in toolObj,
      //   hasInputSchema: 'inputSchema' in toolObj,
      //   isInRegistry: toolUIRegistry.has(key)
      // });

      // Check if it's a ToolWithUI
      if ('renderToolDoing' in toolObj && 'renderToolResult' in toolObj) {
        // logger.info('[ToolAdapter] Tool has UI renderers, registering:', key);
        aiTools[key] = convertToolForAI(toolObj as ToolWithUI, key);
      } else {
        // // It's already an adapted tool (e.g., MCP tool or previously converted tool)
        // logger.info('[ToolAdapter] Tool looks like a pre-adapted tool, using directly:', key);

        // Just use directly without re-wrapping
        aiTools[key] = toolObj as any;
      }
    }
  }

  return aiTools;
}
