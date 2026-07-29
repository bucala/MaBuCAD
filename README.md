# MaBuCAD

A parametric 3D/2D CAD system for Windows 11 x64, in the spirit of SolidWorks, Siemens NX and
Inventor: history-based feature modelling, a constraint-driven 2D sketcher, assemblies with mates,
and drawings with ordinate dimensioning.

## Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 (Rust) — native window, file access, MSI/NSIS packaging |
| Frontend | React 19 + TypeScript, built with Vite 7 |
| Styling | CSS custom properties and CSS Modules, following Windows 11 Fluent 2 |
| Viewport | Three.js via react-three-fiber *(from Step 2)* |
| Geometric kernel | OpenCASCADE compiled to WebAssembly *(from Step 5)* |

## Implementation status

The project is being built in gated steps; each one is verified before the next begins.

- [x] **Step 1 — Project initialisation and UI shell.** Tauri + React + Vite scaffolding, and the
      static application chrome: menu strip, ribbon command manager, feature manager tree,
      property manager, viewport surface and status bar, with Mica-aware Fluent styling.
- [ ] **Step 2 — Viewport and camera system.** react-three-fiber canvas, orbit/pan/zoom
      navigation, default planes and origin, navigation cube.
- [ ] **Step 3 — Document model and feature tree.** State store for the operation history,
      rendered live in the tree with rename and rollback.
- [ ] **Step 4 — 2D sketcher.** Orthogonal sketch mode, entity drawing, geometric constraints,
      smart and ordinate dimensioning.
- [ ] **Step 5 — 3D geometry.** OpenCASCADE-backed extrude with blind and mid-plane end
      conditions, driven from the property manager.

Ribbon commands for later steps are already laid out in `src/commands/ribbonConfig.ts` so the
command surface is visible; invoking one currently logs its id and does nothing else.

## Prerequisites (Windows 11 x64)

1. **Visual Studio 2022 Build Tools** with the *Desktop development with C++* workload —
   supplies the MSVC linker Rust needs.
2. **Rust** via [rustup](https://rustup.rs), toolchain `stable-x86_64-pc-windows-msvc`.
3. **Node.js 20 or newer.**
4. **WebView2 runtime** — already present on Windows 11; no action needed.

Full details: <https://v2.tauri.app/start/prerequisites/>.

## Running

```powershell
npm install
npm run tauri dev      # desktop app with hot reload
```

Other useful scripts:

```powershell
npm run dev            # frontend only, in a browser at http://localhost:1420
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + production frontend build
npm run tauri build    # MSI and NSIS installers in src-tauri/target/release/bundle/
```

## Project layout

```
src/
  commands/ribbonConfig.ts   Declarative ribbon: tabs, groups and commands
  components/
    layout/                  AppShell — the four-row application grid
    menubar/                 Menu strip and quick access toolbar
    ribbon/                  Command manager rendered from ribbonConfig
    manager/                 Left dock hosting the three manager tabs
    tree/                    Feature manager design tree
    property/                Context-sensitive property manager
    viewport/                Graphics area (3D canvas mounts here in Step 2)
    statusbar/               Sketch status, cursor readout, unit system
  hooks/useAppInfo.ts        Reads build identity over Tauri IPC
  styles/                    Fluent design tokens and global styles
  types/ui.ts                Shared UI types
src-tauri/
  src/lib.rs                 Tauri builder, plugin and command registration
  src/app_info.rs            get_app_info command
  tauri.conf.json            Window, Mica effect, CSP and bundle configuration
  capabilities/default.json  Permissions granted to the main window
```

## Notes on the Windows 11 integration

- The window keeps its **native caption bar** (`decorations: true`) so Snap Layouts, rounded
  corners and per-monitor DPI handling come from the OS rather than being reimplemented.
- **Mica** is enabled through `windowEffects.effects: ["mica"]` together with
  `transparent: true`. The page background is therefore transparent inside Tauri and opaque in a
  plain browser; `src/main.tsx` sets `data-tauri` on the document to switch between the two.
- The **content security policy** already allows `wasm-unsafe-eval` and `blob:` workers so the
  OpenCASCADE WebAssembly kernel can load in Step 5 without configuration changes.
- Light and dark themes both ship, following the system preference; `data-theme` on the root
  element overrides it.
