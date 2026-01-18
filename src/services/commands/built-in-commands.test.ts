import { describe, expect, it } from 'vitest';
import { CommandType } from '@/types/command';
import { getBuiltInCommands } from './built-in-commands';

describe('getBuiltInCommands', () => {
  it('includes create-tool command with preferred agent and install guidance', async () => {
    const commands = await getBuiltInCommands();
    const createTool = commands.find((command) => command.id === 'create-tool');

    expect(createTool).toBeDefined();
    expect(createTool?.name).toBe('create-tool');
    expect(createTool?.type).toBe(CommandType.AI_PROMPT);
    expect(createTool?.preferredAgentId).toBe('create-tool');

    const result = await createTool?.executor({}, {} as any);
    expect(result?.success).toBe(true);
    expect(result?.continueProcessing).toBe(true);
    expect(result?.aiMessage).toContain('custom TalkCody tool');
    expect(result?.aiMessage).toContain('Custom Tools');
    expect(result?.aiMessage).toContain('Tool Playground');
  });
});
