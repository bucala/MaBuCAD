import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Emscripten's embind runtime names its generated Error subclasses (BindingError,
 * InternalError, and — the one that actually bites here — whatever class it wraps a
 * genuine OpenCASCADE exception in when a kernel operation fails) via `new Function(...)`,
 * purely so the class has a readable `.name` in a stack trace. That one call needs
 * `'unsafe-eval'` in the CSP; this app's `tauri.conf.json` deliberately doesn't grant it
 * (`'wasm-unsafe-eval'` covers the WASM side, not this). Inside Tauri's stricter WebView
 * this throws a CSP `SecurityError` the moment OpenCASCADE first needs to report *any*
 * internal exception — which then surfaces as a much more confusing failure than the
 * original error (a broken rebuild, an unselectable sketch) with no useful message, since
 * the very code path meant to construct that message is what got blocked.
 *
 * Patched at build time rather than in `node_modules` (which `npm install` would wipe)
 * or by weakening the CSP (which would allow arbitrary `eval`/`Function` app-wide, not
 * just this one narrow, debug-only use). The replacement produces an equivalent function
 * — calling it still runs `body.apply(this, arguments)` — using `Object.defineProperty`
 * to set `.name` instead of the `Function` constructor, so no eval-family API is touched.
 */
function patchEmbindNamedFunction(): Plugin {
  const target = "replicad-opencascadejs/src/replicad_single.js";
  const oldCode =
    'function createNamedFunction(name,body){name=makeLegalFunctionName(name);return new Function("body","return function "+name+"() {\\n"+\'    "use strict";\'+"    return body.apply(this, arguments);\\n"+"};\\n")(body)}';
  const newCode =
    "function createNamedFunction(name,body){name=makeLegalFunctionName(name);var fn=function(){\"use strict\";return body.apply(this,arguments)};try{Object.defineProperty(fn,\"name\",{value:name})}catch(e){}return fn}";

  return {
    name: "patch-embind-named-function",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes(target)) return null;
      if (!code.includes(oldCode)) {
        // The exact minified text is expected to survive dependency bumps of this
        // Emscripten-generated file across versions that don't change this function, but
        // if it ever doesn't, fail loudly at build time rather than silently shipping the
        // CSP violation again.
        throw new Error(
          `${target}: expected createNamedFunction source not found — replicad-opencascadejs likely updated; update patchEmbindNamedFunction in vite.config.ts to match its new output.`,
        );
      }
      return code.replace(oldCode, newCode);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), patchEmbindNamedFunction()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Surface TAURI_* variables to the frontend alongside the usual VITE_* ones.
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // The three.js chunk is inherently past the default 500 kB warning threshold, and it
    // loads from local disk in the packaged app rather than over a network.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // three.js dwarfs everything else and changes far less often than app code,
        // so it gets its own chunk rather than being rebuilt into one large bundle.
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
