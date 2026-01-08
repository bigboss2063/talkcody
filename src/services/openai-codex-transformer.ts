// src/services/openai-codex-transformer.ts
// Transforms request body for ChatGPT Codex API
// Reference: opencode-openai-codex-auth/lib/request/request-transformer.ts

import { logger } from '@/lib/logger';

import codexInstructions from './codex-instructions.md?raw';

/**
 * Input item type for Codex API
 */
export interface InputItem {
  type?: string;
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
  id?: string;
  call_id?: string;
  name?: string;
  output?: unknown;
}

/**
 * Reasoning configuration
 */
export interface ReasoningConfig {
  effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  summary: 'auto' | 'detailed' | 'none';
}

/**
 * Request body for Codex API
 */
export interface CodexRequestBody {
  model?: string;
  instructions?: string;
  input?: InputItem[];
  tools?: unknown[];
  store?: boolean;
  stream?: boolean;
  reasoning?: ReasoningConfig;
  text?: { verbosity?: string };
  include?: string[];
  max_output_tokens?: number;
  max_completion_tokens?: number;
  prompt_cache_key?: string;
}

export function normalizeModel(model: string | undefined): string {
  if (!model) return 'gpt-5.2-codex';

  // Strip provider prefix if present (e.g., "openai/gpt-5-codex" → "gpt-5-codex")
  const modelId = model.includes('/') ? (model.split('/').pop() ?? model) : model;
  const normalized = modelId.toLowerCase();
  if (normalized.includes('gpt-5.1-codex-max') || normalized.includes('gpt 5.1 codex max')) {
    return 'gpt-5.1-codex-max';
  }
  // Default fallback - use Codex for best tool support
  return 'gpt-5.2-codex';
}

export function getReasoningConfig(modelName: string | undefined): ReasoningConfig {
  const normalizedName = modelName?.toLowerCase() ?? '';

  const isGpt52CodexHigh = normalizedName === 'gpt-5.2-codex-high';
  const isGpt52Codex = normalizedName === 'gpt-5.2-codex';
  const isCodexMax = normalizedName === 'gpt-5.1-codex-max';

  // GPT 5.2, GPT 5.2 Codex, and Codex Max support xhigh reasoning
  const supportsXhigh = isGpt52CodexHigh || isGpt52Codex || isCodexMax;

  let effort: ReasoningConfig['effort'] = 'medium';
  if (isGpt52CodexHigh || supportsXhigh) {
    effort = 'high';
  }

  return {
    effort,
    summary: 'auto',
  };
}

/**
 * Filter input array for stateless Codex API
 * - Remove AI SDK-specific items (item_reference)
 * - Strip IDs from all remaining items
 */
export function filterInput(input: InputItem[] | undefined): InputItem[] | undefined {
  if (!Array.isArray(input)) return input;

  return input
    .filter((item) => {
      // Remove AI SDK constructs not supported by Codex API
      if (item.type === 'item_reference') {
        return false;
      }
      return true;
    })
    .map((item) => {
      // Strip IDs from all items (Codex API stateless mode)
      if (item.id) {
        const { id: _id, ...itemWithoutId } = item;
        return itemWithoutId as InputItem;
      }
      return item;
    });
}

/**
 * TalkCody-Codex Bridge prompt
 * Tells Codex it's running in TalkCody environment with specific tool mappings
 */
export const TALKCODY_CODEX_BRIDGE = `# Codex Running in TalkCody

You are running Codex through TalkCody, a cross-platform coding assistant. TalkCody provides different tools but follows Codex operating principles.

## CRITICAL: Tool Replacements

<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: edit tool for ALL file modifications
- Before modifying files: Verify you're using "edit", NOT "apply_patch"
</critical_rule>

<critical_rule priority="0">
❌ UPDATE_PLAN DOES NOT EXIST → ✅ USE "todowrite" INSTEAD
- NEVER use: update_plan, updatePlan, read_plan, readPlan
- ALWAYS use: todowrite for task/plan updates
- Before plan operations: Verify you're using "todowrite", NOT "update_plan"
</critical_rule>

## Available TalkCody Tools

**File Operations:**
- \`writeFile\` - Create new files
- \`editFile\` - Modify existing files (REPLACES apply_patch)
- \`readFile\` - Read file contents

**Search/Discovery:**
- \`codeSearch\` - Search file contents
- \`glob\` - Find files by pattern
- \`listFiles\` - List directories

**Execution:**
- \`bash\` - Run shell commands

**Network:**
- \`webFetch\` - Fetch web content
- \`webSearch\` - Search the web

**Task Management:**
- \`todowrite\` - Manage tasks/plans (REPLACES update_plan)

**Plan Management:**
- \`exitPlanMode\` - Exit plan mode and return to normal context
- \`askUserQuestions\` - Ask user clarifying questions

**Call Subagent:**
- \`callAgent\` - Invoke a subagent for specialized tasks
- you could call "explore" agent to explore and gather more information about a specific topic.
- you could call "plan" agent to create and manage plans.

## TalkCody Working Style

**Communication:**
- Send brief preambles (8-12 words) before tool calls, building on prior context
- Provide progress updates during longer tasks

**Execution:**
- Keep working autonomously until query is fully resolved before yielding
- Don't return to user with partial solutions

**Code Approach:**
- New projects: Be ambitious and creative
- Existing codebases: Surgical precision - modify only what's requested unless explicitly instructed to do otherwise

**Testing:**
- If tests exist: Start specific to your changes, then broader validation

`;

/**
 * Add TalkCody bridge message to input if tools are present
 */
export function addBridgeMessage(
  input: InputItem[] | undefined,
  hasTools: boolean
): InputItem[] | undefined {
  if (!hasTools || !Array.isArray(input)) return input;

  const bridgeMessage: InputItem = {
    type: 'message',
    role: 'developer',
    content: [
      {
        type: 'input_text',
        text: TALKCODY_CODEX_BRIDGE,
      },
    ],
  };

  return [bridgeMessage, ...input];
}

/**
 * Transform request body for Codex API
 *
 * @param body - Original request body
 * @param codexInstructions - Codex system instructions from GitHub
 * @returns Transformed request body
 */
export async function transformRequestBody(body: CodexRequestBody): Promise<CodexRequestBody> {
  const originalModel = body.model;
  const normalizedModel = normalizeModel(body.model);

  logger.info(`[CodexTransformer] Transforming request: ${originalModel} → ${normalizedModel}`);

  // Normalize model name for API call
  body.model = normalizedModel;

  // Codex required fields
  body.store = false; // ChatGPT backend REQUIRES store=false
  body.stream = true; // Always stream
  body.instructions = codexInstructions; // Use Codex instructions, not custom system prompt

  // Filter and transform input
  if (body.input && Array.isArray(body.input)) {
    body.input = filterInput(body.input);

    // Add bridge message for tool awareness
    body.input = addBridgeMessage(body.input, !!body.tools);
  }

  // Configure reasoning
  const reasoningConfig = getReasoningConfig(originalModel);
  body.reasoning = {
    ...body.reasoning,
    ...reasoningConfig,
  };

  // Configure text verbosity
  body.text = {
    ...body.text,
    verbosity: 'medium',
  };

  // Add include for encrypted reasoning content
  body.include = ['reasoning.encrypted_content'];

  // Remove unsupported parameters
  body.max_output_tokens = undefined;
  body.max_completion_tokens = undefined;
  return body;
}
