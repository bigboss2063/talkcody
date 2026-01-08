/// <reference types="vite/client" />

declare global {
  interface Window {
    __talkcodyResolveCustomToolModule?: (specifier: string) => Promise<unknown>;
  }
}

export {};
