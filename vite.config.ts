import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Emscripten's embind runtime has two separate code paths that build JS functions from
 * runtime-constructed source strings via the `Function` constructor, both of which need
 * `'unsafe-eval'` in the CSP — this app's `tauri.conf.json` deliberately doesn't grant it
 * (`'wasm-unsafe-eval'` covers the WASM side, not this):
 *
 * 1. `createNamedFunction` — names generated Error subclasses (BindingError, InternalError,
 *    and whatever class wraps a genuine OpenCASCADE exception when a kernel operation
 *    fails) purely so the class has a readable `.name` in a stack trace.
 * 2. `craftInvokerFunction` — generates the uniquely-bodied JS invoker wrapper for every
 *    single bound C++ method/constructor across the OpenCASCADE API (thousands of call
 *    sites at kernel-init time, and on every sketch/feature interaction that touches the
 *    kernel afterwards) via `new_(Function, args1).apply(null, args2)`.
 *
 * Inside Tauri's stricter WebView both throw a CSP `SecurityError` the moment they first
 * run — which then surfaces as a much more confusing failure than the original error (a
 * broken rebuild, an unselectable sketch) with no useful message, since the very code path
 * meant to construct that behavior is what got blocked.
 *
 * Patched at build time rather than in `node_modules` (which `npm install` would wipe)
 * or by weakening the CSP (which would allow arbitrary `eval`/`Function` app-wide, not
 * just these two narrow uses). Both replacements produce equivalent functions using
 * ordinary closures instead of the `Function` constructor, so no eval-family API is
 * touched.
 */
function patchEmbindNamedFunction(): Plugin {
  const target = "replicad-opencascadejs/src/replicad_single.js";
  const oldCode =
    'function createNamedFunction(name,body){name=makeLegalFunctionName(name);return new Function("body","return function "+name+"() {\\n"+\'    "use strict";\'+"    return body.apply(this, arguments);\\n"+"};\\n")(body)}';
  const newCode =
    "function createNamedFunction(name,body){name=makeLegalFunctionName(name);var fn=function(){\"use strict\";return body.apply(this,arguments)};try{Object.defineProperty(fn,\"name\",{value:name})}catch(e){}return fn}";

  // Same semantics as the original: wires each argument via `toWireType`, calls
  // `cppInvokerFunc.apply(null, [cppTargetFunc].concat(invokeArgs))`, runs destructors
  // (either the batch destructor stack or the per-argument fallback, index-for-index
  // identical to the original's `arg"+(i-2)+"Wired"` / `thisWired` selection), and
  // converts the return value via `fromWireType` — just as a closure instead of a
  // string-built-and-evaluated function body.
  const oldCode2 =
    'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and \'this\' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var argsList="";var argsListWired="";for(var i=0;i<argCount-2;++i){argsList+=(i!==0?", ":"")+"arg"+i;argsListWired+=(i!==0?", ":"")+"arg"+i+"Wired"}var invokerFnBody="return function "+makeLegalFunctionName(humanName)+"("+argsList+") {\\n"+"if (arguments.length !== "+(argCount-2)+") {\\n"+"throwBindingError(\'function "+humanName+" called with \' + arguments.length + \' arguments, expected "+(argCount-2)+" args!\');\\n"+"}\\n";if(needsDestructorStack){invokerFnBody+="var destructors = [];\\n"}var dtorStack=needsDestructorStack?"destructors":"null";var args1=["throwBindingError","invoker","fn","runDestructors","retType","classParam"];var args2=[throwBindingError,cppInvokerFunc,cppTargetFunc,runDestructors,argTypes[0],argTypes[1]];if(isClassMethodFunc){invokerFnBody+="var thisWired = classParam.toWireType("+dtorStack+", this);\\n"}for(var i=0;i<argCount-2;++i){invokerFnBody+="var arg"+i+"Wired = argType"+i+".toWireType("+dtorStack+", arg"+i+"); // "+argTypes[i+2].name+"\\n";args1.push("argType"+i);args2.push(argTypes[i+2])}if(isClassMethodFunc){argsListWired="thisWired"+(argsListWired.length>0?", ":"")+argsListWired}invokerFnBody+=(returns?"var rv = ":"")+"invoker(fn"+(argsListWired.length>0?", ":"")+argsListWired+");\\n";if(needsDestructorStack){invokerFnBody+="runDestructors(destructors);\\n"}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){var paramName=i===1?"thisWired":"arg"+(i-2)+"Wired";if(argTypes[i].destructorFunction!==null){invokerFnBody+=paramName+"_dtor("+paramName+"); // "+argTypes[i].name+"\\n";args1.push(paramName+"_dtor");args2.push(argTypes[i].destructorFunction)}}}if(returns){invokerFnBody+="var ret = retType.fromWireType(rv);\\n"+"return ret;\\n"}else{}invokerFnBody+="}\\n";args1.push(invokerFnBody);var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction}';
  const newCode2 =
    'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and \'this\' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var expectedArgCount=argCount-2;return function(){if(arguments.length!==expectedArgCount){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expectedArgCount+" args!")}var destructors=needsDestructorStack?[]:null;var thisWired;if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this)}var argsWired=new Array(expectedArgCount);for(var i=0;i<expectedArgCount;++i){argsWired[i]=argTypes[i+2].toWireType(destructors,arguments[i])}var invokeArgs=isClassMethodFunc?[thisWired].concat(argsWired):argsWired;var rv=cppInvokerFunc.apply(null,[cppTargetFunc].concat(invokeArgs));if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){if(argTypes[i].destructorFunction!==null){var paramValue=i===1?thisWired:argsWired[i-2];argTypes[i].destructorFunction(paramValue)}}}if(returns){return argTypes[0].fromWireType(rv)}}}';

  return {
    name: "patch-embind-named-function",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes(target)) return null;
      // The exact minified text is expected to survive dependency bumps of this
      // Emscripten-generated file across versions that don't change these functions, but
      // if it ever doesn't, fail loudly at build time rather than silently shipping a CSP
      // violation again.
      if (!code.includes(oldCode)) {
        throw new Error(
          `${target}: expected createNamedFunction source not found — replicad-opencascadejs likely updated; update patchEmbindNamedFunction in vite.config.ts to match its new output.`,
        );
      }
      if (!code.includes(oldCode2)) {
        throw new Error(
          `${target}: expected craftInvokerFunction source not found — replicad-opencascadejs likely updated; update patchEmbindNamedFunction in vite.config.ts to match its new output.`,
        );
      }
      return code.replace(oldCode, newCode).replace(oldCode2, newCode2);
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
  //
  // Deliberately in the 14001–49151 gap rather than Tauri's scaffolded low ports. Windows'
  // TCP dynamic (ephemeral) port range is configurable, and a machine widened to
  // `start=1024 num=13977` hands ports from this low range out as *source* ports for ordinary
  // outbound connections — so a browser or background service can be holding one when the
  // dev server starts, and `strictPort` then fails the whole run for reasons that have
  // nothing to do with this app. These ports sit above any plausible ephemeral start and
  // below the Windows default range (49152+), so neither configuration can collide.
  server: {
    port: 24200,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 24201,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
