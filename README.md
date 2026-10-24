<div align="center">

<img src="public/mabucad-icon.png" alt="MaBuCAD logo" width="120" height="120" />

# MaBuCAD

### Parametric 3D/2D CAD for the Windows desktop

History-based feature modelling, a constraint-driven 2D sketcher, and a real OpenCASCADE
B-Rep kernel — in the spirit of the mainstream CAD tools, running native on Windows 11 via
Tauri.

<br />

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?style=for-the-badge&logo=rust&logoColor=white)](https://rustup.rs)
[![OpenCASCADE](https://img.shields.io/badge/OpenCASCADE-WASM-CC6600?style=for-the-badge)](https://replicad.xyz)

![Platform](https://img.shields.io/badge/platform-Windows%2011%20x64-0078D6?logo=windows&logoColor=white)
![License](https://img.shields.io/github/license/bucala/MaBuCAD)
![Last commit](https://img.shields.io/github/last-commit/bucala/MaBuCAD)
![Repo stars](https://img.shields.io/github/stars/bucala/MaBuCAD?style=social)

<br />

[**Features**](#-features) &nbsp;•&nbsp;
[**Screenshot**](#-screenshot) &nbsp;•&nbsp;
[**Architecture**](#-architecture) &nbsp;•&nbsp;
[**Getting started**](#-getting-started) &nbsp;•&nbsp;
[**Formats**](#-supported-formats) &nbsp;•&nbsp;
[**Roadmap**](#-roadmap)

</div>

---

## ✨ Features

<table>
  <tr>
    <td width="33%" valign="top">

### 🧩 Parametric feature tree

Every feature (sketch, extrude, fillet, pattern…) is a step in an ordered, replayable
history — rollback, suppress, rename, reorder by dragging the rollback bar, undo/redo, all
live in the Feature Manager tree. Undo is gesture-aware: dragging a view, a note or a
dimension label costs exactly one undo step, not one per pointer frame. Ordinary selection
keeps your chosen manager tab; an explicit command opens Properties and returns to the
previous tab when finished.

  </td>
  <td width="33%" valign="top">

### ✏️ Constraint-based sketcher

Line/rectangle/circle/arc/spline/construction/point, trim, fillet, offset, mirror,
linear/circular pattern, 10 geometric relations and smart/ordinate dimensioning, solved by a
damped-Newton solver that reports live degrees of freedom. Smart Dimension follows an
Inventor-style propose-then-commit flow, and dragging a point suggests
coincident/tangent/midpoint relations live ("constrains smart") — both shown as a preview
until you commit to them. Relations work select-then-apply or apply-then-select, either
order; a length dimension can be switched between Horizontal/Vertical/Aligned from its
right-click menu without re-adding it; and selected geometry gets a real halo highlight, not
just a colour swap. Length dimensions have two endpoint arrows, extension lines and a
connecting leader when their text moves beyond the measured span. Angle dimensions have a
real arc and arrows, with a connecting leader outside the measured sector.

  </td>
  <td width="33%" valign="top">

### 🧱 Real B-Rep kernel

Solids are genuine OpenCASCADE boundary representation, compiled to WebAssembly and driven
through [replicad](https://replicad.xyz) — not a triangle soup, which is what makes fillet,
shell and exact STEP export possible at all. Rebuilds resume from a content-addressed
prefix cache: editing a late feature replays only the tail of the history, and a no-change
rebuild costs little more than re-meshing the result.

  </td>
  </tr>
  <tr>
    <td width="33%" valign="top">

### 🛠️ A full PartDesign set

Extrude/Cut, Revolve/Cut, Sweep/Cut (straight or spline path), Loft, a Hole Wizard driven by
real Autodesk clearance/tap-drill tables — Simple, Clearance, Tapped or Taper Tapped (NPT),
with a real Counterbore/Spotface/Countersink seat and an actual conical drill point on a
blind hole — Fillet, Chamfer, Shell, Draft, Rib, Linear/Circular Pattern, Mirror and
reference geometry.

  </td>
  <td width="33%" valign="top">

### 🎯 Edge-selective dress-up

Fillet and Chamfer default to every edge, or pick specific ones in the viewport — the picked
edge highlights as its own contour, not a marker dropped where you clicked — and picks are
re-resolved geometrically on every rebuild, an honest stand-in for persistent edge naming in
a kernel with none.

  </td>
  <td width="33%" valign="top">

### 🔄 STEP / STL interchange

STEP exports the kernel's own B-Rep (round-trips exactly); STL is a binary triangulation for
manufacturing hand-off. Both import back into the document as real features.

  </td>
  </tr>
  <tr>
    <td width="33%" valign="top">

### 🎨 Three skins, five accents

Light, Gray or Dark, each re-tinted live by any of five accent colours (or the original
Fluent blue) via `color-mix()`, plus Model Colour / Model Edge Colour overrides — all
gathered into their own Settings ▸ Colours tab.

  </td>
  <td width="33%" valign="top">

### 🪟 Windows 11 native

Tauri 2 shell with the real caption bar, Snap Layouts, per-monitor DPI and a translucent
Mica backdrop — Fluent 2 design tokens throughout, not an imitation.

  </td>
  <td width="33%" valign="top">

### 🧪 A real regression suite

A committed Playwright suite drives the actual app end to end — the sketcher and the
constraint solver's live DOF readout, an extrude through the WASM kernel, undo/redo, a
document Save As/Open round-trip, the language switcher — plus a 250-test unit suite that
runs the real WASM kernel under Node (the rebuild cache is proven byte-identical cached
vs. from-scratch) and pins the sketch renderer's drag memoisation at a 240-entity scale,
typecheck and a CI workflow that runs all of it on every push, not just typecheck and hope.

  </td>
  </tr>
  <tr>
    <td width="33%" valign="top">

### 🌍 9 languages

A language switcher for English, Slovak, Czech, German, French, Italian, Spanish, Russian
and Chinese. English and Slovak are fully translated today — including every ribbon hover
tooltip and the three manager dock panels (Sketch, Inspect, Properties); the rest fall
back to English string-by-string until translated. A unit test pins the Slovak
dictionary's coverage of the ribbon and feature catalog, so a new command can't ship
with a silent gap.

  </td>
  <td width="33%" valign="top">

### 🧭 Real 3D Navigation controls

Zoom-to-cursor, ViewCube visibility, origin indicator and XYZ axis labels — all genuinely
wired to the viewport, not decorative checkboxes.

  </td>
  <td width="33%" valign="top">

### 💾 Autosave & recovery

An opt-in `localStorage` recovery snapshot every 60s while there are unsaved changes, with
File ▸ Restore Autosave to bring it back — no native save dialog interrupting you.

  </td>
  </tr>
  <tr>
    <td width="33%" valign="top">

### ⌨️ Rebindable keyboard shortcuts

Esc/Del/Space and Undo/Redo work as bare-key shortcuts out of the box, with a Settings ▸
Shortcuts tab to rebind any of them by pressing a key.

  </td>
  <td width="33%" valign="top">

### 🖼️ Custom viewport backgrounds

Settings ▸ Colours ▸ Viewport Background: solid colour, a gradient from centre or bottom
with an intensity slider, or an uploaded image with its own opacity slider — on top of the
existing theme-matched default.

  </td>
  <td width="33%" valign="top">

### 🪲 Debug Mode

An opt-in diagnostic log (Settings ▸ General) that captures uncaught errors, unhandled
rejections, console warnings and rebuild failures to a plain-text file next to the
installed executable — attach it when reporting a problem.

  </td>
  </tr>
</table>

---

## 📸 Screenshot

<div align="center">

<img src="assets/screenshots/app-ui.png" alt="MaBuCAD application UI" width="90%" />

<sub>A mounting plate built from four features — a sketched profile, an extrude, a
Hole Wizard bolt pattern and a fillet — shown in the Feature Manager tree.</sub>

</div>

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────────────┐
│ Tauri (Rust)      native window, Mica backdrop, scoped     │
│                   read/write file commands for interchange │
├───────────────────────────────────────────────────────────┤
│ React UI          ribbon, feature tree, property manager,  │
│   └── Zustand     sketch panel, status bar — one store per │
│                   concern (document, sketch, geometry,     │
│                   viewport, settings)                      │
├───────────────────────────────────────────────────────────┤
│ Viewport          react-three-fiber, frameloop="demand",   │
│                   CAD navigation (orbit/pan/zoom), a       │
│                   viewcube, B-Rep edge overlay drawn        │
│                   separately from the shaded triangulation │
├───────────────────────────────────────────────────────────┤
│ Sketch solver     damped Newton over constraint/dimension  │
│                   residuals; sparse finite-difference      │
│                   Jacobian; DOF from its rank               │
├───────────────────────────────────────────────────────────┤
│ Geometric kernel  OpenCASCADE compiled to WASM (replicad), │
│                   lazy-loaded on first feature; the whole  │
│                   document rebuilds from feature history   │
│                   on every change, not incrementally       │
└───────────────────────────────────────────────────────────┘
```

<details>
<summary><b>🔍 Key engineering decisions</b></summary>

<br />

- **The whole document rebuilds from feature history on every change** — `kernel/rebuild.ts`
  replays every feature above the rollback bar into one solid, rather than patching an
  existing one. Simpler to reason about than incremental topological-naming updates. The
  replay is checkpointed through `kernel/rebuildCache.ts`: each clean prefix of the
  history is cached under a content hash of everything it reads (features, their
  sketches), so a rebuild resumes from the longest still-matching prefix and replays only
  the tail — an edit of a late feature no longer pays for the whole chain, and a
  no-change rebuild costs little more than re-meshing. Checkpoints are never stored for
  an errored prefix or across an imported body (whose solid the import registry owns and
  may release), and kernel-shape release is centralised in an identity-based eviction
  plan that understands the aliasing dress-ups create.
- **A Part is a single fused body, by design** — the same rule FreeCAD's PartDesign Body
  documents ("each Body is one contiguous solid"), rather than SolidWorks' / Inventor's /
  Onshape's multi-body parts, where a single part can hold several solids that become
  boolean operands or separate BOM entries. Deliberate: because the kernel rebuilds one
  solid from feature history, a single-body rule keeps every extrusion/revolve and boolean
  deterministic — there is never a body to choose between — and every feature's picks stay
  geometric proxies. Multi-body modelling (bodies as boolean operand *sets*, per-body
  display and BOM) is a consciously deferred capability, not an oversight.
- **Sketches build in their own plane's local, un-rotated space**; only the final
  triangulated mesh gets a cosmetic display rotation for on-screen placement. The
  alternative — mapping this app's plane conventions onto the kernel's own — risks a
  mirrored axis silently flipping a part, so every sketch-based feature (extrude, revolve,
  fillet's edge picks, …) works in that same local space and only rotates for display.
- **Fillet and Chamfer can target specific edges with no persistent edge naming to lean
  on** — this kernel has none, since it rebuilds from scratch every time. A picked click is
  stored as a world-space point, converted into the kernel's own un-rotated solid space, and
  re-resolved on every rebuild via replicad's `EdgeFinder.withinDistance()`. Documented
  honestly as a geometric-proxy approximation, not true persistent naming: it can
  occasionally latch onto the wrong edge if the body changes drastically between picks.
  Picking against an already-rounded result would mean clicking edges that already moved, so
  entering pick mode previews the body as it was *before* the Fillet/Chamfer being edited.
- **A memory-corruption bug found and fixed in the vendored kernel**: STEP export goes
  through replicad's `shape.blobSTEP()` rather than its module-level `exportSTEP()`, and
  that choice is load-bearing. `exportSTEP()` builds a throwaway XCAF document and cleans up
  two internally-linked OpenCascade objects through independent `FinalizationRegistry`
  callbacks the JS engine runs at a time of its own choosing — when both eventually fire,
  they can free the same underlying object twice, corrupting the WASM heap silently. Caught
  by forcing V8's GC after a single export and watching the *next*, unrelated kernel call
  throw. `blobSTEP()` deletes everything it touches synchronously before returning, the same
  pattern replicad's own import functions already use safely — verified stable under the
  identical stress test that broke `exportSTEP()`.
- **`raycast={undefined}` is not "leave it alone"**: react-three-fiber still assigns
  `instance.raycast = undefined` as an own property on the underlying `three.js` object,
  which shadows `LineSegments.prototype.raycast` — the real hit-testing implementation — on
  the prototype chain, silently breaking every click against it with no console error. Found
  while wiring up edge picking (the edge overlay used this pattern to opt out of raycasting
  when not needed); fixed by passing the real prototype method instead of `undefined`.
- **A `frameloop="demand"` canvas can miss the very first click after a tool switch**: r3f's
  pointer raycasting reads matrices from the last *rendered* frame, and nothing was asking
  for a fresh one at the moment a tool changed — if a click's pointerdown/up landed before
  the browser's next paint, it could raycast against stale state and hit nothing. This
  root-caused what had looked all session like sporadic sketch-tool test flakiness; the fix
  (an explicit `invalidate()` on tool change) narrows the window without fully closing it —
  a real user's natural reaction time practically never triggers it, but a scripted client
  clicking with zero gap still can, rarely.
- **The accent colour is one CSS custom property, not a colour per component**: `tokens.css`
  derives every hover/active/subtle/selection/text shade from a single `--accent-hex` via
  `color-mix()`, so a Settings swatch re-tints the whole app in one write. Scene colours
  (sketch previews, selection highlights) can't read a CSS variable — `three.js` materials
  need an actual value — so `useSceneAccentColor()` mirrors the same derivation in
  JavaScript for the viewport.
- **A point drag re-tessellates one entity, not the whole sketch**: the sketch store
  rewrites the sketch immutably on every pointer-move, so a naive `useMemo([entity,
  sketch])` re-tessellates every circle/arc/spline on each drag frame. Each entity instead
  gets a cheap version key (`sketchRender.ts`'s `entityPointVersion`) built from the
  coordinates of only the points it references (plus radius, for circles/arcs), resolved
  through one shared Map-backed point lookup per render rather than a linear pool scan;
  the memoised `EntityView` compares that key, so the expensive tessellation reruns only for
  the entity whose own points actually moved — measured at ~5x less per-frame geometry
  work on a 240-entity sketch (reader construction included), with a unit suite pinning
  the key's stability contract.
- **Fluent-only where it doesn't cost correctness**: the window keeps its native Windows
  caption bar (`decorations: true`) rather than a custom-drawn one, so Snap Layouts, rounded
  corners and per-monitor DPI come from the OS. Mica needs `transparent: true`, so the page
  background is transparent inside Tauri and opaque in a plain browser, switched by a
  `data-tauri` attribute `main.tsx` sets once at startup.

</details>

<details>
<summary><b>🧰 Tech stack</b></summary>

<br />

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 (Rust) — native window, file access, MSI/NSIS packaging |
| Frontend | React 19 + TypeScript, built with Vite 7 |
| Styling | CSS custom properties and CSS Modules, following Windows 11 Fluent 2 |
| State | Zustand — one store per concern (document, sketch, geometry, viewport, settings) |
| Viewport | Three.js 0.185 via react-three-fiber 9 and drei 10 |
| Geometric kernel | OpenCASCADE (WebAssembly) via replicad |

</details>

---

## 🚀 Getting started

> [!IMPORTANT]
> **Prerequisites (Windows 11 x64):** [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/downloads/)
> with the *Desktop development with C++* workload, [Rust](https://rustup.rs)
> (`stable-x86_64-pc-windows-msvc`), and **Node.js 20+**. The WebView2 runtime ships with
> Windows 11 already. Full details: <https://v2.tauri.app/start/prerequisites/>.

```powershell
npm install
npm run tauri dev      # desktop app with hot reload

# …or run the browser-only dev server (native dialogs replaced by browser fallbacks)
npm run dev             # http://localhost:24200
```

<details>
<summary><b>✅ Quality gates</b></summary>

<br />

```powershell
npm run lint             # ESLint over all source (hook discipline, unused code)
npm run typecheck      # tsc --noEmit
npm run test             # Vitest unit suite: solver, residuals, Jacobian, equations, undo
                         # history, point drag, render memoisation, translations, document
                         # validation, rebuild cache (boots the real WASM kernel)
npm run build           # typecheck + production frontend build
npm run test:e2e       # Playwright regression suite against the dev server
npm run tauri build    # MSI and NSIS installers in src-tauri/target/release/bundle/
```

`scripts\build-msi.ps1` wraps install + typecheck + `tauri build` into one command:

```powershell
.\scripts\build-msi.ps1                          # full build
.\scripts\build-msi.ps1 -SkipChecks -SkipInstall  # fastest rebuild once deps/types are known-good
.\scripts\build-msi.ps1 -Target msi -Open         # just the MSI, then open the output folder
```

The same build also runs on GitHub Actions (`.github/workflows/installer.yml`), so an
installer can be produced without a local Rust toolchain: Actions ▸ **Installer** ▸
*Run workflow* builds both installers for whatever version the repo carries and uploads
them as workflow artifacts, and pushing a `v*` tag (e.g. `v0.19.0`) builds and attaches
them to a GitHub Release for that tag — the publishing path, since the CI workflow only
gates branch pushes.

</details>

<details>
<summary><b>🧪 Regression testing</b></summary>

<br />

A committed Playwright suite (`e2e/`) drives the real dev server end to end — the
application shell, sketch drawing with the constraint solver's live DOF readout, an
extrude that boots the WASM kernel, undo/redo, a document Save As/Open round-trip that
asserts the on-disk format, and the language switcher — rather than relying on typecheck
and build alone to say a feature actually works. GitHub Actions (`.github/workflows/ci.yml`)
runs the suite plus typecheck, the production build, `cargo check` and clippy on every
push and pull request. See [`CHANGELOG.md`](./CHANGELOG.md) for the dated history of what
was verified along the way, including the bugs past rounds of testing caught (a WASM
heap-corruption bug in the vendored kernel, a rare pointer-event race in the sketch tool,
and a UI panel that silently never surfaced a new Fillet/Chamfer's own edge-selection and
radius controls).

</details>

---

## 📂 Project layout

```
src/
  commands/ribbonConfig.ts   Declarative ribbon: tabs, groups and commands
  commands/commandRegistry.ts  Maps ribbon command ids to store actions
  commands/interchange.ts    Export/import commands, reported through a status toast
  components/
    layout/                  AppShell — the four-row application grid
    menubar/                 Menu strip and quick access toolbar
    ribbon/                  Command manager rendered from ribbonConfig
    manager/                 Left dock hosting Feature/Property/Configuration tabs
    tree/                    Feature manager design tree
    property/                Context-sensitive property manager and sketch panel
    settings/                Application Options dialog (theme, accent, units, tolerances)
    viewport/                Graphics area: canvas, scene contents and CAD navigation
    statusbar/               Sketch status, cursor readout, unit system
  kernel/occ.ts               Lazy OpenCASCADE WebAssembly boot
  kernel/profile.ts           Closed-loop extraction from a sketch
  kernel/rebuild.ts           Feature history -> solid -> triangulated mesh
  kernel/rebuildCache.ts      Content-addressed prefix cache for the replay
  kernel/io.ts                 STEP/STL export and import against the kernel
  sketch/solver.ts             Damped Newton solver; per-constraint sparse Jacobian
  sketch/residuals.ts          Constraint/dimension residual blocks + variable deps
  sketch/sketchModel.ts        Sketch construction, snapping and measuring
  sketch/planeBasis.ts         Sketch 2D <-> world transforms
  state/documentStore.ts       Feature history, selection, undo/redo
  state/sketchStore.ts         Active sketch, tools, selection and solving
  state/geometryStore.ts       Rebuilt mesh, rebuild status, transient toast
  state/settingsStore.ts       Theme, accent colour, tolerances — persisted to localStorage
  state/featureCatalog.ts      Per-kind naming, icons and default parameters
  hooks/                       Tauri app info, theme + accent colour resolution
  styles/tokens.css            Fluent design tokens, theme skins, accent derivation
  types/document.ts            Feature and document model
src-tauri/
  src/lib.rs                   Tauri builder, plugin and command registration
  src/fileio.rs                 Scoped read/write commands for interchange
  tauri.conf.json               Window, Mica effect, CSP and bundle configuration
scripts/build-msi.ps1          Wraps install + typecheck + `tauri build` into one command
e2e/                           Playwright regression suite driving the real dev server
playwright.config.ts           Test config: boots the Vite dev server as the test target
vitest.config.ts              Unit-test config: pure TypeScript logic under Node, no browser
eslint.config.js              ESLint flat config: hook discipline + unused code, no style rules
.github/workflows/ci.yml       CI: typecheck, build, e2e, cargo check + clippy
```

---

## 💾 Supported formats

| Format | Import | Export | Notes |
| :---: | :---: | :---: | --- |
| **STEP** | ✅ | ✅ | Exact B-Rep (`ADVANCED_BREP`), round-trips exactly |
| **STL** | ✅ binary | ✅ binary | Triangulated mesh, for manufacturing hand-off / 3D printing |
| **IGES** | — | — | The bundled OpenCASCADE build has no IGES support compiled in; the ribbon button stays visibly present but disabled, with the reason in its tooltip |
| **`.mabucad`** (document) | ✅ | ✅ | The full parametric feature history, sketches included; files carry a format version and are migrated forward on open |
| **`.mabucad-settings`** | ✅ | ✅ | App-wide preferences (theme, accent, tolerances) — for backup or a second machine |

---

## 🗺️ Roadmap

| Area | Scope | Status |
| --- | --- | :---: |
| Project shell | Tauri + React + Vite scaffolding, Fluent 2 UI chrome | ✅ |
| Viewport | CAD navigation, reference planes, origin, viewcube (full-cycle up/down/left/right rotation), axis-cross legend | ✅ |
| Document model | Feature tree, rollback, suppress, undo/redo, rename, drag-reorder | ✅ |
| Sketcher | Full entity set, 10 relations (Fix extends to lines/circles/arcs, pins radius too), dimensioning (incl. point-to-line, auto-detected parallel-distance; driving vs driven/reference dimensions — parenthesised, value follows the geometry live, auto-driven when a commit would over-define), conflicting-constraint highlighting + a Sketch Doctor panel section listing the singly-responsible offenders with one-click delete and the still-free entities with click-to-select, blue = under-defined / black = fully-defined entity colouring (from the solver's own freedom analysis, so it always agrees with the DOF readout), damped-Newton solver | ✅ |
| Core solids | Extrude/Cut-Extrude, Revolve/Cut-Revolve, both building one fused body per disjoint sketch contour with a per-contour profile picker, not just one region | ✅ |
| Import/Export | STEP (exact B-Rep) and STL, native + browser-fallback dialogs | ✅ |
| Sketch tools | Trim (lines, circles, splines, drag-to-window multi-select), Fillet, Offset, Mirror, Linear/Circular Pattern, Convert to Construction | ✅ |
| Reference geometry | Plane, Axis, Point, Coordinate System, with a 3D presence | ✅ |
| Hole Wizard | Simple/Clearance/Tapped/Taper Tapped, real ISO clearance and tap-drill data, Counterbore/Spotface/Countersink seats, conical drill point, Inventor-style cosmetic thread texture on tapped holes (a real diagonal-line wrap at the hole's actual pitch/diameter/winding, not a plain indicator) | ✅ |
| Dress-up | Fillet, Chamfer, Shell, Draft, Rib — Fillet/Chamfer start pass-through and arm edge-pick mode immediately, applying to every edge only if none are ever picked | ✅ |
| Advanced solids | Sweep/Cut-Sweep (straight and spline paths), Loft | ✅ |
| Pattern/Mirror (feature-level) | Linear Pattern, Circular Pattern, Mirror | ✅ |
| Theming | Light/Gray/Dark skins, 5 live accent colours, Model/Edge colour overrides | ✅ |
| 3D Navigation | Zoom-to-cursor, ViewCube toggle + navigation arrows (full-cycle rotation, correct left/right direction), origin indicator + axis labels | ✅ |
| Selection filter | Body/Face/Edge priority — left-click cycles, right-click opens a direct-pick dropdown | ✅ |
| Autosave | Opt-in periodic recovery snapshot, restorable from the File menu | ✅ |
| New Document picker | Visual Part/Assembly/Drawing chooser (Part and Drawing wired, Assembly "coming soon") | ✅ |
| Localisation | 9-language switcher; English and Slovak fully translated | 🟡 |
| Boundary surface | Guide-curve boundary blending | ⬜ |
| Multi-document workspace | Tabbed Part/Drawing documents, each with its own history, undo and sketches | ✅ |
| Assembly | Components, mates, exploded views | ⬜ |
| Drawing | ISO E/ISO A projection method (per-document, symbol in the title block, click to toggle); Insert Model View opens an orientation picker (Front/Top/Bottom/Left/Right/Back/Isometric — pick one, it becomes the sheet's main view) rather than placing a fixed default set; Projected View overlays real directional arrows (plus an Isometric corner button) around a clicked standard view, each arrow computed from the actual ISO-E/ISO-A step relationships so only genuinely reachable further views are offered; placed views re-lay out on demand, with an amber out-of-date marker on the Update Views button whenever the source part file changed on disk since the last projection — cleared by the update itself, which also recognises a byte-identical part file and skips the multi-second rebuild instead of reproducing the cache it already has. Also: Section (real kernel cut, ISO 128-3 hatched, cutting-plane line + arrows + A-A callout left on the source view), Detail (2D crop, ISO 128 torn boundary, leadered letter left on the source view), Auxiliary (bounded 30° tilted kernel projection), Broken (masked band with break marks) and Crop (rectangular same-scale crop) views, ISO 6410 thread circles on tapped holes, draggable views/notes, active-view annotation binding (double-click a view to activate it — new/re-anchored annotations bind to it and move with it, inside a highlight frame offset clear of the view's own geometry), sheet zoom-to-cursor + middle-mouse pan, Edit Background shortcut, ISO 5457 zone-label sizing, Sheet Formats/Borders/Title Blocks (A4–A0, import/export as templates); Smart Dimension (5 tolerance modes: symmetric/deviation/limits/basic/fit), Ordinate, Datum Feature, Geometric Tolerance (14 characteristics, ⌀ prefix, MMC/LMC modifiers, per-datum modifiers, draggable leader anchor), Surface Finish (ISO 21920-1: machining required/prohibited, all-around, lay direction, allowance, draggable leader anchor), Weld (ISO 2553: 13 joint types, arrow/other side, all-around, field weld, draggable leader anchor), Hole Callout (picked straight from a projected Hole Wizard circle — designation/class with LH-only direction, drilled depth vs. THRU (adopted ASME wording — ISO 15786 itself signals a through hole by omitting the depth), ISO 15786 ⌴/⌵ counterbore/spotface/countersink seat lines, Slovak-localised wording) annotations — every leader/GD&T anchor snaps to a view's own corner vertices, any point along a straight edge, or a circular edge's own fitted centre (a hole's axis); Hole Table and BOM tables. A fast/precise (coarse) hidden-line toggle was investigated and dropped: the shipped WASM kernel binds only OCCT's exact `HLRBRep_Algo`, never the tessellated `HLRBRep_PolyAlgo` that FreeCAD TechDraw's Coarse View uses, and the one knob replicad does expose measures 60 ms against 59 ms per view — a toggle trading fidelity for nothing, in a command where the part rebuild (~70%, 2.4 s on a 64-hole plate) is the real cost | ✅ |
| Inspect | Measure, Mass Properties, Section Properties, Check Geometry, Draft Analysis, Parent/Child, Equations, Sensors, Appearance; Curvature dropped (no kernel support) | ✅ |

Standard, Section and Auxiliary drawing views keep their creation-direction alignment
while dragging, with **Unlink Position / Re-link Position** for independent placement.
Bound annotations follow both dragging and projection relayouts. Smart Dimension and
Ordinate pick real vertices within one view at any sheet zoom or pan, ignoring geometry
hidden by Detail/Crop clips or a Broken mask. Escape exits the active drawing tool.

<sub>✅ done &nbsp;•&nbsp; 🟡 partial &nbsp;•&nbsp; ⬜ planned — see
[`CHANGELOG.md`](./CHANGELOG.md) for the full dated history, including bugs found and fixed
along the way.</sub>

---

<div align="center">

<img src="public/mabucad-icon.png" alt="MaBuCAD" width="48" height="48" />

**MaBuCAD** — built with Tauri, React, TypeScript, Three.js and OpenCASCADE.

<sub>Made for Windows 11 • Fluent 2 design • Real B-Rep, not a triangle soup</sub>

</div>
