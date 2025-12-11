import type { ToolSet } from 'ai';
import { logger } from '@/lib/logger';
import { isMCPTool, multiMCPAdapter } from '@/lib/mcp/multi-mcp-adapter';
import { convertToolsForAI } from '@/lib/tool-adapter';
import {
  getToolLabel,
  getToolMetadata,
  getToolsForUISync,
  isValidToolName as isValidToolNameFromTools,
  loadAllTools,
  type ToolName,
} from '@/lib/tools';

// Re-export for backward compatibility
export { isValidToolName } from '@/lib/tools';

/**
 * Registry of all available tools that can be used by agents.
 * This mapping allows us to restore tools from database JSON configs
 * back to proper Vercel AI ToolSet objects.
 *
 * Tools are now automatically loaded from src/lib/tools/index.ts
 * To add a new tool, simply add it to TOOL_DEFINITIONS in that file.
 */

// Cache for tool registry
let registryCache: Record<
  string,
  { ref: unknown; label: string; isBeta?: boolean; badgeLabel?: string }
> | null = null;

/**
 * Get the tool registry (lazy-loaded and cached)
 */
async function getToolRegistry(): Promise<
  Record<string, { ref: unknown; label: string; isBeta?: boolean; badgeLabel?: string }>
> {
  if (registryCache) {
    return registryCache;
  }

  const tools = await loadAllTools();
  const registry: Record<
    string,
    { ref: unknown; label: string; isBeta?: boolean; badgeLabel?: string }
  > = {};

  for (const [toolName, toolRef] of Object.entries(tools)) {
    const metadata = getToolMetadata(toolName);
    registry[toolName] = {
      ref: toolRef,
      label: getToolLabel(toolName),
      isBeta: (toolRef as any)?.isBeta === true || metadata.isBeta === true,
      badgeLabel: metadata.badgeLabel ?? (toolRef as any)?.badgeLabel,
    };
  }

  registryCache = registry;
  return registry;
}

/**
 * Legacy synchronous access to TOOL_REGISTRY
 * NOTE: This will be empty until tools are loaded
 * Use restoreToolsFromConfig() for async access
 */
export const TOOL_REGISTRY: Record<
  string,
  { ref: unknown; label: string; isBeta?: boolean; badgeLabel?: string }
> = {};

/**
 * Converts a tools configuration (typically loaded from database JSON)
 * back to a proper Vercel AI ToolSet that can be used with streamText().
 *
 * @param toolsConfig - The tools configuration, can be:
 *   - A ToolSet object (already properly formatted)
 *   - A Record<string, any> where keys are tool names
 *   - An array of tool names
 *   - A JSON string representation of the above
 * @returns A properly formatted ToolSet for use with Vercel AI SDK
 */
export async function restoreToolsFromConfig(toolsConfig: unknown): Promise<ToolSet> {
  if (!toolsConfig) {
    return {};
  }

  // If it's already a properly formatted ToolSet, still convert it to ensure UI renderers are registered
  if (typeof toolsConfig === 'object' && !Array.isArray(toolsConfig)) {
    // Check if this looks like a ToolSet (has tool-like objects)
    const values = Object.values(toolsConfig);
    if (
      values.length > 0 &&
      values.every(
        (v) =>
          typeof v === 'object' &&
          v !== null &&
          ('description' in v || 'execute' in v || 'inputSchema' in v)
      )
    ) {
      // Important: Even if it's already a ToolSet, we must pass it through convertToolsForAI
      // to ensure UI renderers (renderToolDoing, renderToolResult) are registered in toolUIRegistry
      return convertToolsForAI(toolsConfig as Record<string, unknown>);
    }
  }

  // Parse JSON string if needed
  let parsedConfig = toolsConfig;
  if (typeof toolsConfig === 'string') {
    try {
      parsedConfig = JSON.parse(toolsConfig);
    } catch (error) {
      logger.warn('Failed to parse tools config JSON:', error);
      return {};
    }
  }

  // Load tool registry
  const registry = await getToolRegistry();
  const rawTools: Record<string, unknown> = {};

  if (Array.isArray(parsedConfig)) {
    // Handle array of tool names: ["bashTool", "codeSearch", "mcp__resolve-library-id"]
    for (const toolName of parsedConfig) {
      if (typeof toolName === 'string') {
        if (isValidToolNameFromTools(toolName) && registry[toolName]) {
          rawTools[toolName] = registry[toolName].ref;
        } else if (isMCPTool(toolName)) {
          // Handle new MCP tools with server prefix format: {server_id}__{tool_name}
          try {
            const mcpTool = await multiMCPAdapter.getAdaptedTool(toolName);
            rawTools[toolName] = mcpTool;
          } catch (error) {
            logger.warn(`Failed to load MCP tool: ${toolName}`, error);
          }
        } else {
          logger.warn(`Unknown tool in array: ${toolName}`);
        }
      }
    }
  } else if (typeof parsedConfig === 'object' && parsedConfig !== null) {
    // Handle object with tool names as keys: { "bashTool": {}, "codeSearch": {}, "mcp__resolve-library-id": {} }
    for (const [toolName, _toolConfig] of Object.entries(parsedConfig)) {
      if (isValidToolNameFromTools(toolName) && registry[toolName]) {
        rawTools[toolName] = registry[toolName].ref;
      } else if (isMCPTool(toolName)) {
        // Handle new MCP tools with server prefix format: {server_id}__{tool_name}
        try {
          const mcpTool = await multiMCPAdapter.getAdaptedTool(toolName);
          rawTools[toolName] = mcpTool;
        } catch (error) {
          logger.warn(`Failed to load MCP tool: ${toolName}`, error);
        }
      } else {
        logger.warn(`Unknown tool in config: ${toolName}`);
      }
    }
  } else {
    logger.warn('Unsupported tools config format:', typeof parsedConfig);
  }

  // Convert tools for AI and register UI renderers
  return convertToolsForAI(rawTools);
}

/**
 * Gets the list of all available tool names in the registry.
 * Useful for UI components that need to show available tools.
 */
export async function getAvailableToolNames(): Promise<ToolName[]> {
  const registry = await getToolRegistry();
  return Object.keys(registry) as ToolName[];
}

/**
 * Gets a specific tool by name from the registry.
 */
export async function getToolByName(toolName: string): Promise<unknown | undefined> {
  const registry = await getToolRegistry();
  return registry[toolName]?.ref;
}

/**
 * Gets all available tools formatted for UI display (async version)
 * Returns tools in the format expected by the agents page.
 */
export async function getAvailableToolsForUI(): Promise<
  Array<{
    id: string;
    label: string;
    ref: unknown;
    isBeta: boolean;
    badgeLabel?: string;
  }>
> {
  const registry = await getToolRegistry();
  return Object.entries(registry).map(([id, { ref, label }]) => {
    const isBeta = (ref as any)?.isBeta === true || registry[id]?.isBeta === true;
    const badgeLabel = registry[id]?.badgeLabel ?? ((ref as any)?.badgeLabel as string | undefined);
    return {
      id,
      label,
      ref,
      isBeta,
      badgeLabel,
    };
  });
}

/**
 * Gets all available tools formatted for UI display (synchronous version)
 * Only works after tools have been preloaded at app startup
 */
export function getAvailableToolsForUISync(): Array<{
  id: string;
  label: string;
  ref: unknown;
  isBeta: boolean;
  badgeLabel?: string;
}> {
  return getToolsForUISync();
}
