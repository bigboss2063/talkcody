import { describe, expect, it, vi } from 'vitest';

const defaultMock = vi.fn();
const transformMock = vi.fn(async () => ({ code: '// transformed', map: 'map' }));

vi.mock('@swc/wasm-web', () => ({
  default: defaultMock,
  transform: transformMock,
}));

vi.mock('@swc/wasm-web/wasm_bg.wasm?url', () => ({
  default: 'mock-wasm-url',
}));

describe('custom-tool-compiler', () => {
  it('initializes swc with wasm url and transforms typescript', async () => {
    const { compileCustomTool } = await import('./custom-tool-compiler');

    const result = await compileCustomTool('export default {}', { filename: 'tool.ts' });

    expect(defaultMock).toHaveBeenCalledWith({ module_or_path: 'mock-wasm-url' });
    expect(transformMock).toHaveBeenCalledWith(
      'export default {}',
      expect.objectContaining({
        filename: 'tool.ts',
        jsc: expect.objectContaining({
          parser: expect.objectContaining({
            syntax: 'typescript',
            tsx: false,
          }),
        }),
      })
    );
    expect(result.code).toBe('// transformed');
    expect(result.sourceMap).toBe('map');
  });

  it('marks tsx files for tsx parsing', async () => {
    const { compileCustomTool } = await import('./custom-tool-compiler');

    await compileCustomTool('export default {}', { filename: 'tool.tsx' });

    expect(transformMock).toHaveBeenCalledWith(
      'export default {}',
      expect.objectContaining({
        jsc: expect.objectContaining({
          parser: expect.objectContaining({
            syntax: 'typescript',
            tsx: true,
          }),
        }),
      })
    );
  });
});
