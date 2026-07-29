import initOpenCascade from "replicad-opencascadejs/src/replicad_single.js";
import wasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import { setOC } from "replicad";

let kernelPromise: Promise<void> | null = null;

/**
 * Boots the OpenCASCADE WebAssembly kernel and hands it to replicad.
 *
 * The wasm is about 11 MB, so loading is deferred until the first feature actually needs
 * geometry rather than paid on startup. The promise is cached, so concurrent rebuilds all
 * await the same initialisation instead of racing to start several.
 *
 * The application's content security policy already permits `wasm-unsafe-eval`, which is
 * what lets the module compile at all.
 */
export function initKernel(): Promise<void> {
  if (!kernelPromise) {
    kernelPromise = initOpenCascade({ locateFile: () => wasmUrl })
      .then((oc) => {
        setOC(oc as Parameters<typeof setOC>[0]);
      })
      .catch((error: unknown) => {
        // Clear the cache so a later attempt can retry rather than resolving a dead promise.
        kernelPromise = null;
        throw error;
      });
  }

  return kernelPromise;
}

/** Whether the kernel has finished booting, for reporting progress in the UI. */
export function isKernelStarted(): boolean {
  return kernelPromise !== null;
}
