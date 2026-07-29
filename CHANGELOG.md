# Changelog

All notable changes to MaBuCAD are documented in this file, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project does not yet follow
semantic versioning (still `0.1.0` in `package.json`), so entries are grouped by date and by
the commit that introduced them instead of by release tag.

## 2026-07-29 — Import / Export (`9103b15`)

### Added
- STEP export/import against the OpenCASCADE kernel. STEP is written from the kernel's own
  B-Rep (`ADVANCED_BREP` entities, not a tessellation), so an exported file round-trips
  exactly — re-importing it reproduces the same bounding box and surfaces.
- STL (binary) export/import for manufacturing hand-off and 3D printing. Lossy by
  construction, since triangulation is a property of the format.
- Native save/open dialogs on the desktop (`write_binary_file` / `read_binary_file`, two
  scoped Rust commands rather than the broader filesystem plugin), with a browser
  download/`<input type="file">` fallback in `vite dev` and the automated tests.
- Imported bodies enter the model as a base solid with no feature history to replay,
  tracked by feature id in `kernel/importedShapes.ts` and excluded from undo/redo since
  they are WebAssembly-backed kernel objects, not serialisable state.
- A status-bar toast (`state/geometryStore.ts`) for interchange progress and outcomes,
  independent of the rebuild-status field.

### Fixed
- **Memory corruption in the vendored kernel.** `replicad@0.23.1`'s module-level
  `exportSTEP()` cleans up interrelated OpenCascade objects through a
  `FinalizationRegistry`, and two of them share C++-side reference-counted ownership;
  when the browser's GC eventually ran, both cleanups could fire and double-free the same
  object, corrupting the WASM heap. Confirmed by forcing GC after a single export
  (`node --expose-gc`): the *next* kernel call threw `RuntimeError: memory access out of
  bounds`, and the corruption wasn't scoped to STEP export — it could take down unrelated
  subsequent kernel calls in the same session. Switched to `Shape.blobSTEP()`, a
  single-shape writer that deletes every OpenCascade object synchronously before
  returning, the same safe pattern `importSTEP`/`importSTL`/`blobSTL` already use.
  Verified stable under 8 exports with 16 forced GC cycles in a real browser tab.
- A document containing only an imported body (no sketch-based feature) never left
  rebuild status "empty" and never reached the viewport — the rebuild gate only
  recognised `extrude`/`cut-extrude` as geometry-contributing feature kinds.
- Import/export success and failure messages were sharing a status-bar field with the
  rebuild pipeline; since both actions trigger a rebuild a moment later, "Model up to
  date" could overwrite "Imported x.step" within a couple hundred milliseconds.

### Known limitations
- IGES export/import is not available: the bundled OpenCASCADE build has zero IGES
  symbols compiled in. The ribbon button stays visible but disabled, with the reason in
  its tooltip.

## 2026-07-29 — Step 5: 3D geometry (`a823df1`)

### Added
- OpenCASCADE (WebAssembly) geometric kernel via [replicad](https://replicad.xyz),
  loaded lazily on the first feature that needs geometry.
- Extruded Boss and Extruded Cut features, with Blind, Mid Plane and Through All end
  conditions and a Reverse Direction option, all editable from the property manager.
- Closed-loop extraction from a sketch (`kernel/profile.ts`): the largest closed region
  becomes the solid body, smaller regions inside it become through holes.
- Rebuilds run only over features above the rollback bar and skip suppressed ones, so
  rollback and suppression genuinely re-evaluate the model. Rebuilds are debounced, and
  only the newest request may publish its result.
- The rebuilt solid renders shaded with the kernel's own B-Rep edges rather than a
  wireframe of the triangulation.

## 2026-07-29 — Step 4: 2D sketcher (`1faaf8f`)

### Added
- Sketch mode on any reference plane: the camera squares up to the plane and the
  property manager becomes the sketch panel.
- Line, rectangle, circle, spline and construction-line drawing with point snapping;
  clicking near an existing point reuses it, which is what makes a drawn profile
  genuinely closed.
- A numeric constraint solver (`sketch/solver.ts`): damped Newton iteration over a
  finite-difference Jacobian, with degrees of freedom computed from the Jacobian's rank
  so the status bar reports Fully Defined / Under Defined / Over Defined.
- Geometric relations — coincident, horizontal, vertical, parallel, perpendicular,
  tangent, equal, point-on-line, fix.
- Dimensioning — distance, horizontal/vertical distance, radius, diameter, angle, and
  **ordinate** dimensions measured from the sketch origin, so a chain of them shares one
  datum instead of accumulating tolerance.
- Dragging a point re-solves with it pinned to the cursor, so constrained neighbours
  follow and a fully defined sketch refuses to move.

## 2026-07-29 — Step 3: document model and feature tree (`0444e74`)

### Added
- Zustand store holding the document as an ordered feature list (`state/documentStore.ts`).
- Live feature manager tree with rename (double-click, F2, or row action), suppress,
  delete, rollback (with a draggable rollback bar), and undo/redo.
- New features insert at the rollback bar rather than appending, so adding a feature
  while rolled back places it where you're working. Deleting a feature deletes its
  dependents.
- Ribbon feature commands create real features; selection is shared between the tree,
  the property manager and the 3D viewport.

## 2026-07-29 — Step 2: viewport and camera system (`cc88bb4`)

### Added
- react-three-fiber canvas with SolidWorks mouse bindings (middle drag orbit, Ctrl+middle
  pan, Shift+middle/wheel zoom), left-click reserved for selection.
- Switchable orthographic/perspective camera, orthographic by default.
- The three default reference planes (Front/Top/Right) with hover and pick, the origin
  triad, a millimetre ground grid, and a navigation cube.
- `frameloop="demand"` rendering — frames only when something changes.

## 2026-07-29 — Step 1: project initialisation and UI shell (`d18032e`)

### Added
- Tauri 2 + React 19 + Vite 7 scaffold targeting Windows 11 x64, with Mica window effects,
  native decorations, and a light/dark Fluent 2 design system.
- Static application chrome: menu strip, ribbon command manager (driven from a
  declarative `ribbonConfig.ts`), feature manager tree, property manager, viewport
  surface, and status bar.
- `get_app_info` Tauri command, proving the Rust↔React IPC bridge end to end.

## 2026-07-29 — Initial commit (`677488c`)

- Repository created with `README.md` and `LICENSE`.
