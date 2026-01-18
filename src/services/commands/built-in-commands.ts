// src/services/commands/built-in-commands.ts

import { z } from 'zod';
import { compactTaskContext } from '@/services/context/manual-context-compaction';
import type { Command, CommandContext } from '@/types/command';
import { CommandCategory, CommandType } from '@/types/command';

export async function getBuiltInCommands(): Promise<Command[]> {
  const commands: Command[] = [
    // /new - Create new task
    {
      id: 'new-task',
      name: 'new',
      description: 'Create a new task',
      category: CommandCategory.TASK,
      type: CommandType.ACTION,
      executor: async (_args, context) => {
        try {
          if (context.createNewTask) {
            await context.createNewTask();
            return {
              success: true,
              message: 'New task created successfully',
            };
          }
          return {
            success: false,
            error: 'Unable to create new task - function not available',
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to create new task: ${error}`,
          };
        }
      },
      isBuiltIn: true,
      enabled: true,
      icon: 'Plus',
      examples: ['/new'],
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // /compact - Manually trigger context compaction for current task
    {
      id: 'compact-task',
      name: 'compact',
      description: 'Manually compact the current task context',
      category: CommandCategory.TASK,
      type: CommandType.ACTION,
      executor: async (_args, context) => executeCompactCommand(context),
      isBuiltIn: true,
      enabled: true,
      icon: 'Archive',
      aliases: ['compress'],
      requiresTask: true,
      examples: ['/compact'],
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // /init - Initialize project with AGENTS.md
    {
      id: 'init-project',
      name: 'init',
      description: 'Initialize project with AGENTS.md guide',
      category: CommandCategory.PROJECT,
      type: CommandType.AI_PROMPT,
      parameters: [
        {
          name: 'type',
          description: 'Project type (web, api, mobile, etc.)',
          required: false,
          type: 'string',
        },
      ],
      parametersSchema: z.object({
        type: z.string().optional(),
        _raw: z.string().optional(),
      }),
      executor: async (args, _context) => {
        const projectType = args.type || args._raw || '';

        let aiMessage =
          'Please help initialize this project by creating an AGENTS.md file that serves as a comprehensive guide for AI agents working on this project. ';

        if (projectType) {
          aiMessage += `The project type is: ${projectType}. `;
        }

        return {
          success: true,
          message: 'Project initialization started',
          continueProcessing: true,
          aiMessage,
        };
      },
      isBuiltIn: true,
      enabled: true,
      icon: 'FileText',
      preferredAgentId: 'init-project',
      aliases: ['initialize'],
      examples: ['/init', '/init web application'],
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // /create-tool - Create a custom tool
    {
      id: 'create-tool',
      name: 'create-tool',
      description: 'Create and install a custom tool',
      category: CommandCategory.PROJECT,
      type: CommandType.AI_PROMPT,
      parameters: [
        {
          name: 'name',
          description: 'Tool name or short description',
          required: false,
          type: 'string',
        },
      ],
      parametersSchema: z.object({
        name: z.string().optional(),
        _raw: z.string().optional(),
      }),
      executor: async (args, _context) => {
        const toolHint = args.name || args._raw || '';

        let aiMessage =
          'Please help create a custom TalkCody tool. Gather requirements (name, purpose, inputs, permissions, output) and produce a valid tool definition file using toolHelper from @/lib/custom-tool-sdk. ' +
          'The tool should be saved under .talkcody/tools as a .tsx file and include renderToolDoing/renderToolResult when useful. ' +
          'Use simpleFetch from @/lib/tauri-fetch for network calls. ' +
          'After creation, ensure the tool is installed by refreshing Custom Tools (Settings → Custom Tools → Refresh) or using Tool Playground Install. ';

        if (toolHint) {
          aiMessage += `The tool request is: ${toolHint}. `;
        }

        return {
          success: true,
          message: 'Custom tool creation started',
          continueProcessing: true,
          aiMessage,
        };
      },
      isBuiltIn: true,
      enabled: true,
      icon: 'Wrench',
      preferredAgentId: 'create-tool',
      aliases: ['new-tool', 'tool'],
      examples: ['/create-tool', '/create-tool weather fetcher'],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  return commands;
}

/**
 * Execute compact command logic directly
 */
async function executeCompactCommand(
  context: CommandContext
): Promise<{ success: boolean; message: string; error?: string }> {
  const { taskId } = context;

  if (!taskId) {
    return {
      success: false,
      message: 'No active task - cannot compact context',
      error: 'No active task - cannot compact context',
    };
  }

  const result = await compactTaskContext(taskId);

  return {
    success: result.success,
    message: result.message,
    error: result.error,
  };
}
