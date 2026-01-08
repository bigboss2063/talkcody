import type { CustomToolDefinition } from '@/types/custom-tool';

export type CustomToolModuleRegistry = Record<string, unknown>;

const moduleCache = new Map<string, unknown>();
const moduleRegistry: CustomToolModuleRegistry = {};

const builtinLoaders = new Map<string, () => Promise<unknown>>([
  ['react', () => import('react')],
  ['react/jsx-runtime', () => import('react/jsx-runtime')],
  ['recharts', () => import('recharts')],
  ['zod', () => import('zod')],
]);

const internalModuleLoaders = import.meta.glob('/src/**/*.{ts,tsx,js,jsx}');

function buildInternalCandidates(specifier: string): string[] {
  if (!specifier.startsWith('@/')) {
    return [];
  }

  const relative = specifier.replace(/^@\//, '');
  const base = `/src/${relative}`;
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
}

async function loadInternalModule(specifier: string): Promise<unknown> {
  const candidates = buildInternalCandidates(specifier);
  for (const candidate of candidates) {
    const loader = internalModuleLoaders[candidate];
    if (loader) {
      return await loader();
    }
  }
  return undefined;
}

export function getCustomToolModuleRegistry() {
  return moduleRegistry;
}

export function registerCustomToolModule(alias: string, moduleRef: unknown) {
  moduleRegistry[alias] = moduleRef;
  moduleCache.set(alias, moduleRef);
}

export async function resolveCustomToolModule(alias: string): Promise<unknown> {
  if (moduleCache.has(alias)) {
    return moduleCache.get(alias);
  }

  if (alias in moduleRegistry) {
    const registered = moduleRegistry[alias];
    moduleCache.set(alias, registered);
    return registered;
  }

  const builtinLoader = builtinLoaders.get(alias);
  if (builtinLoader) {
    const loaded = await builtinLoader();
    moduleCache.set(alias, loaded);
    return loaded;
  }

  const internalModule = await loadInternalModule(alias);
  if (internalModule) {
    moduleCache.set(alias, internalModule);
    return internalModule;
  }

  return undefined;
}

export function isCustomToolDefinition(value: unknown): value is CustomToolDefinition {
  return Boolean(value) && typeof value === 'object' && 'name' in (value as object);
}
