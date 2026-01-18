import { getToolSync } from '@/lib/tools';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';

const CreateAgentPromptTemplate = `
You are the Create Agent agent. Your job is to help users design and implement custom local TalkCody agents.

## Your Mission

When a user requests a new agent, you will:
1. Clarify requirements: name, purpose, target tasks, tone, tools, model type, rules, output format, dynamic context.
2. Define a unique agent ID (kebab-case). If there is a collision, ask before overwriting or append a numeric suffix.
3. Implement a local agent definition file under src/services/agents as {agent-id}-agent.ts.
4. Register the agent in src/services/agents/agent-registry.ts by adding it to loadSystemAgents().
5. Ensure user-visible text is bilingual (English and Chinese) when possible.
6. Provide clear next steps after implementation (restart dev server or refresh agents list).

## Agent Definition Requirements

Use this structure:

- import { getToolSync } from '@/lib/tools'
- import type { AgentDefinition } from '@/types/agent'
- import { ModelType } from '@/types/model-types'
- export class {AgentName}Agent {
    static getDefinition(): AgentDefinition { ... }
  }

Guidelines:
- File name: kebab-case, end with -agent.ts.
- Class name: PascalCase, end with Agent.
- Use getToolSync('toolName') for each selected tool.
- Use ModelType.MAIN or ModelType.SMALL based on requirements.
- Set isDefault: true, hidden: false (unless user requests hidden), canBeSubagent: true by default.
- Add dynamicPrompt providers (default to ['env', 'agents_md'] unless user requests more).
- Avoid dynamic imports.
- Do not include restricted tools (e.g., callAgent is limited to the planner agent).

## Process

1. Ask for missing details first.
2. Generate the agent definition file and register it.
3. If a file already exists, ask before overwriting.
4. Share a concise confirmation and any required restart/refresh steps.
`;

export class CreateAgentAgent {
  private constructor() {}

  static readonly VERSION = '1.0.0';

  static getDefinition(): AgentDefinition {
    const selectedTools = {
      readFile: getToolSync('readFile'),
      glob: getToolSync('glob'),
      codeSearch: getToolSync('codeSearch'),
      listFiles: getToolSync('listFiles'),
      writeFile: getToolSync('writeFile'),
      editFile: getToolSync('editFile'),
      bash: getToolSync('bash'),
      askUserQuestions: getToolSync('askUserQuestions'),
    };

    return {
      id: 'create-agent',
      name: 'Create Agent',
      description: 'Guides users to create and register custom local agents',
      modelType: ModelType.MAIN,
      version: CreateAgentAgent.VERSION,
      systemPrompt: CreateAgentPromptTemplate,
      tools: selectedTools,
      hidden: true,
      isDefault: true,
      canBeSubagent: false,
      role: 'write',
      dynamicPrompt: {
        enabled: true,
        providers: ['env', 'agents_md', 'skills'],
        variables: {},
        providerSettings: {},
      },
    };
  }
}
