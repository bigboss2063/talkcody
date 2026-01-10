import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';
import { resolveCustomToolModule } from '@/lib/custom-tool-sdk/import-map';
import type { CustomToolDefinition } from '@/types/custom-tool';

export interface CompileResult {
  code: string;
  sourceMap?: string;
}

export interface CompileOptions {
  filename: string;
}

let swcReady: Promise<typeof import('@swc/wasm-web')> | null = null;

async function ensureSwcReady() {
  if (!swcReady) {
    swcReady = (async () => {
      const swc = await import('@swc/wasm-web');
      await swc.default({ module_or_path: swcWasmUrl });
      return swc;
    })();
  }
  return swcReady;
}

export async function compileCustomTool(
  source: string,
  options: CompileOptions
): Promise<CompileResult> {
  const swc = await ensureSwcReady();

  const result = await swc.transform(source, {
    filename: options.filename,
    sourceMaps: true,
    minify: false,
    jsc: {
      target: 'es2020',
      parser: {
        syntax: 'typescript',
        tsx: options.filename.endsWith('.tsx'),
      },
      transform: {
        react: {
          runtime: 'automatic',
        },
      },
    },
    module: {
      type: 'commonjs',
    },
  });

  return {
    code: result.code,
    sourceMap: result.map,
  };
}

function convertCommonJsToAsyncRequire(source: string): string {
  return source.replace(/\brequire\(/g, 'await __require(');
}

export async function createCustomToolModuleUrl(
  compiled: CompileResult,
  filename: string,
  baseDir?: string
): Promise<string> {
  const transformed = convertCommonJsToAsyncRequire(compiled.code);

  const module = `const __moduleCache = new Map();
const __baseDir = ${baseDir !== undefined ? JSON.stringify(baseDir) : 'undefined'};
const __require = async (specifier) => {
  if (__moduleCache.has(specifier)) {
    return __moduleCache.get(specifier);
  }
  const resolved = await window.__talkcodyResolveCustomToolModule(specifier, __baseDir);
  if (!resolved) {
    throw new Error(\`Custom tool import not found: \${specifier}\`);
  }
  __moduleCache.set(specifier, resolved);
  return resolved;
};

const __load = async () => {
  const exports = {};
  const module = { exports };

  ${transformed}

  return module.exports?.default ?? module.exports;
};

export default await __load();
//# sourceURL=custom-tool:${filename}
`;

  const blob = new Blob([module], { type: 'text/javascript' });
  return URL.createObjectURL(blob);
}

export async function resolveCustomToolDefinition(
  moduleUrl: string
): Promise<CustomToolDefinition> {
  const module = await import(/* @vite-ignore */ moduleUrl);
  const resolved = (module as { default?: CustomToolDefinition }).default ?? module;
  return resolved as CustomToolDefinition;
}

export async function registerCustomToolModuleResolver(baseDir?: string) {
  if (typeof window === 'undefined') return;
  if ((window as any).__talkcodyResolveCustomToolModule) return;

  (window as any).__talkcodyResolveCustomToolModule = async (
    specifier: string,
    requestBaseDir?: string
  ) => {
    const effectiveBaseDir = requestBaseDir ?? baseDir;
    return await resolveCustomToolModule(specifier, effectiveBaseDir);
  };
}

export type CustomToolCompileResult = {
  definition: CustomToolDefinition;
  sourceMap?: string;
};
