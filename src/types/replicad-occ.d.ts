/**
 * The OpenCASCADE WebAssembly build ships an Emscripten loader with no usable module
 * declaration for its deep path, so the loader signature is declared here rather than
 * pulling in the 400 kB of generated OCCT class typings, which TypeScript would have to
 * re-check on every build.
 */
declare module "replicad-opencascadejs/src/replicad_single.js" {
  interface EmscriptenOptions {
    locateFile?: (path: string, scriptDirectory: string) => string;
    wasmBinary?: ArrayBuffer;
  }

  const initOpenCascade: (options?: EmscriptenOptions) => Promise<unknown>;
  export default initOpenCascade;
}

declare module "replicad-opencascadejs/src/replicad_single.wasm?url" {
  const url: string;
  export default url;
}
