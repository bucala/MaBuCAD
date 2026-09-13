import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * Serves the `?url` import of the OpenCASCADE wasm with an absolute filesystem path
 * instead of a dev-server URL. `src/kernel/occ.ts` loads the 11 MB kernel via
 * `replicad-opencascadejs/src/replicad_single.wasm?url`, which Vite resolves to a
 * `/node_modules/...` URL in the browser — under Node, Emscripten's loader takes that
 * literally as a filesystem path, looks for it at the drive root and aborts with ENOENT.
 * Aliased to a virtual module that exports the real absolute path, `locateFile` hands the
 * loader something `readFileSync` can actually open, letting kernel-backed specs (the
 * rebuild cache's correctness suite, benchmarks) run under vitest exactly like the pure
 * logic suites do. The app's own build is untouched — this plugin exists only in the
 * test config.
 */
function absoluteWasmUrl(): Plugin {
  const specifier = "replicad-opencascadejs/src/replicad_single.wasm?url";
  const virtualId = "\0replicad-single-wasm-path";
  return {
    name: "absolute-wasm-url",
    enforce: "pre",
    resolveId(source) {
      if (source === specifier) return virtualId;
      return null;
    },
    load(id) {
      if (id !== virtualId) return null;
      const wasmPath = fileURLToPath(
        new URL("./node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
      );
      return `export default ${JSON.stringify(wasmPath)}`;
    },
  };
}

/**
 * Unit-test configuration, separate from `vite.config.ts` on purpose: the app config pulls
 * in `@vitejs/plugin-react` and the embind patch, neither of which means anything to pure
 * TypeScript logic under Node — and keeping them apart also pins vitest's file glob to
 * spec files under `src` only, so it can never accidentally pick up the Playwright suite
 * in `e2e/` (whose own `.spec.ts` names would otherwise match vitest's default include
 * and fail under a runner with no Playwright fixtures).
 *
 * The `@` alias mirrors the one in `vite.config.ts` — the two must stay in step, but a
 * shared import would make the app's build depend on vitest, which ships in dev only.
 */
export default defineConfig({
  plugins: [absoluteWasmUrl()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
