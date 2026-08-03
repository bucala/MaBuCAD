# Changelog

All notable changes to MaBuCAD are documented in this file, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project does not yet follow
semantic versioning strictly (the `0.x.0` in `package.json`/`tauri.conf.json` bumps roughly
per feedback round so the in-app version number is a quick way to tell whether an installed
build actually contains a given round's work — see the entry below), so entries are grouped
by date and by the commit that introduced them instead of by release tag.

## 2026-08-03 — A working Print, honest ribbon descriptions, and Reference Geometry off window.prompt() (v0.6.0)

A tenth round, following a full audit of every ribbon tab (Home/Sketch/Features/Assembly/Drawing/Inspect) for the same "dead button" and "misleading description" defects earlier rounds found and fixed in the Sketch tab specifically. Confirmed **Assembly, Drawing and Inspect are entirely unbuilt scaffolding** — no command on any of the three tabs is implemented, and `NewDocumentDialog.tsx` already marks the Assembly/Drawing document types "Coming soon" — real future work, not something this round's smaller scope touches. Home and Features had smaller, fixable gaps:

### Added — a real Print
- **"Print" (Home ▸ Document) was a permanently disabled dead button** — implemented it: captures the current 3D view via the WebGL renderer (`preserveDrawingBuffer: true` added to the canvas so the frame is still readable after compositing) and opens the browser's print dialog on that snapshot, with a print stylesheet that hides the ordinary app chrome. There's no "drawing sheet" to print yet (see the Assembly/Drawing note above), so this honestly prints the current viewport as shown rather than pretending to print a real drawing.

### Removed — dead code
- **The "Boundary" surface feature button** (Features ▸ Add Material) had zero backing kernel code, unlike everything around it — removed rather than left as a dead promise; a real Boundary/surface-fill feature is future work, not a quick fix.

### Fixed — misleading ribbon descriptions
- **Fillet** claimed "constant or variable radius" — the kernel only ever applies one uniform radius; description now says so.
- **Chamfer** claimed "distance and angle" — only a plain symmetric distance is implemented; description now says so.
- **Shell** claimed "removing selected faces" — there's no face-picking UI yet, it removes whichever face(s) point along a chosen world axis (the property panel's own hint already says this); description now matches.

### Fixed — Reference Geometry off `window.prompt()`
- **Plane/Axis/Point reference geometry** (Features ▸ Reference Geometry) gathered their offset distance / world axis through browser `window.prompt()` dialogs, the same pattern already replaced for Offset/Mirror/Pattern in the Sketch panel. Turned out the real fix needed zero new UI: every other feature (Extrude, Fillet, a pattern's spacing, ...) already creates itself with sensible defaults and lets the Property Manager's existing generic field list (any parameter named `distance` gets a numeric field, any named `axis` gets an X/Y/Z dropdown) handle editing afterward — Plane/Axis/Point just needed to stop prompting and let that existing machinery do its job.

## 2026-08-03 — Runaway viewport growth fix, a real Sketch Fillet, and Offset/Mirror/Pattern panel UI (v0.5.0)

A ninth round, prompted by "keep finishing off unfinished corners of the Sketch section." Turned up a genuine, previously-unnoticed layout bug along the way that turned out to be the most important fix in this release.

### Fixed — a real bug: the 3D viewport grew continuously while a sketch was open
- **The viewport (and the WebGL canvas inside it) grew wider than the browser window, continuously, for as long as any sketch stayed open** — even completely idle, no drawing or clicking required, roughly 25px/second, unbounded, eventually pushing the ViewCube fully off-screen. Root cause: `.body` in `AppShell.module.css`, a CSS Grid item wrapping the resizable manager/viewport split, set `min-height: 0` (needed so it can shrink vertically) but never the equivalent `min-width: 0` — a grid item's default `min-width` is `auto`, meaning it refuses to shrink below its content's intrinsic width. `react-resizable-panels` computes its pixel-to-percentage panel split from *this* element's own measured width, so any content-driven overflow fed straight back into a wider computed width on the next measurement, compounding every cycle the instant a sketch's (wider) property panel replaced the idle Feature Manager's. Confirmed via direct DOM measurement over a 24-second idle window, in both dev and production builds — genuinely present, not a test artifact. Fixed by adding `min-width: 0` alongside the existing `min-height: 0`, and the equivalent on `.group`, the resizable-panels `Group` element one level down.

### Added — Sketch Fillet
- **A real sketch-level corner Fillet**, rounding the shared corner between two lines into a tangent arc at a given radius — trims each line back to its tangent point and inserts the arc, the same operation the PartDesign Fillet feature does on 3D edges, done directly on 2D profile geometry. New "Fillet" tool in the Sketch panel's Tools grid with its own Radius field; click two lines sharing a corner.
- **`Tangent` now also accepts an arc, not just a circle** (`residuals.ts`) — picking a line and an arc and clicking Tangent by hand previously added a constraint that silently did nothing (the residual only recognised `kind === "circle"`); it's a real, working relation now.

### Added — Offset/Mirror/Pattern get real panel UI
- **Offset and Pattern previously only worked through a chain of browser `window.prompt()` dialogs** reachable from the ribbon, with no controls anywhere in the Sketch panel itself — functional, but visibly a placeholder, and easy to miss entirely. Added a "Modify" section to the Sketch panel with real inline fields: Mirror (select entities + one construction-line axis, click Mirror), Offset (distance field + Apply), and Pattern (Linear/Circular, count, spacing or sweep angle, + Apply Pattern). The ribbon buttons now point at the panel instead of opening prompts.

### Removed — dead code
- **The "Text" sketch tool ribbon button** ("Place sketch text along a curve") had zero backing implementation anywhere — no entity kind, no store action, permanently disabled. Removed rather than left as a dead button promising an unbuilt curve-following-text feature; a real placed-text annotation tool remains open future work.
- Three unused `SketchTool` values (`"ordinate"`, `"ordinate-horizontal"`, `"ordinate-vertical"`) that no code path ever set — ordinate dimensioning is actually driven through the separate `applyOrdinateDimension` action.
- Leftover `console.log("DEBUG edit()", ...)` calls in `sketchStore.ts`, printing on every single sketch edit.

## 2026-08-03 — Dimension mode switching, click-first relations, and clearer selection highlighting (v0.4.0)

An eighth round of feedback, focused entirely on sketch-mode usability: two new interaction
flows (switching a length dimension's measurement mode, and arming a relation before picking
its elements) plus a real fix for selection being hard to spot at a glance.

### Added — dimensions
- **Right-click a Horizontal/Vertical/Aligned dimension to switch its measurement mode.** A
  new context-menu section (only shown for these three dimension kinds — Radius, Diameter and
  Angle dimensions are unaffected) lets you flip a length dimension between the three modes
  without deleting and re-adding it; the value re-measures from current geometry on switch.
  This surfaced a rendering gap along the way: `horizontal-distance`/`vertical-distance`
  dimensions already had their own solver residuals (signed axis-delta, same as ordinate
  dimensions) but were drawn identically to a plain `distance` dimension — an aligned leader
  running point-to-point instead of the axis-locked, square-dropped extension lines the solver
  behaviour actually implies. Both now render the same way ordinate dimensions already did.

### Added — relations
- **Relations can now be created "function first, elements second,"** in addition to the
  existing "elements first, function second" flow — click a relation button in the Add
  Relation panel to arm it (it stays highlighted while armed), then click the elements it
  applies to in the viewport; the relation applies automatically once enough elements are
  picked for that kind, the same "accumulate picks, auto-apply" pattern Smart Dimension
  already used. Escape cancels an armed relation before touching anything else (selection,
  active tool) — the same most-disruptive-first priority order Escape already followed.

### Fixed — sketch selection clarity
- **Selected sketch entities and points were hard to spot at a glance** — a selected point
  changed colour only (no size change, on an already-tiny 3.5px dot), and a selected line's
  only distinction was a 1px width bump plus colour. Both now also get a soft, translucent
  accent-coloured halo rendered behind them, and a selected point's dot itself grows — a
  clearer "this is what's active" signal than a colour/width change alone, regardless of theme
  or zoom level.

## 2026-08-02 — Constraint solver fixes, screen-space UI sizing, a real ViewCube, and Hole Wizard seats (v0.3.0)

A seventh round of feedback, the largest so far — a real constraint-solver bug, a
foundational screen-space-vs-world-space rendering fix that turned out to explain three
separate complaints at once, a full ViewCube rewrite, and a genuine Hole Wizard feature
expansion (seats, drill points, a fourth hole type) backed by real data pulled from
Autodesk's own Hole Wizard reference spreadsheets.

### Fixed — sketch constraints
- **A `Fix` constraint didn't hold when the fixed point was dragged.** Root cause: `dragPoint`
  moved the point to the cursor position *before* solving, so `fix`'s own anchor (always
  captured fresh from the sketch at the start of a solve) simply adopted the drag destination
  as the new "original" position — the point followed the cursor exactly, silently defeating
  the constraint. Dragging a genuinely fixed point is now a no-op, matching every other CAD
  sketcher's own behaviour.
- **A "Midpoint" snap didn't hold** — it was a one-time positional snap with no solver
  support at all (its own doc comment said as much), so anything that later moved the line
  left the "midpoint" point behind. Added a real, persisted `midpoint` constraint kind with
  its own solver residual; the smart drag-snap now adds this constraint instead of just
  repositioning the point once.
- **Constraints on a trimmed line vanished instead of carrying to the surviving pieces.**
  `horizontal`/`vertical` relations on the original line are now re-applied to every
  surviving segment, and a new split point created where the trim crossed another entity is
  now pinned back onto that entity (`point-on-line`/`point-on-circle`/`point-on-spline`,
  whichever fits) instead of being left as a bare, unconstrained point. Applies to
  `trimLineAt`, `trimCircleAt`, and `trimSplineAt` alike.
- **New `Colinear` constraint** (two lines share the same infinite line without their
  endpoints needing to touch) and **Coincident now accepts a point plus a curve** (line,
  circle/arc, or spline), not just two points — dispatches internally to
  `point-on-line`/`point-on-circle`/`point-on-spline`.

### Fixed — sketch rendering and interaction
- **Sketch point dots rendered at a fixed world-space size**, so they ballooned to a
  nonsensical size zoomed in and shrank to nothing zoomed out — the same underlying bug also
  explained "clicking a line drags the whole thing": the invisible point pick-target used the
  same fixed world-space radius as the drawing tools' snap tolerance, so a click anywhere
  within a few mm of a point (most of a short or zoomed-in line) grabbed and dragged that
  point instead of reaching the line body. Added a `useScreenSpacePixelScale` hook (exact for
  the app's default orthographic camera, since one world unit spans exactly `camera.zoom`
  pixels there) and used it for point dots, the drawing cursor dot, and — separately — a new
  fixed-pixel drag-pick radius that no longer reuses the Settings ▸ Sketch snap-tolerance
  value at all.
- **Radius/diameter dimension arrows always anchored at the circle's exact centre**, which
  overlapped the centre point's own dot and could overshoot past a small circle's far rim
  (the arrowhead's own fixed size was larger than the circle). Arrows now anchor at the rim
  point toward the label — a radius dimension's leader runs rim → label, a diameter's runs
  the full rim → rim chord, continuing on to the label — the standard SolidWorks/Inventor
  convention.
- **The sketch Origin point's delete was a silent no-op.** It's correctly protected (every
  mainstream CAD tool blocks deleting a sketch's origin) but gave zero feedback; selecting it
  and hitting Delete now shows a toast explaining why, instead of doing nothing.

### Added — ViewCube
- **All four directional arrows (up/down/left/right) rewritten to snap to the next ViewCube
  landmark** (one of the 26 canonical face/edge/corner orientations — an 8-position azimuth
  ring crossed with a 5-position elevation ring) instead of orbiting by a fixed angle from
  wherever the camera happened to be. A fixed-angle orbit only lands cleanly on a recognizable
  face/edge/corner if the starting view already was one; from anywhere else (an isometric
  start, or a view left mid-orbit by a mouse drag) it drifted into odd in-between orientations
  that compounded with every further click — this was the real "left/right rotate
  incorrectly" bug, and also explains "down doesn't work" (the old fixed 5° pole guard could
  reject a legitimate transition near a pole even when the actual target landmark was
  perfectly reachable; landmarks now include the poles themselves as valid stops). Rotate
  View CW/CCW (the roll arrows) are unchanged, as requested.

### Added — Fillet/Chamfer edge highlight
- **Picked edges are now highlighted as their own contour** in a distinct colour, replacing
  the small sphere markers dropped at the click point. Uses a new `EdgeGroup` export from the
  kernel — replicad's own `meshEdges()` already returns per-edge groups (`{start, count,
  edgeId}`), just omitted from this file's own hand-written type annotation until now, the
  same shape of gap `faceGroups` closed for face selection a few rounds back.

### Added — Hole Wizard
- **Seat types**: None / Counterbore / Spotface / Countersink, each with real kernel geometry
  (a wider cylindrical recess, or a countersink's conical taper sized from its own included
  angle) and real dimensions sourced from Autodesk's own Clearance Hole Spreadsheet — Socket
  Head Cap Screw ISO 4762 for counterbore, Hex Head Cap Screw ISO 24014 for spotface,
  Countersunk Flat Head Screw ISO 2009/7046 for countersink, the same per-seat fastener style
  choice Inventor's own Hole Wizard defaults to.
- **Drill Point**: Flat (unchanged) or Angle — a blind hole's bottom now tapers to a real
  118° conical point like an actual twist drill, instead of always cutting flat.
  Through-all/up-to-surface holes have no "bottom" to shape, so this only applies to Blind.
- **Taper Tapped**, a fourth Hole Type alongside Simple/Clearance/Tapped, sized from real NPT
  tap-drill data (published standard values, not derived from the thread-geometry sheet's
  pitch-diameter columns, which don't capture practical tapping allowances). Cuts a straight
  hole at the correct tap-drill diameter; the actual 1:16 pipe taper itself is not modelled —
  said so directly in the panel rather than silently pretending it is.
- **Thread Direction** (Right/Left hand, shown in the thread designation as "(RH)"/"(LH)")
  and **Full Depth** are tracked for Tapped/Taper Tapped holes; both are display-only for now
  (this app still doesn't model a real thread profile at all), not yet read by the kernel.

### Test plan
- `npx tsc --noEmit` clean, `npm run build` clean
- Existing `tree.mjs` (12), `trim.mjs` (14), `fillet-edge-picking.mjs` (17),
  `settings-export-import.mjs` (3), `constraint-glyph-check.mjs` (2) all still pass on a
  freshly-started dev server
- Fix-constraint-holds-under-drag and Colinear-button-exists verified directly via Playwright
- Fillet edge highlight verified visually (screenshot from a 3D angle) after confirming the
  new `EdgeGroup` start/count convention empirically (12 groups for a 6-face box, exact
  vertex-count match)
- Hole Wizard seat-type change and drill-point change both verified to rebuild cleanly with
  no console errors
- `sketch.mjs`'s rectangle-profile-closes assertion was investigated as a possible
  regression — confirmed via repeated fresh-dev-server runs to fail identically on an
  unmodified baseline, i.e. pre-existing timing flakiness in the test itself, not a
  regression from this round

## 2026-08-02 — A round of real bugs, one important discoverability fix, and two toggles

A sixth round of feedback, mostly bug reports rather than new-feature asks. Several turned
out to be real, confirmed bugs; a couple turned out to be existing functionality with no
visible way to find it, which reads exactly like "broken" from the outside — both kinds are
treated as bugs here, since the second is just as much a real problem for whoever hit it.

### Fixed
- **A Fillet or Chamfer's own Property Manager (the "Select Edges" toggle and the Radius
  field) never appeared after creating one from the ribbon** — the left dock stayed on the
  Feature tree tab, one click away from the panel that actually lets you scope the feature
  to specific edges or change its radius. Reported as "Fillet/Chamfer executes randomly, I
  can't select edges or edit the values afterward" — the edge-picking and value-editing
  machinery already worked (confirmed: the existing 17-assertion Playwright suite for it
  already passed, unchanged, before this fix), it just weighed anchor invisibly behind an
  unselected tab. `ManagerPanel.tsx` now swings to the Property Manager whenever a single
  feature becomes selected outside sketch mode — not just when entering a sketch, which was
  already the existing rule for that case — so a brand-new Fillet/Chamfer (or any other
  feature) shows its own properties immediately, the same as SolidWorks/Inventor already do.
- **A Hole placed via Hole Wizard's "click a face" flow (added last round) had no visible
  way to edit its position afterward** — reported as "no sketch gets created, can't move the
  hole." A backing sketch *is* created (confirmed: it already appears correctly in the
  Feature tree, one row above the Hole feature, and dragging its point there already
  repositions the hole on Exit Sketch) — the real gap was that right-clicking the *Hole*
  feature itself offered no way to reach it, only right-clicking its separately-listed
  sketch row did. `FeatureContextMenu.tsx` now offers "Edit Sketch" on any sketch-consuming
  feature (Hole, Extrude, Revolve, Rib, ...), not just on a sketch row directly, jumping
  straight to that feature's own backing sketch — the same shortcut SolidWorks/Inventor
  give a Boss-Extrude or Cut.
- **A duplicate relation was added every time "Constraints smart" (drag-snap-suggest) ended
  a drag near a suggestion it had already applied** — nudging the same point back onto the
  same target a few times left several redundant coincident/tangent constraints stacked on
  the same two things, each with its own constraint glyph, reading as visual clutter (and,
  per the report, "constraints disappearing" — actually a dense pile of them at one spot).
  `addConstraint` (`sketchModel.ts`) is now idempotent: adding a relation identical to one
  that already exists (same kind, same entities, same points, order-independent) is a
  no-op. This also covers the explicit "Add Relation" panel buttons (Horizontal, Parallel,
  ...), which shared the same gap.
- **There was no way to turn "Constraints smart" off** — reported as "I don't know where the
  button is." There wasn't one; it always ran. New `smartConstraintEnabled` setting (on by
  default, preserving existing behaviour) with a toggle button in the status bar, sketch
  mode only, next to the other sketch toggles.
- **`trimCircleAt` silently did nothing when a circle had fewer than two crossings** —
  contradicting its own doc comment ("the whole circle is removed instead"), which is what
  a line with no crossings already correctly does. Found while reproducing the constraint
  report above with a circle that turned out not to actually overlap anything: clicking it
  in Trim mode had no effect at all rather than deleting it. Fixed to actually call the same
  cleanup a real removal uses.
- **ViewCube left/right arrows never landed cleanly on the next octant** — reported as "they
  rotate incorrectly, they should flip to the next face the way the up arrow does." Up/down
  already read as landing cleanly because they run into the near-pole guard after one or two
  15°-off-90° steps and stop there; left/right had no such guard and just kept orbiting
  through arbitrary 45°-off angles. Since horizontal orbit around the world Y axis has no
  pole to run into, left/right now step by a full 90° instead — every click reliably lands
  on the next corner (Front/Right/Top → Left/Front/Top → ...) with the current elevation
  preserved. Up/down/roll are unchanged.
- **Dropdown `<option>` lists (Settings' Language selector, Hole Wizard's Standard/Size/Fit
  selectors) could render with a translucent background nearly indistinguishable from white,
  making the selected item unreadable** — reported as "dropdowns have a white background
  and I can't see the selection, throughout the app." The closed `<select>` box itself
  reads fine (translucent over the app's own dark background), but the open popup list is a
  separate native overlay that doesn't sit over that background — inheriting the same
  translucent fill there can wash out to near-white depending on how the host renders it.
  `<option>` elements now get their own explicit, opaque colours (`--bg-solid` background,
  `--text-primary` text) instead of inheriting the input's translucent one. Not independently
  verified against the native Tauri/WebView2 shell this round (only the browser preview,
  where it was not reproducible to begin with) — flagged honestly rather than claimed fixed
  with certainty.

### Investigated, not reproduced
- **ViewCube down arrow "doesn't work"**: directly tested in isolation (fresh view, one
  click) and it rotates correctly, matching up/down's shared mechanism. Also tested a full
  up→down round trip, which correctly returns to the exact starting view (mathematically
  expected, and easy to misread as "down did nothing" if tried right after up). Left
  unchanged; flag it again with a specific repro (what was clicked immediately before) if it
  still happens.
- **Middle-mouse-button + Ctrl for pan**: already implemented (`CadControls.tsx`'s own doc
  comment has documented these bindings since Step 2 — middle-drag orbits, Ctrl+middle-drag
  pans, Shift+middle-drag zooms). No change needed.

### Known, still not attempted
- **Auto-selecting closed sketch regions, and highlighting an open contour with a specific
  warning** when extruding/cutting a sketch that isn't fully closed. Today's error
  (`"The sketch has no closed profile to extrude"`) is accurate but generic, and doesn't
  point at *which* stretch of the sketch is the problem — that needs new viewport rendering
  to highlight the specific open run, not just a better string, so it's scoped as its own
  round rather than folded in here.
- **Hole Wizard: sourcing every parameter from the referenced Autodesk documentation and
  rendering a real thread texture** (pitch/depth-aware). `data/holeStandards.ts` already
  carries real ISO clearance and tap-drill tables; visually texturing the resulting hole
  with actual thread geometry is a substantially larger rendering task, not attempted here.

## 2026-08-02 — Trim on circles and splines, and drag-to-window multi-select (items 6 and 7)

The last two items from the original feedback list: Trim's two remaining known gaps.

### Added
- **Trim now works on circles and splines, not just lines** (`trimCircleAt`,
  `trimSplineAt` in `sketch/sketchModel.ts`). A circle is a closed loop rather than an open
  run, so N crossing points split it into N arcs instead of a line's N-1 stretches;
  clicking one removes it and leaves the rest behind as arcs sharing the circle's own
  centre. A spline is trimmed along its own point-to-point chain — each stretch between
  two consecutive spline points is treated as straight for intersection purposes, the same
  as a line, and a surviving stretch keeps every original interior point that falls inside
  it, not just its two new endpoints, so the kept curve is still the shape actually drawn.
  Both dispatch through a new `trimEntityAt`, the single entry point the sketch canvas now
  calls instead of assuming every trim target is a line. Arcs and standalone points are
  still not trimmable themselves (though, as before, anything can still be trimmed *back
  to* where it crosses one).
- **Trim: drag a window to trim several entities at once**, alongside — not instead of —
  the existing click-based trim, which still works exactly as it always has (including on
  a circle "in between" other geometry, unaffected by this addition). Dragging the Trim
  tool out into a rectangle and releasing removes every entity **fully enclosed** by that
  window in one go (`trimEntitiesInWindow`); an entity the window merely crosses, without
  fully containing, is left untouched. Cropping a crossed entity exactly at the window's
  edge — the way a full "trim by window" tool would — is a further refinement on top of
  this, not what this pass delivers: the safer, well-scoped version of "select multiple
  entities to trim at once" is "erase what's fully inside the box," which is also the
  natural generalisation of the existing rule that an entity with nothing to trim back to
  gets removed outright, just triggered by window containment instead of a bare click.
  Click-vs-drag is judged the same way `useClickGuard.ts` already judges it for the 3D
  viewport (a small screen-pixel threshold), so a stationary click in Trim mode is
  unaffected and still reaches whichever entity's own trim handler it landed on.

## 2026-08-02 — A real per-face selection filter (item 2), building on replicad's own mesh output

The very next step after the previous entry: item 2's selection-priority filter, following
the 4-step plan worked out together (tag each triangle with its kernel Face during
tessellation → carry it through to the render layer → resolve it from a raycaster hit →
drive a Zustand-backed filter). Step 1 turned out to already half-exist: replicad's own
`Shape.mesh()` triangulates face-by-face internally and was already returning a
`faceGroups: { start, count, faceId }[]` array describing exactly that — `kernel/rebuild.ts`
was just discarding it. No OpenCascade/WASM binding changes were needed after all.

### Added
- **A working Face/Body selection-priority filter**, toggled from a new status-bar button
  (`Box`/`Square` icon, next to the Visual Style toggle). "Body" is the existing behaviour
  (unchanged) — clicking the solid does nothing on its own outside Hole Wizard placement or
  Fillet/Chamfer's edge-pick mode, same as before this round. "Face" resolves the *exact*
  kernel Face a click landed on and highlights just that face (a translucent cyan overlay,
  `FACE_HIGHLIGHT_COLOR`), with the status bar showing which one ("Face 6 selected").
  Switching a click at one face to a click at another swaps the highlight and the id
  immediately; switching the filter back to "Body" clears both.
- **Point and Body+Edge+Point priority are not implemented yet** — the plan called out
  "point select, face select, face+edge+point select, etc."; this round ships the Face and
  Body ends of that spectrum, since Face is what needed the new kernel-level identity and
  Body already existed. Point priority doesn't need any of this (a point is already just a
  clicked location), but has no UI yet; a combined multi-priority mode is future work once
  each individual one exists.

### Changed
- **`kernel/rebuild.ts`**: `MeshData` gained a `faceGroups: FaceGroup[]` field —
  `{ start, count, id }` triples describing each kernel Face's own contiguous range within
  `indices`, re-keyed 0, 1, 2, ... in `shape.faces` order (rather than trusting OpenCascade's
  raw, unfriendly `face.hashCode` straight through — a rebuild-scoped id is all a selection
  filter needs, and small sequential numbers read better in a "Face 6 selected" readout).
- **`SolidModel.tsx`**: a new `handleFaceSelectClick`, active only when the filter is set to
  "Face", maps a raycaster hit back to a kernel Face without any GPU-side bookkeeping —
  three.js's own `event.faceIndex` (the hit *triangle's* index in the geometry's index
  buffer) times 3 lands inside exactly one `faceGroups` entry's `[start, start+count)` range.
  This is a deliberate, simpler alternative to the originally discussed approach of adding a
  custom `faceIndex` vertex attribute to the `BufferGeometry` and reading it back per-vertex:
  three.js already reports which triangle a raycast hit natively, so no extra per-vertex GPU
  attribute or shader-side bookkeeping is needed to get the same answer. The highlighted
  face's overlay mesh reuses the base geometry's `position`/`normal` buffers with an index
  buffer sliced to just that face's triangles (`mesh.indices.subarray(start, start+count)`),
  the same "draw an overlay, don't mutate the base mesh" convention the edge-pick markers
  below it already use.
- **`viewportStore.ts`**: new `selectionFilterMode` ("body" | "face") and `selectedFaceId`,
  the latter cleared whenever the committed mesh reference changes — a Face id is only
  meaningful for the mesh it came from, since a rebuild can renumber faces entirely.

### Known, still not attempted
- **Edge priority** as a general selection filter (today edge-picking only exists inside
  Fillet/Chamfer's own dedicated pick mode) and **Point priority**.
- **Combined priority modes** ("face + edge + point", à la Inventor) — needs each individual
  priority to exist first.
- **Ribbon drag-to-rearrange**, **Trim** marquee-select and circle/spline support — unchanged
  from the previous entry.

## 2026-08-02 — Ribbon chrome toggles, Hole Wizard face placement, and a click-blocking bug fix

Continuing straight from the previous entry's finding on item 2 (face/edge selection):
agreed the kernel-side face/edge tagging is real, separate work, and started on the two
items that don't need it — item 3 (ribbon customisation) first as the lowest-risk change,
then item 1 (Hole Wizard placement) using the same "raw point + normal, no face identity
required" approach the existing Fillet/Chamfer edge-pick mode already relies on.

### Added
- **Ribbon customisation, starting point.** Right-clicking anywhere on the ribbon (not just
  empty space — none of its buttons had a context menu of their own to conflict with) opens
  a menu with "Show Logo & Title" and "Show Version Number" checkboxes, plus direct Export
  Settings…/Import Settings… entries. Both toggles live in `settingsStore.ts` next to every
  other preference and are already covered by the existing Export/Import Settings
  round-trip (`settingsIO.ts`) — no separate "ribbon settings" file, so a customised ribbon
  travels with the rest of a backed-up/copied configuration for free. A full drag-to-rearrange
  ribbon layout is still future work; this round only tackles the two chrome elements the
  user specifically flagged as still fixed (`RibbonContextMenu.tsx`).
- **Hole Wizard: click a face to place a hole, no sketch required first.** Invoking Hole
  Wizard with no sketch-with-a-point already selected now arms a placement mode (a toast
  explains what to do) instead of creating a broken feature; clicking a solid face creates
  a backing sketch with a point at that location and the Hole feature in one step, ready to
  tune (radius, depth, standard) in the Property Manager immediately. Uses the raycaster's
  hit point *and* the clicked triangle's face normal — matched against the three default
  planes' own normals to find which one the face is (anti-)parallel to — which is enough
  to place a hole correctly without any real per-face identity from the kernel, the same way
  Fillet/Chamfer's edge-pick mode only ever needed raw 3D points, never a real edge id. Only
  faces (anti-)parallel to Front/Top/Right are accepted (an angled or revolved face is
  rejected with a message rather than silently cutting in the wrong place) — the default
  "through-all" end condition still reaches a face offset along that normal correctly, since
  it's already a deliberately oversized cut in both directions from the sketch plane, so this
  covers the common case (a hole on a box's face) without needing `planeBasis.ts` to support
  an arbitrary plane offset yet.

### Fixed
- **A stray `<Html>` label could silently block every click meant for the geometry behind
  it (found while testing Hole Wizard placement).** The origin triad's X/Y/Z text labels
  (`Origin.tsx`) and the bottom-left orientation gizmo's axis letters (`LiveAxisGizmo.tsx`)
  each render via drei's `<Html>`, and neither had its wrapper div's `pointer-events`
  actually turned off — the inner `<span style={{ pointerEvents: "none" }}>}` only covers
  the text itself, not the positioned wrapper `<Html>` creates around it, so that
  invisible-but-present wrapper sat in front of the canvas and ate any click landing on or
  near it, most noticeably right at the origin (where the model itself usually is). Verified
  by an `elementFromPoint` check at the click coordinates, which returned that tiny wrapper
  div instead of the canvas. `SketchDimensions.tsx` had already hit this exact drei quirk
  and worked around it with `wrapperClass` (a real CSS `pointer-events: none` rule) instead
  of the `pointerEvents` prop, which drei only honours in `transform` mode; both origin-label
  components now use the same `wrapperClass` pattern (`nonInteractiveLabel.module.css`).
  This was an existing bug, not introduced by this round's Hole Wizard work — but Hole
  Wizard's placement clicks are exactly the kind of click this bug could silently swallow,
  which is how it was found.

### Known, still not attempted
- **Item 2 (Component/Part/Body/Face/Edge/Sketch selection-priority filter)** — needs the
  kernel-side face/edge tagging described in the previous entry
  (`kernel/rebuild.ts` → per-triangle face index → a `faceIndex` `BufferGeometry` attribute
  → read back from the raycaster hit → a Zustand-backed filter). Scoped as its own round.
- **Ribbon drag-to-rearrange** — this round only added chrome (logo/title/version)
  visibility toggles, not moving buttons or groups between tabs.
- **Trim**: drag-to-marquee-select multiple entities, and support for trimming circles and
  splines (still line-only).

## 2026-08-02 — ViewCube roll arrows, dimension arrowheads everywhere, a face-selection finding

A fifth round of feedback covering a broad set of areas. This entry's first pass (ViewCube
direction, the plain-arrow gizmo, arrowheads on linear/radius/diameter dimensions) is
below, followed by this pass's follow-up: the ViewCube's roll arrows, arrowheads on
ordinate dimensions too, and — the actual reason items 1 and 2 below are still not
attempted — a concrete finding about what this app's geometry pipeline would need before a
real per-face/per-edge selection system is possible at all.

### Fixed
- **The ViewCube's left/right navigation arrows rotated the view backwards.** Clicking
  "right" orbited the camera *away* from the model's right-hand side (toward more of its
  left), the opposite of what a right arrow should do; up/down were already correct and
  untouched. Verified by logging the camera's actual position before/after a click (ruling
  out an axis/elevation bug — the rotation was always a clean, correct horizontal orbit)
  and by watching which ViewCube faces come into view across a sequence of clicks. Fixed by
  swapping which direction gets the positive rotation.

### Added
- **Two roll arrows** at the ViewCube's diagonal corners, distinct in both position and
  icon from the four pan arrows — they spin the camera's own up vector around the current
  view axis (the horizon tilts; the camera stays put, still looking at exactly the same
  point), rather than orbiting around the model the way the four directional arrows do.

### Changed
- **The bottom-left orientation gizmo no longer draws a filled circle behind each axis
  letter.** It's a plain coloured arrow per axis with the letter at the tip instead —
  drei's `GizmoViewport` (used until now) always draws its axis labels inside a solid
  sprite disc, with no way to keep the label but drop just the disc, so this is a small
  bespoke replacement (`LiveAxisGizmo.tsx`) built the same way `Origin.tsx`'s static triad
  already is (coloured `Line` + a plain-text `Html` label, no mesh disc). Still purely a
  visual orientation reference with no click-to-align behaviour, same as before.
- **Dimension lines now have arrowheads** — linear, radius/diameter, and (this pass)
  ordinate dimensions. Previously all drawn as plain, arrowless lines, which at a glance,
  especially before a label has been dragged away from its tight default position, could
  read as an unlabelled tangle rather than an obviously-a-dimension line pointing at
  something specific. Angle dimensions don't have a leader line to attach an arrowhead to
  at all yet (they're label-only today) — drawing one properly needs an arc between the two
  measured lines, which is new geometry, not just an arrowhead on what's already drawn.

### A concrete finding: why a real face/edge selection filter isn't "just a dropdown"
Investigated what it would take to build the selection-priority filter from item 2
(Component/Part/Body/**Face**/**Edge**/Sketch priority, à la Inventor) and hit a hard
architectural wall worth stating plainly rather than shipping a dropdown that doesn't
actually filter anything: **`SolidModel.tsx` renders the rebuilt solid as a single fused
triangle mesh with no per-face or per-edge identity carried through from the kernel** —
`mesh.positions`/`normals`/`indices` are one flat buffer, and the only "edge picking" that
exists (Fillet/Chamfer's edge-selection mode) works by recording the raw 3D *point* a click
landed near and matching future clicks by *distance*, not by a real topological edge id.
There is nothing today that can answer "which face did this click land on" as a stable,
selectable identity. A genuine per-face/per-edge selection filter needs the kernel's mesh
builder (`kernel/rebuild.ts`) to tag each triangle with the OpenCASCADE face/edge index it
came from, and the picking code to look that tag up on a raycast hit — real work, but well
short of describable as "prepare the groundwork" and worth scoping as its own item rather
than folding into a UI-only pass.

### Known, deliberately not attempted this round
- **Hole Wizard**'s "pick an existing sketch, or click a plane/face to place a new point
  there" placement flow — tractable without face identity (a raw click point on the solid
  is enough, the same way Fillet/Chamfer's edge-pick mode already works), but still a real
  UI + Hole-feature-parameter change, not attempted alongside everything above.
- **Ribbon customisation** via a right-click context menu, plus extending the existing
  Settings export to include ribbon layout and chrome visibility (logo, title, version).
- **Trim**: drag-to-marquee-select multiple entities to trim at once, and support for
  trimming circles and splines (today only lines can be trimmed — `trimLineAt`'s own doc
  comment already flagged this as a known gap).

## 2026-08-02 — ViewCube arrow direction, plain-arrow gizmo, dimension arrowheads

## 2026-08-02 — Fixed the real cause of broken sketch drawing/dimensioning, viewport hint removed

A fourth round of feedback, including a report that a freshly drawn circle's Smart
Dimension showed a nonsensical value with garbled leader lines fanning out across the
sketch — reproduced directly: drawing a circle immediately after opening a sketch (the
ordinary way, via the ribbon's "Sketch" button) placed its centre tens of sketch units
from the actual click, while the same click sequence preceded by *any* other pointer
interaction worked fine.

### Fixed
- **Sketch drawing/dragging could silently land in the wrong place, most visibly right
  after opening a sketch or switching tools (critical).** Traced to React Three Fiber's
  own pointer-event raycasting (`event.point`) computing against not-yet-current internal
  state for a brief window after certain scene changes — confirmed with direct
  instrumentation (logging the camera's own position/zoom/frustum, canvas size, and the
  resulting world point on each click): every value read from the camera and canvas was
  already correct, yet the very next click's computed sketch position was still off by
  roughly 30–150 sketch units, self-correcting after that one click regardless of where it
  landed. Forcing an immediate camera matrix update, continuously refreshing the
  projection matrix every frame, and pre-warming the canvas with a synthetic pointer event
  on mount were all tried and none of them closed the gap — the fix instead sidesteps R3F's
  internal raycasting for sketch drawing entirely: `SketchCanvas.tsx` now computes each
  click's sketch-plane position itself, via a plain `Raycaster`/`Plane` intersection built
  fresh from the camera's current properties on every pointer event — the same technique
  `SketchDimensions.tsx`'s drag handling already used successfully. Verified by reproducing
  the original circle/dimension corruption directly, confirming it's gone, and re-running
  the full Playwright regression suite (~35 scripts) against both the fix and an unpatched
  dev-server control, confirming no new failures.
  **Known follow-up**: this same underlying gap can occasionally make a click on an
  existing sketch entity (a line, circle rim, etc. — not a fresh draw) miss right after a
  tool switch, since entity/point *selection* goes through a different code path
  (`SketchGeometry.tsx`'s own per-entity click handlers) that doesn't yet have the same
  fix; clicking again always works. Left for a follow-up round rather than rewriting every
  entity type's hit-testing under time pressure.

### Changed
- **Removed the "Middle drag orbit · Ctrl+middle pan · Shift+middle or wheel zoom" hint**
  from the bottom-right of the viewport.

## 2026-08-01 — Second CSP eval path fixed, ViewCube restored, rigid dimension labels, ribbon cleanup

A third round of feedback on a confirmed-fresh `0.2.0` build, including one report that the
previous round's CSP fix hadn't actually resolved sketch/feature selection — it had fixed
one of two separate places embind builds JavaScript from a runtime string, not both.

### Fixed
- **A second, much more pervasive CSP `'unsafe-eval'` violation (critical).** The previous
  fix patched `createNamedFunction`, which only fires when the kernel reports an *error*.
  Emscripten's embind runtime has a second, separate eval-requiring path —
  `craftInvokerFunction`, via `new_(Function, args1).apply(null, args2)` — which generates
  the JS invoker wrapper for *every single bound C++ method and constructor* across the
  OpenCASCADE API, including on ordinary, error-free sketch and feature operations. That's
  why it was still reachable: extruding a sketch or reselecting one for a second feature
  doesn't need the kernel to report an error, so the first fix never got exercised on that
  path. Static `grep` for `new Function(`/`eval(` in the built bundle found nothing, because
  the call references `Function` by identifier and invokes it via `.apply()` rather than the
  literal `new Function(...)` token — found instead by wrapping `window.Function`/
  `window.eval` in a `Proxy` via `page.addInitScript()` and tracing real call stacks through
  a full sketch → extrude → reselect repro against the actual production build (`vite
  preview` on `dist/`, not the dev server — Vite's dependency pre-bundling cache bypasses
  custom Rollup transforms, so the dev server can silently run unpatched code and mask this
  class of bug entirely). Fixed the same way as before: a second `oldCode`/`newCode` pair in
  `vite.config.ts`'s `patchEmbindNamedFunction` plugin, rewriting `craftInvokerFunction` as
  an ordinary closure that wires arguments and destructors identically to the original, with
  no eval-family API involved. Verified with zero `Function`/`eval` calls remaining anywhere
  in the traced repro, and the full existing Playwright regression suite passing identically
  on this build and on the (intentionally eval-using, CSP-exempt) dev server, confirming the
  rewritten invoker is behaviourally identical to the original for every bound kernel call
  the suite exercises.
- **The top-right ViewCube had stopped rendering entirely.** Two `GizmoHelper` instances
  (the ViewCube and the bottom-left axis indicator) were both left at drei's default
  `renderPriority` of 1 — and at priority 1, drei's `Hud` internals re-clear and redraw the
  *entire* main scene before layering their own overlay on top. With two Huds doing that at
  the same priority, whichever one's frame callback happened to run last won, and its clear
  wiped out the other's overlay before the frame ever reached the screen — the ViewCube
  losing that race is why it looked simply missing rather than glitched. Giving the
  bottom-left gizmo a distinct `renderPriority={2}` makes it layer on top instead of
  clearing and redrawing the scene a second time, so both now render correctly together.

### Changed
- **The bottom-left axis indicator is now purely a visual orientation reference.** It used
  to double as a (fiddly, easy to hit by accident) click-to-align control, duplicating the
  ViewCube. `GizmoViewport`'s own `disabled` prop turns off its hover/click-to-snap
  behaviour; the ViewCube remains the one control surface for jumping to a face, edge or
  corner orientation.
- **Dimension labels are now rigidly attached to their own witness/leader lines**, matching
  other CAD tools. Previously the leader lines were drawn at a fixed offset from the
  measured geometry while only the label moved on drag — dragging a label any distance left
  it visually stranded, disconnected from its own dimension line. The drag offset is now
  decomposed into a component perpendicular to the dimension (which the witness lines and
  the label share, so the whole dimension line moves out or in together) and a component
  along it (which slides the label along that line); radius/diameter leaders now always run
  straight from the centre to wherever the label currently is, rather than to a fixed point
  near the original edge.
- **Removed the redundant "New Sketch" ribbon button while already inside a sketch.** It was
  merely greyed out before, sitting right next to "Exit Sketch"/"Select" — a large disabled
  button that can't do anything in the current mode reads as a stray control rather than a
  clear affordance, so it's hidden instead of disabled for the duration of the sketch.

### Added
- **Navigation arrows around the ViewCube**, for stepping the view by a fixed 45° increment
  without needing to grab the cube itself — useful since clicking the cube only jumps
  straight to a face/edge/corner's canonical orientation. A plain DOM overlay reaching the
  camera through a `viewportStore` request, the same pattern `ZoomToFit.tsx` already used to
  cross the same DOM-to-r3f boundary.

## 2026-08-01 — Version bump, and a note on why a packaged build can look like it's "missing" work

Bumped `0.1.0` → `0.2.0` (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`)
after a report that a freshly-installed `.msi` didn't show most of the previous entry's
work — traced to the `.msi` having been built and committed (`git log --follow` on the bundle
file) about an hour *before* that entire round of fixes was written, not to anything actually
missing from the source. The version number hadn't moved between rounds, so there was no way
to tell the two apart just by looking at the running app. From here on, a round of fixes that
changes behaviour bumps this number, so "which build am I running" has an answer that doesn't
depend on remembering timestamps.

## 2026-08-01 — CSP crash fix, live gizmo, Inventor-style Smart Dimension, smart constrains, keyboard shortcuts, viewport backgrounds, Debug Mode

A second round of real-world feedback on the previous batch, including one critical bug
report: activating a feature (Extrude, etc.) inside the real packaged Tauri app — not
reproducible in this session's own dev/browser testing — threw a CSP `SecurityError` the
moment OpenCASCADE tried to report any internal exception, breaking feature activation and
sketch selection outright.

### Fixed
- **CSP `'unsafe-eval'` violation breaking OpenCASCADE error reporting (critical).**
  Emscripten's embind runtime names its generated Error subclasses (`BindingError`,
  `InternalError`, and the one that actually bit here — whatever class it wraps a genuine
  OpenCASCADE exception in) via `new Function(...)`, purely to give the class a readable
  `.name`. That needs `'unsafe-eval'`, which `tauri.conf.json`'s CSP deliberately doesn't
  grant (`'wasm-unsafe-eval'` only covers WASM instantiation). Inside Tauri's WebView this
  threw the instant the kernel needed to report *any* internal error, surfacing as a much
  more confusing failure — a broken rebuild, an unselectable sketch — with no message,
  since the code path meant to construct that message was what got blocked. This is why it
  never showed up in this session's own testing: the CSP is enforced only by the real
  packaged WebView2 runtime, not the Vite dev server or Playwright-in-plain-Chromium.
  Fixed with a build-time Vite plugin (`patchEmbindNamedFunction` in `vite.config.ts`) that
  replaces the eval-requiring implementation with an `Object.defineProperty`-based
  equivalent in the dependency's own source during the build, rather than hand-patching
  `node_modules` (wiped by `npm install`) or weakening the CSP app-wide.
- **Undo/redo didn't work for anything done inside a sketch — drawing, dimensioning,
  dragging.** Sketch geometry lives in its own store and is never written into the
  document, so `documentStore`'s undo history never captured it. `sketchStore` now keeps
  its own bounded 30-step history for the sketch currently being edited; Undo/Redo route to
  it while a sketch is open and fall back to the document's history otherwise. Also removes
  the second Undo/Redo button pair that duplicated the menu bar's, sitting above the
  feature tree, and drops the document history cap from 50 to 30 steps.
- **`deleteSelection()` silently did nothing for a directly-selected constraint or
  dimension** — it only ever filtered one out by whether the geometry it *referenced* got
  removed, never by its own id being selected. Selecting a constraint glyph or a dimension
  label and pressing Delete now actually removes it.

### Added
- **The bottom-left axis indicator is now a live 3D gizmo**, replacing a static SVG legend
  that never rotated with the camera despite looking like it should. Reuses the same
  `GizmoHelper`/`GizmoViewport` mechanism already driving the top-right ViewCube.
- **Smart Dimension reworked into an Inventor-style propose-then-commit flow.** Picking an
  entity used to commit a dimension immediately, which also made a two-line angle
  unreachable — a single selected line always resolved to a length, with no chance to add a
  second line first. It now proposes instead: the pick follows the cursor as a dashed,
  uncommitted preview; a second, compatible pick re-infers it (two non-parallel lines
  refine a length into an angle); a click on empty sketch space commits it there. Escape or
  a tool switch discards the proposal.
- **"Constrains smart"**: dragging a sketch point now suggests a relation live, shown as a
  ring and label that follows the drag and applies only on release. Another point nearby
  (including a circle/arc's own centre point) suggests Coincident; a line's midpoint
  suggests a Midpoint snap (positional only — there's no midpoint constraint kind to
  persist); an endpoint drag that leaves its line near-tangent to a circle suggests
  Tangent. Dragging a whole *line* onto a circle isn't covered — the sketcher only supports
  dragging individual points today — and there's no "point constrained to a circle's rim"
  relation yet, since that needs a new constraint kind and solver residual.
- **Constraint glyphs are clickable and deletable** — Select mode only, same convention as
  a dimension label: click to select, Delete to remove. They were purely decorative before.
- **Radius ↔ Diameter toggle and angle flip**, both via a dimension's right-click menu.
  Radius/Diameter converts the driving value (×2 or ÷2), not just the label. Flip Angle
  switches to the other of the two numerically distinct angles two intersecting lines form
  (θ and its supplement, 180−θ).
- **Esc/Del/Space keyboard shortcuts**, plus a new Settings ▸ Shortcuts tab to rebind any of
  them (Delete, Space for Hide/Show, Undo, Redo) by pressing a key. Escape already worked;
  Delete and Space had no keyboard binding at all before this, only their ribbon buttons.
- **The status bar's grid-hide toggle now also hides the sketcher's own in-plane grid** (it
  previously only affected the 3D viewport's ground grid, which never mattered while
  sketching since the ground grid already steps aside). A new snap-to-grid toggle (status
  bar, sketch mode only) snaps drawn and dragged sketch points to the 5 mm grid, layered
  behind the existing snap-to-nearby-point behaviour rather than fighting it. Both grids'
  line colours are also dimmed about 50%, mixed toward the viewport background.
- **Settings ▸ Colours ▸ Viewport Background**: Theme (the existing gradient, unchanged
  default), Solid, Gradient from centre, Gradient from bottom (both with an intensity
  slider), or an uploaded Image with its own opacity slider.
- **Settings ▸ General ▸ Debug Mode**: captures uncaught exceptions, unhandled promise
  rejections, `console.error`/`warn` calls, and geometry rebuild failures to
  `mabucad-debug.log` next to the installed executable. One line per event — an ISO-8601
  timestamp, a level, a short category tag, a message, and an optional structured JSON
  suffix — plain text and greppable rather than NDJSON. Off by default; meant to be turned
  on only while reproducing a problem, then the log file attached to the report.



A 12-item batch of real-world feedback, mostly against reference screenshots of another
CAD tool's own Display Appearance and Application Options dialogs.

### Added
- **Smart Dimension stays armed after use.** It used to fire once against whatever was
  already selected and drop back to Select; now activating it arms `"smart-dimension"` as
  a persistent tool the way Select/Line/Trim already are, so picking entities one after
  another keeps producing dimensions without re-clicking the ribbon button each time.
- **A dimension label can be dragged, and double-clicked to edit its value inline.**
  `SketchDimensions.tsx` converts a drag's screen coordinates into sketch-plane coordinates
  by ray–plane intersection (correct under both orthographic and perspective projection, at
  any zoom) and stores the result in `Dimension.labelOffset`, which every dimension kind now
  reads as a nudge on top of its own computed default anchor — including angle dimensions,
  whose label previously always rendered at the sketch origin regardless of the angle's real
  geometry, a latent bug this fix incidentally closed. Double-clicking swaps the label for
  the same `DimensionValueField` the Property Manager already used for typing a value
  (extracted to `components/shared/` so both places share it), with `,`/`.` decimal input.
- **The Line tool cycles through three variants**: Line → Construction → Axis Line → Line,
  via a single button in the sketch panel (the dedicated Construction button still exists
  alongside it). An axis line is a construction line specifically flagged `isAxis` — drawn
  dash-dot, the CAD convention for a centreline — and Revolve now prefers an explicit axis
  line over "just the first construction line found" when a sketch has more than one,
  removing the ambiguity when one construction line means a mirror axis and another means
  the revolve axis.
- **Sketch geometry stays visible after Exit Sketch**, drawn dimmed and click-through
  (`InactiveSketches.tsx`) instead of vanishing the instant you leave it — there was
  previously nothing left on screen to show what you'd drawn, or to reference when picking
  a sketch as input for another feature. Respects the existing per-feature hide/show.
- **A sketch already fully supported being reused as input for more than one feature**
  (select it in the tree, then run a second Extrude/Revolve/etc. — `resolveTargetSketchId()`
  already prioritised an explicit selection over "the most recent sketch") but nothing made
  that discoverable. The feature tree now shows a small badge on a sketch row counting how
  many other features currently consume it, with a tooltip explaining the click-then-run
  gesture.
- **The rollback bar can be dragged from anywhere along it, not just the small "ROLLBACK"
  text label** — the whole bar already showed the `ns-resize` cursor implying it was
  draggable everywhere, but the pointer handler was wired to the label span alone, so
  dragging from the line itself (the vast majority of the bar's own width, and the most
  natural place to grab it) silently did nothing.
- **Settings ▸ Display gains a real 3D Navigation section**: zoom-to-cursor (passed straight
  through to `OrbitControls`' own prop), ViewCube visibility, origin-indicator visibility,
  and new small X/Y/Z axis labels on the origin triad. Fixed a `frameloop="demand"` gap
  uncovered while wiring these up: toggling visibility from outside the canvas (the Settings
  dialog, the status bar, the feature tree) left the last frame on screen instead of
  repainting, affecting the origin, the default reference planes, user-created reference
  geometry, and the new inactive-sketch rendering — all now request a fresh frame when their
  visibility inputs change.
- **A new Settings ▸ Colours tab**: Theme and Accent Colour moved there from General, plus
  new Model Colour / Model Edge Colour overrides (each with an "Automatic" reset back to the
  theme-matched default) — the two pieces of the reference dialog's "Display Appearance"
  honestly achievable in this app's flat-shaded pipeline. Deliberately excludes anything this
  renderer can't actually do (Watercolor/Realistic Shading/Ground Reflections/Textures) —
  no toggle here does nothing.
- **New Document opens a visual Part / Assembly / Drawing picker** instead of creating a
  document immediately. Part works exactly as before; Assembly and Drawing are shown as
  disabled cards labelled "Coming soon" rather than hidden or silently doing nothing, since
  neither has a working ribbon tab yet.
- **A language switcher** (Settings ▸ General ▸ Language) lists all nine requested languages
  — English (default), Slovak, Czech, German, French, Italian, Spanish, Russian, Chinese.
  English and Slovak are fully translated for the app's chrome: every ribbon tab, group and
  command, the menu bar, the status bar, the Settings dialog's own tabs, and the New Document
  dialog. `i18n/translations.ts` needed no new keys invented for the ribbon — a command's own
  `id` already uniquely identifies it, so `t(item.id, englishLabel)` in `RibbonButton.tsx`
  was the whole wiring. The other seven languages are listed now and fall back to English
  string-by-string until translated, a documented next step rather than a placeholder.
- **File ▸ Autosave**, off by default. When on, a `localStorage` recovery snapshot of the
  document is written every 60 seconds while there are unsaved changes — deliberately not a
  file-system save, since every real Save needs a path the user picks (a native dialog inside
  Tauri, a download prompt in the browser) and a background timer popping that every few
  minutes would be worse than no autosave at all. **File ▸ Restore Autosave…** brings a
  snapshot back; a real Save clears it, since the file on disk is then the authoritative copy.

### Fixed
- The bottom status bar's cursor-coordinate readout was never wired to a live cursor
  position — it always read the literal text "X 0.00 Y 0.00 Z 0.00" regardless of where the
  pointer was. Replaced with two toggles that actually do something: cycling the Visual
  Style and showing/hiding the ground grid.

## 2026-07-31 — Regenerated the Tauri icon set from a sharper source

### Fixed
- `public/mabucad-icon.png` was replaced with a sharper 512×512 export of the same artwork
  after the previous entry shipped; the full Tauri icon set (`.ico`/`.icns`, every PNG size)
  is regenerated from it here so every size matches the same source instead of the earlier,
  smaller extraction.

## 2026-07-31 — A real app icon

### Added
- **The app now has a real icon**: a silver isometric-cube "M" mark with the MaBuCAD
  wordmark, replacing the placeholder blue outline cube. The full Tauri icon set
  (`.ico`/`.icns`, every `PNG` size including the Windows Store `Square*Logo`/`StoreLogo`
  assets) was regenerated from the source artwork via `tauri icon`, and the web favicon and
  README logo now point at a properly-sized 256×256 PNG instead of the ~6&nbsp;MB
  SVG-wrapped-PNG the source came packaged as.

## 2026-07-31 — Three theme skins, five live accent colours, an axis-cross legend, and a real README

### Added
- **Accent colour picker** in Settings > General: five swatches (the new default Coral
  `#DE7356`, the original Fluent Blue, Teal, Violet, Amber). Picking one re-tints the whole
  app live — buttons, tabs, selection highlights, sketch previews and the viewcube hover
  tint — because every hover/active/subtle/selection/text shade in `tokens.css` is now
  derived from one `--accent-hex` custom property via `color-mix()` rather than hardcoded
  per state. Scene colours (three.js materials can't read a CSS variable) get the same
  derivation in JavaScript via the new `useSceneAccentColor()` hook.
- **A third "Gray" skin** alongside Light and Dark: a neutral mid-grey workspace, the same
  alternative SolidWorks and Fusion 360 offer to their pure-dark theme.
- **Settings Export/Import** now round-trips the accent colour along with everything else
  (`settingsIO.ts` was missing the new field).

### Changed
- **The bottom-left XYZ legend is now an axis cross**, not three disconnected colour
  chips — three short arms radiating from one point with arrowheads and X/Y/Z labels,
  matching the convention other CAD tools use for this corner indicator. Purely a static
  legend; the existing `GizmoViewcube` in the opposite corner is still the one interactive,
  camera-following gizmo.
- **README rewritten** with badges, a feature table, an architecture diagram, a real
  screenshot (a mounting plate built from Sketch → Extrude → Hole Wizard → Fillet, shown in
  the Feature Manager tree), and a roadmap table — replacing the older prose-only version.

## 2026-07-31 — Full audit of Home, Sketch and Features: two real bugs found and fixed

A comprehensive pass clicking through every command on the Home, Sketch and Features ribbon
tabs (backed by ~250 Playwright checks across the full existing suite plus new coverage for
the 7 geometric relations that had never been driven through the UI before: Vertical,
Parallel, Perpendicular, Tangent, Coincident, Equal, Fix). Confirmed correctly wired and
working: every Document/Edit/Interchange/View command on Home, every sketch entity tool and
all 9 geometric relations and all 4 dimension tools and all 4 sketch tools on Sketch, and
every Add Material/Remove Material/Dress-up/Pattern/Mirror/Reference Geometry command on
Features. Confirmed correctly *disabled* (by design, not broken): Print, Export IGES, Sketch
Text, and Boundary — none of these have an implementation yet, and the ribbon greys them out
rather than failing at the point of use.

### Fixed
- **Equal and Fix were missing from the sketch panel's "Add Relation" section** —
  `SketchPanel.tsx`'s `CONSTRAINTS` list only had 7 of the 9 relations the ribbon and the
  constraint solver both fully support (`relation.equal`/`relation.fix` were already wired in
  `ribbonConfig.ts` and `commandRegistry.ts`, and `solveSketch` already handles both `equal`
  and `fix` kinds — solver.test.mjs was testing them directly, just never through this panel).
  Reachable only from the ribbon strip, not from the panel every other relation lives in — an
  inconsistency easy to miss since nothing was actually broken, just absent from where a user
  would look first. Both are now in the panel with the same click-to-apply behaviour as the
  rest.
- **A sketch click can land right after a tool switch and silently do nothing.** Root-caused
  what this whole session had been treating as generic "environmental" test flakiness
  (`"profile is closed" got "Open"`, recurring across many unrelated test runs): with
  `frameloop="demand"`, `SketchCanvas`'s invisible drawing-plane mesh can miss the very first
  click after a tool change if that click's pointerdown/up fire before the canvas has
  rendered a frame reflecting the new tool state — the click simply raycasts against stale
  internal state and nothing happens. Reproduced deterministically (0/5) with two rapid
  manager-panel tab switches immediately followed by a tight, zero-gap click; a real user
  clicking at a normal pace essentially never produces small enough a gap to hit it, which is
  why it read as random rather than a real bug. Mitigated (not fully closed — down to roughly
  1-in-5 in the tightest repro tried) by having `SketchCanvas` call `invalidate()` whenever
  the active tool changes, asking the demand-frameloop canvas for a fresh frame right at the
  moment the next click is about to matter, instead of waiting for the click itself to
  trigger one. A full fix would need a deeper look at r3f's event/render ordering under
  `frameloop="demand"`; noted here rather than chased further given how narrow the window is.

## 2026-07-31 — Fillet and Chamfer: pick specific edges instead of always "every edge"

### Added
- **Fillet and Chamfer gain an Edges section** in the Property Manager with a "Select Edges"
  toggle. With nothing picked they behave exactly as before (every edge of the body); with one
  or more edges picked, only those are rounded/beveled. Clicking a picked edge again removes
  it; "Clear Selection" resets to the all-edges default.
- **No true persistent edge naming** — this kernel rebuilds the solid from scratch on every
  change, so there is no topological edge id that survives a rebuild the way one would in a
  cached-history kernel. The stand-in: a picked click is stored as a world-space point
  (converted into the kernel's own un-rotated "solid space" — see `rebuild.ts`'s note on
  display rotation), and on every rebuild the edge nearest that point is re-found via
  replicad's `EdgeFinder.withinDistance(0.75, point)`. Documented honestly as an approximation
  that can occasionally latch onto the wrong edge if the body changes drastically between
  picks — a real limitation, not hidden behind a "smart selection" label.
- **Picking against a preview, not the already-rounded result.** A Fillet/Chamfer with the
  all-edges default rounds the whole body the instant it exists, so entering pick mode against
  its own output would mean clicking edges that already moved. `geometryStore.ts` gained a
  `previewMesh` + `rebuildPreview()`, which reruns the exact same `rebuildDocument()` with only
  the picking feature force-suppressed in a cloned feature list — no kernel changes needed.
  `SolidModel.tsx` swaps to that preview (edges drawn gold) whenever a feature is in pick mode.

### Fixed
- Passing `raycast={undefined}` as a JSX prop is not "leave it alone" — react-three-fiber still
  assigns `instance.raycast = undefined` as an own property, which shadows
  `LineSegments.prototype.raycast` (the real hit-testing implementation) on the prototype
  chain, silently breaking all raycasting against that object with no console error. This was
  already how the edge overlay disabled picking outside pick mode; picking mode needed the
  *real* prototype method back, so it's passed explicitly instead (`LineSegments.prototype.raycast`)
  rather than `undefined`.
- Clicking anywhere in the viewport that isn't exactly on an edge — a miss, or a click on a
  face — used to clear the current selection (`ReferencePlanes.tsx`'s `onPointerMissed`,
  existing "click empty space to deselect" behaviour), which during an edge-pick session
  silently cancelled picking altogether the instant the miss happened, since the Property
  Manager exits pick mode whenever the selected feature stops being the one being picked. Now
  skipped while a pick session is active.

### Fixed (test only, not the app)
- The fix above was first written subscribing to `edgePickModeFeatureId` via
  `useViewportStore()` inside `ReferencePlanes.tsx`. Confirmed via `git stash` A/B (deterministic
  across three separate fresh-server runs, not the environment's usual probabilistic sketch-click
  flake) that this extra render subscription — despite being a functional no-op whenever no pick
  session is active — shifted timing enough to break the sketch rectangle tool's click-to-close
  race. Switched to reading `useViewportStore.getState()` imperatively inside the handler
  instead, the same pattern `SolidModel.tsx`'s own `handleContextMenu` already uses and for the
  same reason: the value is only needed at the moment of a (rare) pointer-miss, not on every
  render.

## 2026-07-31 — Rib: a stiffening wall from a sketched line

### Added
- **Rib** now builds a real thin wall: the first non-construction line in the target sketch,
  thickened symmetrically by `thickness` on either side, then extruded to `depth`/
  `endCondition` the same way any other sketch-based feature is (reusing the existing
  Direction/Depth/Thickness property-panel fields — all already generic, no new UI needed).
  Always joins to the existing body; there is no Cut-Rib command to give it a choice.

### Scope, documented rather than silently assumed
A real Rib normally extends automatically until it meets the body's own faces — this app has
no face-picking UI yet to know where those are (the same gap blocking selective Fillet/
Chamfer edges), so the rib's reach is an explicit depth the user sets, same as any extrude.
Only a single straight segment is supported, not a connected chain of several (a zigzag rib) —
a real follow-up, not fundamentally different, just needing a multi-segment walk this doesn't
have yet.

## 2026-07-31 — Sweep along a curved path (spline), not just a straight one

### Added
- A Sweep/Cut-Sweep's path can now be a spline, not just a construction line — the path
  sketch's points are interpolated into a curve (`drawPointsInterpolation`) and embedded via
  the same true-world-coordinates approach the straight-line path already used, with the
  profile positioned perpendicular to the curve's start tangent (approximated as the
  direction from the path's first point to its second — exact for a straight path, a
  reasonable estimate for a curved one). This is what makes a sweep worth having as a
  distinct feature rather than just a fancier extrude: springs, handles, and pipes with
  bends are now genuinely reachable, not just straight tubes at an arbitrary angle.
- Unlike the straight-line path, the spline does not need to be a *construction* spline —
  `profileRegions()` never uses splines for a boss/cut profile boundary either way (its
  closed-loop walk only looks at line/arc edges), so there is no ordinary meaning for a
  spline to be "taken away from" the way a line could otherwise mean a real profile edge.

## 2026-07-31 — Sweep and Cut-Sweep: real 3D paths, correcting an earlier "deferred"

The previous entry deferred Sweep/Cut-Sweep, having concluded from a `Sketch.sweepSketch()`
attempt that produced a sweep seemingly always aligned to one fixed world axis regardless of
the path it was given — misdiagnosed as an architectural blocker. Re-examining it: the
diagnostic screenshots that led to that conclusion were all taken from an orbited camera angle
that, it turns out, foreshortens world X into something that reads as "vertical" at a glance;
comparing against the scene's own origin axis colours (and a straight default Front view)
showed the earlier attempt was probably already positioning things correctly, just impossible
to *tell* from the angle chosen to look at it. Rewritten regardless, on a lower-level API this
session had more confidence reasoning about precisely, and confirmed correct from multiple
camera angles and two independent path directions this time.

### Added
- **Sweep and Cut-Sweep** now build a real swept solid: `profileSketch`'s outer profile,
  extruded along the straight path defined by a second sketch's first construction line.
  Both sketches are embedded directly in true world coordinates (via `sketchToWorld`, the
  same conversion the sketch editor's own click handling uses) rather than the "build in one
  plane's local space, rotate the whole result for display afterward" shortcut every other
  sketch-based feature here relies on — a sweep whose path leaves the profile's own plane is
  the entire point of the feature (an extrude already covers "along the profile plane's own
  normal"), so this one constructs its own explicit `replicad.Plane` for the profile
  (perpendicular to the path at its start, the standard convention a pipe/sweep needs) and
  for the path itself, then calls replicad's lower-level `genericSweep(profileWire, spineWire)`
  directly instead of `Sketch.sweepSketch()`'s convenience wrapper.
- Selecting two sketches (Ctrl/Cmd-click, like Loft) before Swept Boss/Swept Cut uses that
  selection as profile + path in click order; with fewer than two selected it falls back to
  the two most recent sketches above the rollback bar, same convention as Loft.
- `sweep`/`cut-sweep` join `GEOMETRY_FEATURE_KINDS`.

### Scope, documented rather than silently assumed
The path is still just a straight line — a curved path (a construction spline) needs its own
wire-building code this doesn't have yet, the same kind of follow-up already noted for a
tapped hole's cosmetic-only thread. Rib and Boundary remain unimplemented: Rib needs genuine
face-picking (extending an open profile to a nearby face) this app has no UI for yet, and
Boundary is an advanced loft variant with tangency continuity between sections — a real
follow-up, not a subset of what Loft already does.

## 2026-07-31 — Fillet, Chamfer, Shell, Draft and Loft: five more PartDesign features get real geometry

An audit of the Features ribbon (prompted by "check every PartDesign function and revive each
one that isn't working yet") found nine commands that created a tree row and nothing else:
Fillet, Chamfer, Shell, Draft, Rib, Sweep, Cut-Sweep, Loft, and Boundary (which was not even
wired to a feature kind). This lands real geometry for five of the nine; the rest need either
genuine edge/face-picking UI (Rib) or a true 3D sweep path (Sweep/Cut-Sweep) — bigger,
separate changes tracked as follow-ups rather than shipped half-working.

### Added
- **Fillet and Chamfer** now round/bevel every edge of the current body by a constant radius/
  distance (`Shape3D.fillet(radius)` / `.chamfer(distance)` with no filter — replicad's own
  "a plain number applies to every edge" mode). Not edge-selective — there is no edge-picking
  UI yet — but a real, usable result for the common case of rounding or breaking every sharp
  edge on a part.
- **Shell and Draft** hollow the body or apply a taper to whichever face(s) point exactly
  along a chosen world axis (`FaceFinder.atAngleWith(direction, 0)`), reusing the same
  axis-as-stand-in-for-picking convention `FeatureParameters.axis` already carries for a
  pattern's direction or a reference axis's placement. For a simple extruded block this
  resolves to exactly the face a real pick would most often land on — the top of an open box,
  the underside of a moulded part — and the existing generic axis `<select>` in the property
  panel needed no new UI to expose it.
- **Loft** blends two or more sketches' outer profiles (`Sketch.loftWith()`). Selecting two or
  more sketch rows (Ctrl/Cmd-click, like any other multi-select here) before clicking Lofted
  Boss uses that selection; with fewer than two selected it falls back to the two most recent
  sketches above the rollback bar. Every sketch in a loft must currently be on the *same*
  plane — the profiles are spread out purely in that plane's local space, evenly along its
  normal over the feature's own `depth` parameter, rather than each profile keeping its own
  sketched position (see the scope note below for why).
- `hole` and `loft` join `GEOMETRY_FEATURE_KINDS`, so hide/show and the "body contributed
  geometry" bookkeeping the rest of the app already has treat them like any other real solid.

### Scope, documented rather than silently assumed
This app's sketches only live on one of the three default planes with no position offset yet
(the same limit `reference-plane`'s own "cannot be sketched on" note already flags), and the
kernel currently builds every sketch-based feature in that plane's own local space rather than
true world coordinates, with one shared *display* rotation applied at the very end. A real
loft normally blends profiles positioned on different, parallel, offset planes; this app's
loft instead spaces them out with a feature parameter, which is an honest, working stand-in
rather than the real thing, and is exactly why a loft here refuses sketches from different
planes rather than silently producing a wrong result. (Sweep and Cut-Sweep, which sounded like
they would hit the same wall even harder, turned out not to — see the entry above, which
corrects the original version of this note.)

### Fixed (test only, not the app)
- `dress-up.mjs`'s Fillet/Chamfer pixel-diff checks were timed to compare a "before" shot
  taken *before* an unrelated camera orbit against an "after" shot taken *after* one — passing
  for the wrong reason (the orbit alone changes pixels) rather than proving the dress-up
  operation did. Fixed by orbiting once to a stable camera angle before either shot.
- `property-panel.mjs`'s two off-axis orbits (guarding the Reverse-direction and Cut/
  Intersect geometry checks against the flat-projection trap noted in the previous entry)
  turned out to still be close enough to the degenerate view that unrelated changes elsewhere
  in the app — nothing to do with these checks — could tip the resulting camera angle back
  into it, intermittently zeroing out the very pixel delta the check exists to catch. Widened
  both orbit gestures to a clearly diagonal angle so the margin is no longer that thin.

## 2026-07-31 — Hole Wizard: real clearance and tapped holes from Autodesk's own reference data

The `hole` feature kind existed (the ribbon's Hole Wizard button created a tree row) but was
never in `GEOMETRY_FEATURE_KINDS` or handled by `kernel/rebuild.ts` — it built no geometry at
all, same "fake feature" status as the dress-up kinds. This makes it real, and sizes it from
the same reference spreadsheets Inventor's own Hole Wizard ships with (two `.xls` workbooks
supplied for this: a "Clearance Hole Spreadsheet" and a thread-data workbook), rather than
inventing hole sizes.

### Added
- **`data/holeStandards.ts`**: clearance shaft-diameter and tapped-hole tap-drill tables,
  extracted from the two source spreadsheets and converted to millimetres throughout.
  Clearance covers all six standards the spreadsheet has (ISO, DIN, ANSI Metric M, ANSI
  Unified, JIS, GOST), deduplicated to one row per nominal size — the source repeats the
  same shaft clearance once per fastener head style, and head geometry (counterbore/
  countersink) isn't modelled yet. Tapped covers three of the thread workbook's ~30 sheets
  (ISO Metric, ANSI Metric M, ANSI Unified restricted to UNC/UNF/UNEF), narrowed to a
  practical fastener range (roughly M1-M100 / #0-2in) — the other sheets (pipe threads,
  Acme/trapezoidal, wood- and self-tapping screws, JIS/DIN/GOST/BSP taps...) are the same
  shape of table and can be added the same way if a future hole needs them.
- **`data/holeResolution.ts`**: `resolveClearanceDiameter`, `resolveTapDrill`, and
  `groupTappedBySize` (which turns each standard's 80-270 pitch-variant rows into a
  Size → Designation two-step picker — the same shape Inventor's own dialog uses, and the
  only way that many rows stays usable in a plain `<select>`).
- **`kernel/rebuild.ts`**: a `hole` feature now builds real geometry — `buildHoleSolid` cuts
  one cylinder per point placed in the feature's sketch (reusing the existing `extrusionRange`
  blind/through-all logic extrude already uses), unioned together and always applied as a
  `cut`. One sketch can carry both a closed profile (for a boss/cut extrude) and standalone
  placement points (for a hole) at once, since `profileRegions()` only looks at line/arc/
  circle entities — a point in the same sketch doesn't affect the profile.
- **`PropertyManager.tsx`** "Hole Wizard" section: Simple (a plain radius, typed directly) /
  Clearance (Standard → Size → Fit) / Tapped (Standard → Size → Thread designation) hole
  types, each recomputing `radius` from the standard's table as soon as any of its inputs
  change — the resolved diameter/tap-drill and, for a tapped hole, the full thread callout
  (e.g. "M6x1 (6H)") are shown read-only underneath.
- `commandRegistry.ts`'s `feature.hole-wizard` now resolves a target sketch the same way
  `feature.extrude` etc. already do (selected sketch, falling back to the most recent one
  above the rollback bar) rather than creating a parentless tree row — the upfront dialog
  Inventor shows before placement is this app's Property Manager instead, opened by
  selecting the new feature after creation, consistent with every other feature here.
- `hole` joins `GEOMETRY_FEATURE_KINDS` and the pattern/mirror source list (`MODELLING_KINDS`
  in `commandRegistry.ts`), so a bolt circle of holes can be built with Circular Pattern the
  same as any other feature.

### Scope, documented rather than silently assumed
No real helical thread geometry is generated for a tapped hole — same as Inventor's own
default behaviour, a "tapped hole" here is a cylindrical bore at the tap-drill diameter with
a thread designation recorded for reference; modelling an actual thread would mean a helical
sweep per hole, a much larger kernel feature in its own right. Counterbore/countersink head
profiles (the "Head Dimensions" columns in the clearance spreadsheet) aren't modelled either
— every hole this pass produces is a plain cylindrical bore regardless of hole type.

## 2026-07-31 — Reference geometry (plane/axis/point/coordinate system) now has a 3D presence

The four Reference Geometry ribbon buttons (Plane, Axis, Point, Coordinate System) already
created tree rows — they were wired into `commandRegistry.ts` from the start — but none of
them had any kernel or viewport code referencing their feature kind by name, so creating one
did nothing visible at all. `reference.csys` in particular wasn't wired up to anything: the
ribbon button existed but had no handler, so clicking it did nothing whatsoever, not even a
tree row.

### Added
- **`UserReferenceGeometry.tsx`**: renders every non-suppressed `reference-plane`/`-axis`/
  `-point`/`-csys` feature above the rollback bar, selectable and right-clickable the same
  way the default Front/Top/Right planes already are (hover, select, hide/show via
  `hiddenFeatureIds`, the shared `FeatureContextMenu`). A reference plane is a translucent
  dashed-border square offset from a chosen default plane along its normal (distinct purple
  colour from the RGB default planes); a reference axis is a dashed line along a world axis
  in that axis's colour; a reference point is a small sphere offset along a world axis from
  the origin; a coordinate system is a small RGB triad — currently always at the origin,
  since there is no face/edge picking yet to place it anywhere else.
- **`reference-csys` feature kind**, closing the one Reference Geometry button that was
  previously not wired to anything.
- `commandRegistry.ts` gained dedicated handlers for the four reference commands
  (`addReferencePlane`/`Axis`/`Point`), using the same one-shot `window.prompt` pattern
  `sketch.offset`/`sketch.pattern` already use for a single number with no dedicated UI —
  a plane's offset distance, an axis's or point's world-axis direction. A reference plane's
  base plane is stored in `Feature.parents`, reusing the field that already means "features
  this one consumes," rather than adding a new parameter for it.

### Scope, documented rather than silently assumed
None of this feeds the kernel — these are visual and organisational only, same status as
before for anything that isn't a real solid. A reference plane specifically **cannot be
sketched on yet**: `planeBasis.ts` and `SketchScene.tsx` assume a sketch's plane passes
through the origin, and a reference plane offset away from its base plane does not — making
that work would mean threading a position offset through the sketch coordinate system, the
camera alignment, and the kernel's profile extraction, which is a separate, larger change.
Offsetting a reference plane from another *user-created* reference plane (chaining) is also
not supported yet, for the same reason dress-up features aren't: there is no viewport picking
UI to choose an arbitrary base plane, only the three defaults via the current selection.

### Fixed
- `UserReferenceGeometry.tsx` (this feature) initially subscribed to `documentStore`'s
  `selectBuiltFeatures` selector directly from a component, which returns a freshly sliced
  array on every call — handing `useSyncExternalStore` a "changed" snapshot on every render
  regardless of whether the document had actually changed, which is an infinite render loop
  (`Maximum update depth exceeded`) rather than a mere inefficiency. Fixed by subscribing to
  the raw `features` array and `rollbackIndex` and computing the filtered list with
  `useMemo`, the same trap `SolidModel.tsx`'s own comment on this selector already warns
  about — caught before shipping via the Playwright regression pass, not left in.

## 2026-07-30 — Application Options dialog, settings export/import

Against a reference screenshot of another CAD tool's own "Application Options" dialog:
the gear icon only opened a small dropdown with two settings, there was no way to save or
transfer preferences, and several already-implemented-but-unreachable knobs (a manual
theme override the CSS already fully supported, the sketch snap tolerance, the line-click
raycast tolerance) had no UI at all — they were hardcoded constants nobody could change.

### Added
- **`SettingsDialog.tsx`**: a real modal "Application Options" dialog (centred, backdrop,
  closes on Escape/backdrop click/×/Close) replacing the old gear dropdown, opened the
  same two ways as before (the gear icon, Tools ▸ Options). Tabbed like the reference
  dialog — **General** (theme, confirm-before-discard, Reset to Defaults), **Display**
  (projection, line pick tolerance), **Sketch** (snap tolerance, constraint glyphs),
  **File** (unit system) — but only with tabs that have real settings behind them; Sketch/
  Part/Assembly/Content Center/Hardware/Prompts/Drawing/Colors/Save from the reference
  tool either don't apply to what MaBuCAD has built yet or are folded into the tabs above
  (Prompts' one real setting lives in General, Colors' in the Theme control).
- **`settingsStore.ts`**: a new persisted (`localStorage`) store for preferences that don't
  belong to one document (`documentStore.unitSystem`, saved inside a `.mabucad` file) or
  to a ribbon-owned toggle (`viewportStore.projection`/`constraintsVisible`) — those stay
  where they are and the dialog reads/writes them directly.
  - **Theme** (System/Light/Dark) actually does something now: `tokens.css`'s
    `[data-theme]` override and `useIsDarkTheme.ts`'s detection of it already existed,
    nothing ever set the attribute. `App.tsx` applies it in a `useEffect`.
  - **Confirm before discarding unsaved changes**, gating the `window.confirm()` in
    `documentIO.ts`'s New/Open.
  - **Snap tolerance** and **line pick tolerance** replace what were hardcoded constants
    (`sketchStore.ts`'s old `SNAP_TOLERANCE`, `Viewport.tsx`'s raycaster `onCreated`
    threshold) — the latter now lives in a new `RaycasterTuning.tsx`, applied in a
    `useEffect` inside the r3f tree so a change while the app is running takes effect
    immediately rather than only at the next canvas creation.
- **`settingsIO.ts`**: Export Settings/Import Settings, reusing the same `saveBlob()`/
  `openFile()` native-dialog-or-browser-fallback helpers `documentIO.ts` already
  established for whole-document persistence — a `.mabucad-settings` file, separate from
  a `.mabucad` document, for backing up or carrying preferences to a different machine. An
  import merges over `DEFAULT_SETTINGS` rather than trusting the file outright, so a field
  added after an older export was made still gets a sane default instead of `undefined`.

## 2026-07-30 — Direction/Body property sections, Boolean operations, opaque menus

More feedback against a reference screenshot of another CAD tool's own Extrude dialog:
the property manager was a flat, unlabelled list of fields (no grouping like that tool's
own "Behavior"/"Output" sections), there was no way to choose how an extrude/revolve
combines with the existing body (join/cut/intersect were baked into the feature's *kind*,
picked once at creation and never changeable afterward), and the new dropdown/context
menus this session already added rendered partially see-through.

### Added
- **`PropertyManager.tsx` now groups related fields into labelled sections** — `Direction`
  (for extrude/cut-extrude: an icon row for Blind/Through All/Mid Plane/Up To Surface,
  replacing the old plain `<select>`, plus a Reverse Direction toggle) and `Body` (see
  below) — instead of a flat list, the same visual idea as the reference screenshot's own
  collapsible sections, though without the collapsing.
- **`FeatureParameters.operation`**: `"join" | "cut" | "intersect"`, now set on every
  extrude/cut-extrude/revolve/cut-revolve feature and shown as its own `Body` section
  with icon buttons (Join/Cut/Intersect, plus a disabled "New Body" — the kernel keeps one
  fused body per document, so there is nothing yet for a second body to be). Changing it
  after creation actually re-solves the boolean: `kernel/rebuild.ts` reads
  `feature.parameters.operation` through a new shared `applyOperation()` helper (falling
  back to the feature's own kind for a document saved before this field existed) instead
  of the previous hardcoded `isCut = kind === "cut-extrude" || ...` branch, and a pattern
  or mirror built from that feature now replays the same operation it does rather than a
  fixed join. `intersect` is a genuinely new capability — replicad's `Shape3D.intersect()`
  was already there, nothing before this exposed it.
- **Dropdown/context menus are fully opaque.** `ContextMenu.module.css`'s `.menu` and
  `MenuBar.module.css`'s `.dropdown` used `--bg-card`, the same translucent "glass" token
  the ribbon and manager panel use for their deliberate Mica look — appropriate for a
  large panel sitting over a mostly-static background, not for a small floating menu that
  can open over busy ribbon icons, tree rows, or 3D geometry and needs to stay legible
  regardless. Both now use `--bg-solid` (already an existing, fully opaque token) instead,
  with the now-pointless `backdrop-filter: blur()` removed alongside it.

## 2026-07-30 — Feature tree context menu, draggable rollback, per-feature visibility

Another round of real-world feedback: right-clicking the Feature Manager tree showed the
raw browser context menu (Back/Reload/Save As/Print/...) instead of anything the app
offers, Suppress had no reachable entry point that read as "working," the rollback bar
was purely decorative, and there was no way to hide one specific plane, the origin, or
the body — only every reference plane at once.

### Added
- **`FeatureContextMenu.tsx`** (renamed from `ViewportContextMenu.tsx` and mounted once
  at the app's top level in `AppShell.tsx`, not nested under the viewport) now opens from
  a right-click on a Feature Manager row as well as a plane or the solid in the 3D view —
  both openers already drove the same `documentStore.contextMenu`/`selectedFeatureIds`
  state, so this is one menu serving two openers rather than a second implementation.
  `FeatureRow.tsx` selects the row (if not already selected) and opens it exactly the way
  `ReferencePlanes.tsx`/`SolidModel.tsx` already did for the viewport.
- **`hooks/useDisableNativeContextMenu.ts`** suppresses the browser/WebView's own
  right-click menu everywhere except inside an editable field (where Cut/Copy/Paste is
  still useful) — a desktop CAD app never shows that menu; every right-click either opens
  one of this app's own menus or does nothing.
- **The rollback bar can be dragged.** Its grip (`FeatureTree.tsx`) takes a pointer down,
  tracks `pointermove` against each row's own measured position, and calls the store's
  already-existing `setRollbackIndex()` in real time — the toolbar's one-feature-at-a-time
  buttons (`rollBackOne`/`rollForwardOne`/`rollToEnd`) still work exactly as before, this
  is an additional way to get there, the same as SolidWorks offers both.
- **Per-feature visibility.** `viewportStore.ts`'s single `referenceGeometryVisible`
  boolean is now `hiddenFeatureIds: string[]` plus `toggleFeatureVisibility(id)`, so a
  plane, the origin, or (since the kernel still fuses every modelling feature into one
  mesh — there is no per-feature partial geometry to hide independently yet) any feature
  that contributed to the solid can be hidden on its own instead of only all reference
  geometry at once. Reachable from a new eye icon on every tree row (`FeatureRow.tsx`,
  including default reference geometry, which previously had no row actions at all) and
  from the ribbon's `Hide / Show`, which now toggles whatever is currently selected
  instead of a single global on/off.
- **Smart Dimension now covers a spline.** Selected alone, it infers `distance` between
  the spline's own first and last points — the chord between its endpoints, not the true
  integrated curve length, since there is no dimension kind (or a way to *solve* toward
  one — a target length has no unique relationship back to several control points) for
  actual arc length yet. Diameter (added last entry) and this both close gaps in
  `inferSmartDimension()` where the underlying dimension kind already existed but nothing
  could ever select it.

## 2026-07-30 — Interaction fixes: menus, Settings, Escape, click precision, dimension editing

A batch of real-world usability bugs found by actually using a build on Windows rather
than through Playwright — sketch geometry rendered correctly but was hard to *operate*.

### Fixed
- **The top menu bar did nothing.** `File`/`Edit`/`View`/`Insert`/`Tools`/`Window`/`Help`
  were static, unclickable text — leftover Step 1 chrome nothing since ever wired up — and
  the quick-access gear icon called a command (`app.settings`) that was never registered,
  so it silently did nothing too. `MenuBar.tsx` now opens a real dropdown per menu, each
  entry a thin pointer to the exact same `runCommand()`/`isCommandAvailable()` the ribbon
  already uses (so a menu item greys out exactly when its ribbon equivalent would), closing
  on an outside click, Escape, or choosing an item.
- **A line was hard to click — often needing several tries.** `SketchGeometry.tsx`'s lines
  had no raycasting tolerance beyond their own 1-3px drawn width (`Line2`'s raycast adds a
  `raycaster.params.Line2.threshold`, in screen pixels, on top of `material.linewidth` —
  see three's `LineSegments2.raycast`; it defaults to 0). `Viewport.tsx`'s `Canvas` now
  sets that threshold to 6px in `onCreated`, widening the invisible hit area the same way
  a sketch point already gets a larger invisible pick disc than its drawn dot. This is very
  likely also why Trim and the other click-a-line tools read as "not working" — the tool
  logic was correct, the geometry underneath it was just hard to actually hit.
- **A dimension's value couldn't be edited.** The field was a plain `<input type="number">`
  bound straight to the store: typing a comma (the ordinary decimal key on a Slovak
  keyboard) either produced `Number("55,74")` — `NaN`, committed with no validation — or
  was rejected outright by the input itself depending on locale. `SketchPanel.tsx` gained
  `DimensionValueField`, a plain text field that accepts either `,` or `.`, keeps local
  state so a value being typed one character at a time (`"55."`) doesn't get echoed back
  and stripped by the store on every keystroke, and only resyncs from the store when the
  value changed for some *other* reason (undo, a different field, a drag).
- **ESC did nothing.** There was no keyboard handling anywhere above individual context
  menus. New `hooks/useEscapeToDeselect.ts`, wired in `App.tsx`: Escape backs out of
  whatever's active one level at a time — a non-Select sketch tool first, falling back to
  clearing the sketch or feature selection — the same priority every CAD sketcher uses,
  skipped while a form field has focus so a field's own Escape handling isn't fought.

### Added
- **Smart Dimension can now dimension a circle's diameter**, not only its radius —
  `diameter` already had full residual/measure/display support (`residuals.ts`,
  `sketchModel.ts`'s `measure()`, `SketchDimensions.tsx`) but nothing ever created one.
  Selecting a circle's rim together with its own centre point (the two are only ever
  selected together deliberately, since a rim click and a centre click are different
  gestures) now infers diameter instead of radius; a circle alone is still radius, and an
  arc — conventionally always radius-dimensioned — is unaffected either way.
- **A Settings panel**, opened from the (now-functional) gear icon or Tools ▸ Options,
  holds Projection (Orthographic/Perspective) and the Unit system (MMGS/CGS/MKS/IPS) —
  both moved here from, respectively, a small toolbar floating over the viewport
  (`Viewport.tsx`, previously local `useState`, now `viewportStore.projection`) and a row
  of buttons in the status bar (`StatusBar.tsx`), decluttering both for options changed
  rarely. Functionally identical to before, just relocated and no longer competing for
  space with cursor/model-status readouts.
- **Constraint glyphs.** New `SketchConstraintGlyphs.tsx` draws a small icon at each
  geometric constraint's anchor (a line's midpoint for horizontal/vertical, the average of
  its points for coincident/fix, an entity's midpoint — reusing `arcMidpoint()` for an arc
  — for the two-entity kinds), toggled by a new `view.constraints` ribbon command
  (`viewportStore.constraintsVisible`) next to Hide/Show. Constraints existed and solved
  correctly since Step 4 but were completely invisible in the viewport; there was nothing
  to show or hide until now, which is what this ribbon slot actually asked for.

## 2026-07-30 — MSI build script

### Added
- **`scripts/build-msi.ps1`** wraps the `npm install` / `npm run typecheck` /
  `npm run tauri build` sequence README.md already documents into a single command,
  with `-SkipInstall`/`-SkipChecks` for a faster rebuild once dependencies and types are
  already known-good, `-Target msi|nsis|all` to build just one installer instead of both
  (omitting `--bundles` entirely for `all`, which falls back to `tauri.conf.json`'s own
  `bundle.targets` rather than duplicating that list here), and `-Open` to open the
  bundle output folder afterward. Resolves the repo root from the script's own location
  (`$PSScriptRoot`) rather than the caller's current directory, so it runs the same way
  regardless of where it's invoked from.

## 2026-07-30 — Sketch Trim

### Added
- **`Trim`** is a persistent tool (unlike `Offset`/`Mirror`/`Pattern`, which act once on a
  selection and return to `Select`): activate it, then click any line to cut it back to
  its nearest intersections on either side of the click — the same interaction every CAD
  sketcher's trim tool uses. A line with nothing crossing it has nowhere to trim back to,
  so a click anywhere on it deletes the whole entity, the same as trimming away a stray
  overshoot down to nothing.
- `sketchModel.ts` gained `trimLineAt()`: it parametrizes the clicked line as `t` in
  `[0, 1]`, collects every `t` where another entity actually crosses it (line-line via
  standard 2D segment intersection, line-circle/line-arc via the quadratic intersection
  of a parametrized line with a circle, an arc intersection additionally checked against
  its swept angle range via a new `isWithinArcSweep()` helper), sorts those into a list of
  cut points, and rebuilds every bracket except the one straddling the click as its own
  new line — reusing `ensurePoint()` at each cut the same way `offsetEntities()` already
  does, so a point shared with other geometry stays shared. Orphaned points, constraints,
  and dimensions are swept up afterward the same way `deleteSelection()` already does for
  a manually deleted entity.
- Only lines are trimmable themselves for now — circles, arcs, splines, and standalone
  points are not, though a line can still be trimmed back to where it crosses any of
  them. A closed curve needs different bookkeeping (cutting an interior arc out of it
  rather than shortening an end), which is a natural follow-up this doesn't foreclose —
  the same kind of scope cut `offsetEntities()` already documents for entities with no
  single well-defined offset direction.
- `sketchStore.ts` gained `trimAt(entityId, position)`. `SketchGeometry.tsx` wires a
  line's click handler to it while the Trim tool is active, converting the click's world
  point to sketch space with the same `worldToSketch()` helper `SketchCanvas.tsx` already
  uses for drawing.

## 2026-07-30 — Sketch Pattern

### Added
- **`Pattern`** repeats the selected entities in a linear or circular array, driven by a
  chain of `window.prompt()`s (type, then count, then linear spacing or circular sweep
  angle) — the same reasoning as `Offset`'s single prompt, extended to a few numbers
  instead of one, since there's still no inline numeric-entry UI for a one-shot tool like
  this. `count` includes the original, matching the convention `buildLinearPatternSolid`/
  `buildCircularPatternSolid` in `kernel/rebuild.ts` already use for the feature-level
  pattern, so the same word means the same thing at both the sketch and feature level.
- `sketchModel.ts` gained `patternEntities()`: a linear instance translates every point by
  `(dx, dy) * index`, a circular instance rotates every point about the sketch origin by
  `(angle / count) * index` degrees. A circular pattern has no picked centre yet — the app
  has no reference-point picking UI, the same gap `FeatureParameters.axis`'s doc comment
  already notes for the feature-level pattern — so it always rotates about the origin.
  Unlike `mirrorEntities()`, a rotation or translation preserves orientation, so an arc's
  start/end are copied in place rather than swapped, and it gets fresh `arc-radius`
  constraints on each copy exactly as `mirrorEntities()`/`offsetEntities()` already do.
- Like Mirror and Offset, every instance is an independent one-shot copy, not a live
  parametric array: editing the original afterward does not move the copies. A true
  parametric pattern relation is a larger feature nothing here forecloses adding later.
- `sketchStore.ts` gained `patternSelection(options)`, accepting the same `PatternOptions`
  union `patternEntities()` takes.

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
