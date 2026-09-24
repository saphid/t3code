/**
 * Ambient DOM surface for the vendored libghostty-vt sources Manager.test.ts
 * imports cross-layer. This program carries no DOM lib, so without these
 * declarations `KeyboardEvent` resolves to @types/react's memberless DOM-less
 * fallback stub and `WebAssembly` to esbuild's type-only partial namespace.
 * Members mirror lib.dom.d.ts, limited to what the terminal core and wasm
 * loader read; the terminal extension's own project checks the same sources
 * against the full DOM lib.
 */

interface KeyboardEvent {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  getModifierState(key: string): boolean;
}

type BufferSource = ArrayBufferView | ArrayBuffer;

declare namespace WebAssembly {
  interface Memory {
    readonly buffer: ArrayBuffer;
  }
  interface Exports {
    readonly [name: string]: unknown;
  }
  interface Instance {
    readonly exports: Exports;
  }
  interface Table {
    readonly length: number;
    grow(delta: number): number;
    set(index: number, value: unknown): void;
  }
}

declare var WebAssembly: {
  instantiate(
    bytes: BufferSource,
    imports?: object,
  ): Promise<{ readonly instance: WebAssembly.Instance }>;
  readonly Memory: new (options: { initial: number }) => WebAssembly.Memory;
  readonly Table: new (options: { element: string; initial: number }) => WebAssembly.Table;
};
