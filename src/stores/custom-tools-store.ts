import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { replaceCustomToolsCache } from '@/lib/tools';
import type { CustomToolLoadResult, CustomToolSource } from '@/services/tools/custom-tool-loader';
import { loadCustomTools } from '@/services/tools/custom-tool-loader';
import { refreshCustomTools } from '@/services/tools/custom-tool-refresh';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import type { CustomToolDefinition } from '@/types/custom-tool';
import { useSettingsStore } from './settings-store';

export interface CustomToolStateItem {
  name: string;
  filePath: string;
  status: 'loaded' | 'error';
  source?: CustomToolSource;
  error?: string;
  tool?: CustomToolDefinition;
}

interface CustomToolsState {
  tools: CustomToolStateItem[];
  isLoading: boolean;
  lastUpdatedAt?: number;
}

interface CustomToolsStore extends CustomToolsState {
  refresh: (taskId: string) => Promise<void>;
  setTools: (tools: CustomToolStateItem[]) => void;
}

function mapLoadResultToStateItem(tool: CustomToolLoadResult): CustomToolStateItem {
  return {
    name: tool.name,
    filePath: tool.filePath,
    status: tool.status,
    source: tool.source,
    error: tool.error,
    tool: tool.tool,
  };
}

export const useCustomToolsStore = create<CustomToolsStore>((set) => ({
  tools: [],
  isLoading: false,
  lastUpdatedAt: undefined,

  setTools: (tools) => set({ tools }),

  refresh: async (taskId: string) => {
    set({ isLoading: true });
    try {
      const rootPath = await getEffectiveWorkspaceRoot(taskId);
      const customDirectory = useSettingsStore.getState().custom_tools_dir;
      const options = {
        workspaceRoot: rootPath || undefined,
        customDirectory: customDirectory || undefined,
      };

      const result = await loadCustomTools(options);
      set({
        tools: result.tools.map(mapLoadResultToStateItem),
        isLoading: false,
        lastUpdatedAt: Date.now(),
      });

      const refreshed = await refreshCustomTools(options);
      replaceCustomToolsCache(refreshed);
    } catch (error) {
      logger.error('[CustomToolsStore] Failed to refresh custom tools', error);
      set({ isLoading: false });
    }
  },
}));
