import { beforeEach, describe, expect, it } from 'vitest';
import { getToolUIRenderers } from '@/lib/tool-adapter';
import { loadAllTools } from './index';

describe('tool UI registration', () => {
  beforeEach(async () => {
    await loadAllTools();
  });

  it('registers UI renderers for callAgentV2', () => {
    const renderers = getToolUIRenderers('callAgentV2');
    expect(renderers?.renderToolDoing).toBeDefined();
    expect(renderers?.renderToolResult).toBeDefined();
  });

  it('registers UI renderers for callAgent', () => {
    const renderers = getToolUIRenderers('callAgent');
    expect(renderers?.renderToolDoing).toBeDefined();
    expect(renderers?.renderToolResult).toBeDefined();
  });
});
