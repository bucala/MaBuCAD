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
| State | Zustand store holding the document's feature history |
| Viewport | Three.js 0.185 via react-three-fiber 9 and drei 10 |
| Geometric kernel | OpenCASCADE (WebAssembly) via replicad |

## Implementation status

The project is being built in gated steps; each one is verified before the next begins.

- [x] **Step 1 — Project initialisation and UI shell.** Tauri + React + Vite scaffolding, and the
      static application chrome: menu strip, ribbon command manager, feature manager tree,
      property manager, viewport surface and status bar, with Mica-aware Fluent styling.
- [x] **Step 2 — Viewport and camera system.** react-three-fiber canvas with SolidWorks
      navigation, switchable orthographic/perspective camera, the three default reference
      planes with hover and pick, the origin triad, a millimetre ground grid and a
      navigation cube.
- [x] **Step 3 — Document model and feature tree.** Zustand store holding the ordered
      feature history, rendered live in the tree with rename, suppress, delete, rollback
      and undo/redo. Ribbon feature commands create real features, and selection is shared
      between the tree, the property manager and the 3D viewport.
- [x] **Step 4 — 2D sketcher.** Sketch mode on any reference plane, line/rectangle/circle/
      spline/construction drawing with point snapping, geometric relations, smart and
      ordinate dimensioning, all driven by a numeric constraint solver that reports
      degrees of freedom.
- [x] **Step 5 — 3D geometry.** OpenCASCADE-backed extruded boss and cut, with blind,
      mid-plane and through-all end conditions driven from the property manager. Inner
      sketch loops become through holes. Rollback and suppression re-evaluate the model.
- [x] **Import / Export.** STEP (exact B-Rep, round-trips) and STL (binary, for
      manufacturing hand-off) export and import, backed by native save/open dialogs.
      IGES is not available — see [Geometric kernel](#geometric-kernel).

The five steps above were the original build plan; import/export is the first module built
past it, picked because the kernel and the file plugins were already in place for it.

The full command surface is laid out in `src/commands/ribbonConfig.ts`, and
`src/commands/commandRegistry.ts` maps the ids that are wired up to store actions. Commands
without an implementation render greyed out, so the ribbon reflects what actually works today.

## Document model

A document is an ordered list of features, and rebuilding means replaying that list from the
top — the structure SolidWorks, NX and Inventor all share. Consequences worth knowing:

- **Order matters.** A feature may only reference features above it.
- **The rollback bar** (`rollbackIndex`) marks how far the rebuild has run. Features below it
  stay in the document but are skipped, which is how you step back and insert a feature
  mid-history. It cannot move above the default reference geometry.
- **New features are inserted at the bar**, not appended, so adding a feature while rolled back
  puts it where you are working.
- **Deleting a feature deletes its dependents**, since a parametric child cannot rebuild
  without its parent.
- **Undo/redo** snapshots the document. Selection and unit changes are deliberately excluded —
  undoing a click is surprising.

Features are auto-named from `src/state/featureCatalog.ts` following SolidWorks conventions
(`Boss-Extrude1`, `Cut-Extrude1`, `Fillet1`). Numbering scans existing names rather than keeping
a counter, so deleting a feature frees its number again.

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
    viewport/                Graphics area: canvas, scene contents and CAD navigation
    statusbar/               Sketch status, cursor readout, unit system
  commands/commandRegistry.ts  Maps ribbon command ids to store actions
  commands/interchange.ts    Export/import commands, reported through a status toast
  kernel/occ.ts              Lazy OpenCASCADE WebAssembly boot
  kernel/profile.ts          Closed-loop extraction from a sketch
  kernel/rebuild.ts          Feature history -> solid -> triangulated mesh
  kernel/io.ts                STEP/STL export and import against the kernel
  kernel/importedShapes.ts   Kernel-owned bodies loaded from a file, keyed by feature id
  sketch/solver.ts           Damped Newton constraint solver and DOF counting
  sketch/residuals.ts        Constraint and dimension residual equations
  sketch/sketchModel.ts      Sketch construction, snapping and measuring
  sketch/planeBasis.ts       Sketch 2D <-> world transforms
  state/documentStore.ts     Zustand store: feature history, selection, undo/redo
  state/sketchStore.ts       Active sketch, tools, selection and solving
  state/geometryStore.ts     Rebuilt mesh, rebuild status, transient toast
  state/featureCatalog.ts    Per-kind naming, icons and default parameters
  io/files.ts                 Native save/open dialogs, with a browser download/picker fallback
  hooks/                     Tauri app info, theme resolution
  styles/                    Fluent design tokens and global styles
  types/document.ts          Feature and document model
  types/ui.ts                Shared UI types
src-tauri/
  src/lib.rs                 Tauri builder, plugin and command registration
  src/app_info.rs            get_app_info command
  src/fileio.rs               Scoped read/write commands for interchange
  tauri.conf.json            Window, Mica effect, CSP and bundle configuration
  capabilities/default.json  Permissions granted to the main window
```

## Geometric kernel

Solids are real B-Rep, built by OpenCASCADE compiled to WebAssembly and driven through
[replicad](https://replicad.xyz). The trimmed OCCT build is about 11 MB of wasm, loaded
lazily on the first feature that needs geometry rather than at startup.

`replicad` was chosen over raw `opencascade.js` because its build is a third of the size
for the operations this project needs, and B-Rep matters for the roadmap: fillet, shell,
booleans and STEP export are impossible on a triangle soup.

Extrusion works entirely in the sketch plane's local XY and extrudes along local +Z, then
the resulting mesh is rotated into place with the same quaternion the sketch is drawn with.
Mapping our plane names onto the kernel's own plane conventions would risk a mirrored axis
silently flipping a part.

- **Blind** extrudes one way from the plane; **Mid Plane** puts half the depth each side;
  **Through All** is a large symmetric extrude, since there are no other bodies to
  terminate against yet.
- The **largest closed region** of a sketch becomes the body and any smaller regions inside
  it become through holes, the convention every mainstream modeller uses.
- Rebuilds run only over features **above the rollback bar** and skip suppressed ones, so
  both genuinely re-evaluate the model rather than only changing the tree.
- Rebuilds are debounced and only the newest result may publish, so a slow earlier rebuild
  cannot overwrite a newer one while dragging a value.

## Import / Export

`Home → Interchange` exports the current model or imports a body into the document.

- **STEP** is written from the kernel's own boundary representation (`ADVANCED_BREP`
  entities, not a tessellation), so an exported file round-trips exactly — re-importing it
  reproduces the same bounding box and surfaces, verified in the interchange test suite.
- **STL** (binary) is a triangulation for manufacturing hand-off and 3D printing. It is
  lossy by construction: an STL import re-enters the document as a faceted body, which is
  a property of the format, not of the conversion.
- **IGES is not available.** The OpenCASCADE build this project bundles
  (`replicad-opencascadejs`) has zero IGES symbols compiled in — not a missing binding,
  the module itself isn't there. Supporting it means rebuilding the WebAssembly kernel
  with IGES enabled, which is a build-pipeline change, not application code. The ribbon
  button stays visibly present but disabled, with the reason in its tooltip, rather than
  being hidden or silently failing at the point of use.

An imported body has no history to replay — it enters the model as a base solid and fuses
with whatever the rest of the feature history produces. It is deliberately excluded from
undo/redo's document snapshots for the same reason sketches are: it is a
WebAssembly-backed kernel object, not serialisable state, and is instead tracked by feature
id in `kernel/importedShapes.ts` and released explicitly when its feature is deleted.

Interchange progress and outcomes surface as a status-bar toast, not the same field the
rebuild pipeline uses. A rebuild is triggered a moment after most interchange actions (a
new feature enters the document), so a shared field would let "Model up to date" overwrite
"Imported x.step" within a couple hundred milliseconds — the toast has its own lifetime and
survives that.

In a plain browser — `vite dev`, and this project's automated tests — export falls back to
a normal file download and import to a standard `<input type="file">` picker, so the whole
path is exercised without packaging the desktop app. Inside Tauri both go through a native
dialog and a pair of scoped Rust commands (`write_binary_file` / `read_binary_file`) rather
than the filesystem plugin's broader scope, following the dialog plugin's own guidance to
"write a dedicated command" when a save path needs to be arbitrary.

### A memory-corruption bug found and fixed in the vendored kernel

STEP export goes through `shape.blobSTEP()` rather than replicad's module-level
`exportSTEP()` function, and that choice is load-bearing, not stylistic.

`exportSTEP()` builds a throwaway XCAF assembly document internally and cleans up the
OpenCascade objects it creates (a work session, a CAF writer, a handle to the session)
through a `FinalizationRegistry` — cleanup that the JS engine runs at a time of its own
choosing, possibly long after the call returns. Two of those objects have an internal
C++ ownership relationship (the writer holds the session through a reference-counted
`Handle`), and when the browser's garbage collector eventually runs, both the writer's
own cleanup *and* the independently-registered session cleanup can fire and free the same
underlying object twice. The result is silent WASM heap corruption.

This was caught, not assumed: forcing V8's GC after a single `exportSTEP()` call
(`node --expose-gc`) reliably made the *next* kernel call throw
`RuntimeError: memory access out of bounds` — and the corruption wasn't scoped to STEP
export; it could take down unrelated subsequent kernel calls in the same session. A
Playwright run against the real dev server first surfaced this as a console error that
didn't fail any assertion, which was itself worth noticing rather than dismissing as
noise — an error with no visible symptom yet is still a bug, just one that hasn't been
triggered at the wrong moment.

`Shape.blobSTEP()` (a single-shape STEP writer using the plain, non-CAF
`STEPControl_Writer`) deletes every OpenCascade object it touches synchronously before
returning — the same pattern replicad's own `importSTEP`, `importSTL` and `blobSTL`
already use safely. Verified stable under the identical stress test that broke
`exportSTEP()`: 8 STEP exports with 16 forced GC cycles directly in a real browser tab,
zero errors, kernel fully functional afterward.

`replicad` is pinned at `0.23.1`, the latest release at the time of writing, so this isn't
a version to upgrade past — it's the current behaviour of the module-level export
function. `blobSTEP()` doesn't support multi-shape assemblies, names or colours the way
`exportSTEP()` does, none of which this project uses, since every export here is one
plain solid.

## Sketcher

Select a plane in the tree (or accept the Front plane default) and run **Sketch → Sketch**.
The camera squares up to the plane and the property manager becomes the sketch panel.

Geometry is a pool of points plus entities referencing them by id. Clicking within the snap
radius of an existing point **reuses** that point rather than adding a coincident duplicate,
which is what makes a drawn profile genuinely closed rather than merely looking closed.

Constraints and dimensions are both equations in one system, solved by damped Newton
iteration (`src/sketch/solver.ts`) with a finite-difference Jacobian:

- **Relations**: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
  point-on-line and fix.
- **Dimensions**: distance, horizontal/vertical distance, radius, diameter, angle, and
  **ordinate** measured from the sketch origin — a chain of ordinates shares one datum, so
  tolerance does not accumulate along it the way it does with chained dimensions.
- **Degrees of freedom** come from the rank of the Jacobian, so the status bar reports
  *Fully Defined* (DOF 0), *Under Defined*, or *Over Defined* (redundant or conflicting).
  An under-defined sketch is not an error; the damping term is what lets a rank-deficient
  system solve and keep its remaining freedom.

Dragging a point re-solves with that point pinned to the cursor rather than writing its
coordinate directly, so constrained neighbours follow and a fully defined sketch refuses to
move at all.

## Viewport navigation

Mouse bindings follow SolidWorks, so left-click stays free for entity selection:

| Gesture | Action |
| --- | --- |
| Middle drag | Orbit |
| Ctrl + middle drag | Pan |
| Shift + middle drag | Zoom |
| Wheel | Zoom towards the cursor |
| Left click | Select (a click that travels more than a few pixels is treated as a drag, not a pick) |

One scene unit is one millimetre. The coordinate system matches SolidWorks — Y-up, with the
Front plane on XY — which is also three.js's native convention, so no axis conversion happens
anywhere. The camera is orthographic by default because parallel projection is what makes equal
lengths measure equal on screen; the Ortho/Persp toggle sits at the top left of the graphics area.

The canvas uses `frameloop="demand"`, so frames are rendered only when something changes rather
than continuously.

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
