# Changelog

All notable changes to MaBuCAD are documented in this file, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project does not yet follow
semantic versioning (still `0.1.0` in `package.json`), so entries are grouped by date and by
the commit that introduced them instead of by release tag.

## 2026-07-30 — Sketch Offset

### Added
- **`Offset`** creates a parallel copy of a selected line, circle, or arc at a distance
  the user types into a `window.prompt()` — the smallest UI a one-shot numeric tool like
  this needs, matching how `Mirror`'s axis-and-selection interaction was kept purely
  selection-driven rather than growing new inline chrome. A negative distance flips which
  side a line offsets to, and shrinks rather than grows a circle or arc; both are stated
  right there in the prompt, since there is no live preview to show it instead.
- `sketchModel.ts` gained `offsetEntities()`: a line offsets along its own outward normal
  (`(-dy, dx)/length`, scaled by the distance), a circle offsets by growing or shrinking
  its radius (`Math.max(radius + distance, 1e-3)` to keep it from collapsing through
  zero), and an arc offsets the same way a circle does — same centre and swept angles,
  new radius — with fresh `arc-radius` constraints added for the copy exactly as
  `mirrorEntities()` already does for a mirrored arc, since every arc needs its own pair
  regardless of how it was created.
- Like `Mirror`, this produces an independent copy, not a live offset relationship: the
  new entity has no reference back to the source, so editing the source afterward leaves
  the offset copy where it was. A true parametric offset relation is a larger feature
  (tracking the source entity and re-deriving the copy on every solve) that nothing here
  forecloses adding later.
- `sketchStore.ts` gained `offsetSelection(distance)`, filtering the current selection
  down to line/circle/arc entities (points and constraints aren't offsettable) before
  calling into `offsetEntities()`.

## 2026-07-30 — Document New / Open / Save

### Added
- **Whole-document persistence.** Until now the only way to save anything was STEP/STL
  export (`interchange.ts`), which round-trips a solid's B-Rep, not the parametric history
  that produced it — a `.step` re-import enters the document as an opaque imported body
  with no sketches or feature parameters left to edit. New `commands/documentIO.ts` saves
  the actual feature history and every sketch as JSON (`.mabucad`), so a reopened document
  is exactly as editable as it was before closing it.
- `runSaveDocument()`/`runOpenDocument()`/`runNewDocument()` reuse the same `saveBlob()`/
  `openFile()` native-dialog-or-browser-fallback helpers `interchange.ts` already
  established, and report through the same toast.
- `documentStore.ts` gained `loadDocument()`/`newDocument()` and `sketchStore.ts` gained
  `loadSketches()` — replacing state wholesale rather than going through `commit()`/`edit()`,
  since loading a different document is a fresh start, not an edit to the one that was open
  before it: the previous document's undo history would be meaningless applied to a
  different document anyway, and undoing "Open" back into an unrelated document makes no
  sense to offer.
- New/Open ask via `window.confirm()` before discarding a document with unsaved edits
  (`past.length > 0`, the same signal `MenuBar.tsx`'s own "Untitled *" indicator already
  uses) — Save never needs to ask, it only ever adds a file, never removes one.
- `kernel/importedShapes.ts` gained `releaseAllImportedShapes()`: New/Open release every
  imported shape the outgoing document held, since those are WebAssembly-backed kernel
  objects the JS garbage collector cannot reclaim on its own — the existing per-feature
  `releaseImportedShape()` has no reason to run once whole-document replacement is doing
  the work, but the shapes still need releasing somewhere.
- An imported feature's own geometry is deliberately not part of the saved file — see
  `documentIO.ts`'s own doc comment for why, and what happens on reopening one.

## 2026-07-30 — Zoom to Fit, Display Style, Hide/Show

### Added
- **`Zoom to Fit`** reframes the camera on the model's true world-space bounding sphere —
  computed from the same triangulated mesh `SolidModel.tsx` renders, with `mesh.rotation`
  (the sketch plane's placement) applied to each corner of the local bounding box before
  taking its sphere, since the raw positions are still in the sketch's local space. New
  `ZoomToFit.tsx`, rendered inside the `Canvas`, is what makes this possible at all: the
  ribbon lives outside the r3f tree and can't reach the camera directly the way
  `CadControls.tsx` does from inside it, so `viewportStore.ts`'s `zoomFitRequest` counter
  is the bridge — incremented by the ribbon command, watched by an effect that does the
  actual camera math. With no model yet, it falls back to a fixed default framing.
- **`Display Style`** cycles Shaded → Shaded with Edges (the existing default) →
  Wireframe on each click — the ribbon has one button, not SolidWorks's dropdown, so
  cycling is the only affordance a single click has. "Wireframe" here means the B-Rep
  edges `SolidModel.tsx` already draws as a separate overlay, not the raw triangulation —
  showing the real triangle wireframe would defeat the entire reason that overlay exists
  (a curved face reading as curved, not faceted). The shaded mesh stays in the scene graph
  in every mode, just with an invisible material when hidden, rather than being removed or
  set `visible={false}` — either of which would also drop it from raycasting and take
  right-click selection of the solid with it.
- **`Hide / Show`** toggles the reference planes and origin triad together — the two
  things "reference geometry" means today, since a document only ever has the one
  modelled body and there's no separate axis geometry to toggle independently yet. A
  selected plane still shows even when toggled off, the same carve-out
  `ReferencePlanes.tsx` already had for a plane dimmed by having a solid — the selection
  needs something to point at.
- New `state/viewportStore.ts` holds all three: display mode, reference-geometry
  visibility, and the zoom-fit request counter — none of it belongs in `documentStore.ts`
  (it's not part of the document) or `sketchStore.ts` (it applies outside sketch mode too).

### Fixed
- A freshly built mesh already asked the demand-render canvas for a frame
  (`invalidate()`), but a display-mode change swaps which materials/overlays are mounted
  without touching the geometry itself, so it was never asking for one — the mode would
  change in React's state but the canvas would keep showing the old frame until something
  else (an orbit, a resize) forced a redraw.

## 2026-07-30 — Sketch Mirror

### Added
- **`Mirror` sketch tool.** Select a construction line plus one or more entities and apply
  it: each selected entity gets a new mirrored copy, added rather than linked back to the
  original — SolidWorks keeps a live symmetric constraint instead, which would need a new
  residual kind of its own; a one-shot copy covers the common case (finishing a symmetric
  profile by hand) without that machinery.
- `mirrorEntities()` (`sketchModel.ts`) reflects a point about the axis line and reuses it
  via the same `ensurePoint()` every drawing tool already uses, so mirrored copies of
  adjacent entities that share a point still share the mirrored point too. Every entity
  kind is covered (line, circle, arc, spline, standalone point); an arc's start/end are
  swapped on its mirrored copy, since reflection reverses orientation and the sketch's
  fixed "always sweeps counter-clockwise from start to end" convention would otherwise
  draw the far side of the circle instead of the true mirror image — the mirrored arc also
  gets its own pair of `arc-radius` constraints, exactly like one drawn from scratch.
- `sketchStore.ts`'s `mirrorSelection()` resolves the axis as whichever selected entity is
  a construction line, mirroring everything else selected — matching how `applyConstraint`
  already resolves its own selection shape per constraint kind.

## 2026-07-30 — Arc sketch entity

### Added
- **Centrepoint `Arc` sketch tool** — three clicks (centre, then start, then end), always
  sweeping counter-clockwise from start to end. Tangent and 3-point arc variants (also
  named on the ribbon) are not built; a single well-defined creation mode covers what
  every other piece of arc support (the solver, loop detection, the kernel's draw path)
  needs, and adding the other two is pure UI work layered on top of the same entity.
- **`ArcEntity`** (`types.ts`) stores centre/start/end point ids plus a radius, the same
  shape a circle uses. Two new `arc-radius` constraints (auto-added by `addArc()`, not
  user-facing) pin each rim point to that radius from the centre, exactly like a
  rectangle's edges get auto-added horizontal/vertical constraints — without them,
  dragging either rim point would let the "arc" stop being circular.
- **The solver treats an arc's radius as a variable exactly like a circle's** (`buildLayout`/
  `packVariables`/`unpackVariables` in `residuals.ts`), so a Radius/Diameter dimension
  drives an arc the same way it already drives a circle, with no new dimension-side code.
- **The kernel's loop walk (`kernel/profile.ts`) now treats lines and arcs as one edge
  type** (`start`/`end`, degree-counted the same way) rather than only recognising lines,
  and each walked ring carries exact per-edge segments (a plain line, or an arc plus the
  midpoint replicad's `threePointsArcTo` needs) instead of just a flat point list —
  `rebuild.ts`'s `drawRegion()` draws each accordingly, so a profile mixing straight and
  curved edges extrudes/revolves as real curved B-Rep, not a polygon approximation.
- An arc's bulge is accounted for in the outer/inner region-size ranking too
  (`loopSignedArea()`), not just the straight-edged polygon through its vertices, since a
  large enough bulge could otherwise flip which region is picked as the boss.

### Fixed
- **A loop can close with as few as two edges once arcs are allowed** (a line and an arc
  sharing both endpoints, say), unlike a lines-only loop where two straight segments could
  only ever retrace each other and three was the true minimum. Both `hasClosedProfile()`
  (the sketch panel's Open/Closed status) and `extractLoops()` (the kernel's own walk)
  still carried the lines-only "at least 3" threshold over verbatim when arcs were added,
  which silently rejected the smallest — and most obviously useful — arc profiles.
- **Switching sketch tools mid-gesture left stale state behind.** Line and
  construction-line deliberately leave their draw anchor set after finishing, so the next
  click chains a new segment from that endpoint — but nothing reset that anchor (or a
  part-drawn spline's points) on switching to a *different* tool without first pressing
  Escape or right-clicking to finish. The next tool's first click would misfire using
  leftover geometry from the one before it — concretely, an arc's first click landing in
  its second-click branch and using a stale line endpoint as its centre. Fixed with a
  `useEffect` in `SketchCanvas.tsx` that clears this state on every tool change.

## 2026-07-30 — Point sketch entity

### Added
- **`Point` sketch tool.** Places a standalone reference point with a single click,
  unlike every other sketch tool (line/rectangle/circle/spline), which pairs an anchor
  click with a second click to finish — `SketchCanvas.tsx` special-cases it ahead of the
  shared anchor logic. New `PointEntity` in `types.ts` and `addPoint()` in
  `sketchModel.ts`, mirroring `addCircle()`'s shape.
- Wrapping the point in its own entity (rather than leaving a bare pool point) is what
  makes it durable rather than cosmetic: `deleteSelection` recomputes which points
  survive a delete from `entityPoints()` of the entities that survive, so an unwrapped
  point would have been silently pruned the next time *anything else* in the sketch was
  deleted, whether or not the point itself was ever selected.

### Fixed
- A gap that only this feature could expose: a standalone point entity renders as
  nothing but its own anchor dot (see `SketchGeometry.tsx`), so clicking it only ever
  selects the raw point id, never the wrapping entity's id. Left alone, that meant the
  entity would always survive `deleteSelection`'s filter and keep its point alive via
  `entityPoints()` regardless of what was selected — deleting a point would silently do
  nothing. Fixed by having `deleteSelection` treat a selected point id as also selecting
  any point-entity anchored there.

## 2026-07-30 — Concentric geometric relation

### Added
- **`Concentric` sketch relation**, the one relation kind missing from an otherwise
  complete set (horizontal/vertical/parallel/perpendicular/tangent/coincident/equal/
  point-on-line/fix). Selecting two circles and applying it adds a residual that pins
  their centre points together — mechanically the same equation `coincident` already
  uses on two directly-selected points, just resolved from each circle's `.center`
  instead. Wired through the existing generic `applyConstraint`/`addConstraint` path
  (`sketchStore.ts`, `sketchModel.ts`), so no new solver plumbing was needed beyond the
  one residual case in `residuals.ts`.
- Surfaced in both places the other relations already are: the ribbon's Geometric
  Relations group (already present, just unwired) and the in-sketch property panel's
  quick-access relation grid.

## 2026-07-30 — Linear Pattern, Circular Pattern and Mirror

### Added
- **Real kernel-backed geometry for Linear Pattern, Circular Pattern and Mirror.** All
  three existed in the ribbon and property manager already but built nothing. Unlike
  Extrude/Revolve, these features repeat or reflect an *existing modelling feature*
  rather than a sketch, so `rebuild.ts`'s main loop now keeps a `featureSolids` map of
  each modelling feature's own contributed solid (and whether it was a cut), keyed by
  feature id — the same shape `buildFeatureSolid`/`buildRevolveSolid` already produced,
  kept around instead of being discarded once fused into the cumulative body. A pattern
  or mirror looks its source up in that map and transforms/re-fuses (or re-cuts) just that
  contribution.
- **`buildLinearPatternSolid`/`buildCircularPatternSolid`/`buildMirrorSolid`** share a
  `buildCopies()` helper: since replicad's `translate`/`rotate`/`mirror` each free the
  shape they're called on and return a new one, every copy starts from its own `clone()`
  of the source. A pattern only builds instances `1..count-1` — the seed instance is
  already part of the model from the source feature's own turn through the rebuild loop.
- **No face/edge-picking UI exists yet** (that's Fillet/Chamfer/Shell's problem too), so
  direction/axis is a new `axis?: "x" | "y" | "z"` parameter instead of a picked
  reference: the translation direction for a linear pattern, the rotation axis (through
  the origin) for a circular pattern, and the axis whose normal plane a mirror reflects
  across. Exposed in the property manager as a dropdown next to the existing End
  Condition one.
- Clicking "Linear Pattern"/"Circular Pattern"/"Mirror" auto-attaches a source feature
  the same way Extrude/Revolve auto-attach a sketch: the selected feature if it's a
  modelling kind (extrude/cut-extrude/revolve/cut-revolve/imported), else the most recent
  one above the rollback bar. `commandRegistry.ts` gained `addPatternFeature()` and moved
  the three commands from the plain `addFeature`-only path into it.

### Fixed
- The same `GEOMETRY_FEATURE_KINDS` gap fixed for `imported` and then `revolve`/
  `cut-revolve`: `geometryStore.ts`'s whitelist now also lists `linear-pattern`/
  `circular-pattern`/`mirror`, so a document whose newest modelling feature is one of
  these actually reaches the kernel instead of sitting at `empty`.

## 2026-07-30 — Revolve and Cut-Revolve

### Added
- **Real kernel-backed geometry for Revolved Boss and Revolved Cut.** Both existed in the
  ribbon, feature tree and property manager already but silently built nothing — the
  rebuild loop only recognised `extrude`/`cut-extrude`. `kernel/rebuild.ts` gained
  `buildRevolveSolid()`, parallel to the existing `buildFeatureSolid()` and reusing its
  `profileRegions()`/`drawRegion()` helpers verbatim, calling replicad's `.revolve(axis,
  { origin, angle })` instead of `.extrude(distance)`.
- **Revolve axis**: the first construction line drawn in the sketch, or the sketch's local
  Y axis through the origin when none exists. The fallback isn't cosmetic — replicad
  defaults an omitted axis to the sketch plane's own normal, which is coplanar with a flat
  XY profile and produces a degenerate result, not a safe no-op the way extrude's own
  all-defaults call is.
- Clicking "Revolved Boss"/"Revolved Cut" now auto-attaches a sketch the same way
  Extrude/Cut-Extrude do (the selected sketch, else the most recent one above the rollback
  bar) — `commandRegistry.ts`'s `addExtrudedFeature` was generalised to
  `addSketchFeature` and both commands moved from the plain `addFeature`-only path into it.

### Fixed
- A gap the rebuild-loop fix alone wouldn't have caught: `geometryStore.ts`'s own
  `GEOMETRY_FEATURE_KINDS` whitelist (separate from `rebuild.ts`, gating whether the kernel
  is even invoked) still only listed `extrude`/`cut-extrude`/`imported`. A document whose
  only modelling feature was a revolve would hit `modelling.length === 0` and never reach
  the kernel at all — the same bug already fixed once for `imported` bodies, now fixed the
  same way for `revolve`/`cut-revolve`.

## 2026-07-30 — Sketcher interaction bug-fix pass

### Added
- **Right-click context menu extended to the 3D viewport.** Right-clicking a reference plane
  now selects it and offers "New Sketch"; right-clicking the modelled solid selects the most
  recent feature that contributed geometry to it (the renderer combines every modelling
  feature into one mesh, so there is no per-face feature id to target more precisely) and
  offers Suppress/Unsuppress, Roll Back to Before, and Delete — plus "Edit Sketch" when that
  feature is a sketch. Shares its styling and DOM-overlay-outside-the-Canvas structure
  (`ViewportContextMenu.tsx`) with the sketch canvas's own menu from the same pass.

### Fixed
- **Points and geometry swallowed clicks meant for the active drawing tool.** Every sketch
  point (and every line/circle/spline) had an unconditional `onClick` that stopped
  propagation and selected it, regardless of which tool was active. Since points render
  slightly in front of the drawing surface, this meant clicking on an existing point while
  drawing a line — including the origin, and including the endpoint just created a moment
  earlier — always got treated as a selection instead of reaching the canvas's own
  line-continuation/snap logic. This was the root cause behind three separate symptoms:
  a line couldn't be connected to a point shared with another line, a line couldn't start
  from the origin, and drawing looked like it "only worked once" (chaining a second segment
  onto the first segment's endpoint hit the same swallow). Point pick-meshes and entity/
  dimension click handlers in `SketchGeometry.tsx` / `SketchDimensions.tsx` now only
  intercept the click while the Select tool is active; with a drawing tool active, the
  click passes through to the canvas plane, which already snaps to nearby points correctly.
- **An exited sketch had no way back in.** `resumeSketch(featureId)` already existed in
  `sketchStore.ts` but nothing in the UI called it, so leaving sketch mode looked like the
  sketch had been deleted (its geometry only renders while it is the active sketch).
  Double-clicking a sketch in the feature tree now resumes it, matching SolidWorks; the
  ribbon's Sketch command also resumes an already-selected sketch instead of creating a new
  empty one on top of it.
- **No right-click menu in the sketch canvas.** Right-click on empty selection now opens a
  small context menu (tool switches, Delete, Exit Sketch); right-click while mid-draw keeps
  finishing/cancelling the in-progress entity, as before.

### Also found and fixed while verifying the above
- A first attempt at the click-gating fix additionally toggled each mesh's `raycast` prop
  as a defensive measure. react-three-fiber does not reliably restore a mesh's default
  raycast method once a prop has set it to a no-op, so any point created while a drawing
  tool was active became permanently unselectable afterwards, even back in Select mode.
  Removed — the `onClick` gating alone is sufficient, since r3f already continues the
  raycast past objects with no handler attached.
- The same `raycast`-prop-toggling bug also existed in `ReferencePlanes.tsx` (toggled on
  entering/leaving sketch mode), and was real: reference planes became permanently
  unselectable in the 3D viewport after a sketch had been opened once. Found while adding
  the viewport context menu to the same file; fixed the same way.
- Reference planes stayed raycastable after fading to full invisibility once a solid exists
  (their existing "step back like SolidWorks" behaviour dims them to `opacity: 0` but never
  stopped them intercepting the pointer), so a plane sitting where a sketch had been drawn —
  typically coincident with a face of the solid it seeded — silently swallowed clicks and
  right-clicks meant for the solid underneath it. Found via the new viewport context menu
  test (right-clicking the solid was selecting the Front plane instead of the extrude
  feature); fixed by gating plane pickability on the same condition that already drives
  its opacity. Still selectable from the feature tree in this state, as before.
- A first attempt at the viewport context menu subscribed to `selectBuiltFeatures` with
  `useDocumentStore` reactively; that selector returns a new array on every call, which
  Zustand's `useSyncExternalStore`-based hook treats as a change on every render, causing
  an infinite render loop (`Maximum update depth exceeded`) the moment a solid existed.
  Fixed by reading it via `useDocumentStore.getState()` inside the click handler instead,
  which is also more correct: only the value at the moment of the click is needed.
- The context menu's first implementation rendered via `ReactDOM.createPortal` from inside
  the sketch canvas's `react-three-fiber` tree, which crashed (`R3F: Svg is not part of the
  THREE namespace!`) the moment it tried to render an SVG icon — `createPortal` does not
  safely escape r3f's own reconciler. Moved the menu's open/closed state into
  `sketchStore.ts` and the menu component itself to a plain DOM sibling of `<Canvas>` in
  `Viewport.tsx`, outside the r3f tree entirely.

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
