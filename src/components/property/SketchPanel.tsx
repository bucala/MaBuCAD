import { useEffect, useState } from "react";
import {
  AlignHorizontalJustifyCenter,
  Anchor,
  Circle,
  CircleDashed,
  CircleDot,
  Columns3,
  Diameter,
  Grid2x2,
  Grid3x3,
  Lock,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  Route,
  Ruler,
  Scissors,
  Spline,
  Square,
  Tangent,
  type LucideIcon,
} from "lucide-react";

import type { GeometricConstraintKind } from "@/sketch/types";
import {
  selectActiveSketch,
  selectProfileClosed,
  useSketchStore,
  type SketchTool,
} from "@/state/sketchStore";

import styles from "./SketchPanel.module.css";

const TOOLS: { id: SketchTool; label: string; icon: LucideIcon }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "line", label: "Line", icon: Minus },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "arc", label: "Arc", icon: CircleDashed },
  { id: "spline", label: "Spline", icon: Spline },
  { id: "construction-line", label: "Construction", icon: Route },
  { id: "point", label: "Point", icon: CircleDot },
  { id: "trim", label: "Trim", icon: Scissors },
];

const CONSTRAINTS: { kind: GeometricConstraintKind; label: string; icon: LucideIcon; hint: string }[] = [
  { kind: "horizontal", label: "Horizontal", icon: MoveHorizontal, hint: "Select one or more lines" },
  { kind: "vertical", label: "Vertical", icon: MoveVertical, hint: "Select one or more lines" },
  { kind: "parallel", label: "Parallel", icon: Columns3, hint: "Select two lines" },
  { kind: "perpendicular", label: "Perpendicular", icon: Grid2x2, hint: "Select two lines" },
  { kind: "tangent", label: "Tangent", icon: Tangent, hint: "Select a line and a circle" },
  { kind: "concentric", label: "Concentric", icon: Diameter, hint: "Select two circles" },
  { kind: "coincident", label: "Coincident", icon: Anchor, hint: "Select two points" },
  { kind: "equal", label: "Equal", icon: AlignHorizontalJustifyCenter, hint: "Select two lines, or two circles/arcs" },
  { kind: "fix", label: "Fix", icon: Lock, hint: "Select a point to pin" },
];

/**
 * Property manager contents while a sketch is open: tools, constraints, dimensioning and
 * the list of driving dimensions.
 */
export function SketchPanel() {
  const sketch = useSketchStore(selectActiveSketch);
  const tool = useSketchStore((state) => state.tool);
  const setTool = useSketchStore((state) => state.setTool);
  const selection = useSketchStore((state) => state.selection);
  const diagnostics = useSketchStore((state) => state.diagnostics);
  const isClosed = useSketchStore(selectProfileClosed);

  const applyConstraint = useSketchStore((state) => state.applyConstraint);
  const applySmartDimension = useSketchStore((state) => state.applySmartDimension);
  const applyOrdinateDimension = useSketchStore((state) => state.applyOrdinateDimension);
  const setDimensionValue = useSketchStore((state) => state.setDimensionValue);
  const deleteDimension = useSketchStore((state) => state.deleteDimension);
  const exitSketch = useSketchStore((state) => state.exitSketch);
  const deleteSelection = useSketchStore((state) => state.deleteSelection);

  if (!sketch) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Sketch</h2>
        <button type="button" className={styles.exitButton} onClick={exitSketch}>
          Exit Sketch
        </button>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Tools</h3>
          <div className={styles.toolGrid}>
            {TOOLS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={styles.toolButton}
                aria-pressed={tool === id}
                title={label}
                onClick={() => setTool(id)}
              >
                <Icon size={14} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Add Relation</h3>
          <div className={styles.toolGrid}>
            {CONSTRAINTS.map(({ kind, label, icon: Icon, hint }) => (
              <button
                key={kind}
                type="button"
                className={styles.toolButton}
                title={hint}
                disabled={selection.length === 0}
                onClick={() => applyConstraint(kind)}
              >
                <Icon size={14} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
          <p className={styles.hint}>
            {selection.length === 0
              ? "Select geometry in the graphics area to add a relation."
              : `${selection.length} selected`}
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Dimensions</h3>
          <div className={styles.toolGrid}>
            <button
              type="button"
              className={styles.toolButton}
              title="Infer a length, radius or angle from the selection"
              disabled={selection.length === 0}
              onClick={applySmartDimension}
            >
              <Ruler size={14} strokeWidth={1.75} />
              Smart
            </button>
            <button
              type="button"
              className={styles.toolButton}
              title="Ordinate X and Y from the sketch origin"
              disabled={selection.length === 0}
              onClick={() => applyOrdinateDimension("both")}
            >
              <Grid3x3 size={14} strokeWidth={1.75} />
              Ordinate
            </button>
            <button
              type="button"
              className={styles.toolButton}
              title="Ordinate along X from the sketch origin"
              disabled={selection.length === 0}
              onClick={() => applyOrdinateDimension("x")}
            >
              <MoveHorizontal size={14} strokeWidth={1.75} />
              Ord. X
            </button>
            <button
              type="button"
              className={styles.toolButton}
              title="Ordinate along Y from the sketch origin"
              disabled={selection.length === 0}
              onClick={() => applyOrdinateDimension("y")}
            >
              <MoveVertical size={14} strokeWidth={1.75} />
              Ord. Y
            </button>
          </div>

          {sketch.dimensions.length > 0 && (
            <ul className={styles.dimensionList}>
              {sketch.dimensions.map((dimension) => (
                <li key={dimension.id} className={styles.dimensionRow}>
                  <span className={styles.dimensionKind}>{DIMENSION_LABEL[dimension.kind]}</span>
                  <DimensionValueField
                    dimensionId={dimension.id}
                    value={dimension.value}
                    label={`${DIMENSION_LABEL[dimension.kind]} value`}
                    onCommit={setDimensionValue}
                  />
                  <button
                    type="button"
                    className={styles.dimensionDelete}
                    aria-label="Delete dimension"
                    onClick={() => deleteDimension(dimension.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Status</h3>
          <dl className={styles.stats}>
            <dt>Degrees of freedom</dt>
            <dd data-testid="sketch-dof">{diagnostics.dof}</dd>
            <dt>Entities</dt>
            <dd data-testid="sketch-entity-count">{sketch.entities.length}</dd>
            <dt>Relations</dt>
            <dd>{sketch.constraints.length}</dd>
            <dt>Profile</dt>
            <dd data-testid="profile-closed">{isClosed ? "Closed" : "Open"}</dd>
          </dl>

          {selection.length > 0 && (
            <button type="button" className={styles.deleteButton} onClick={deleteSelection}>
              Delete selection
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

const DIMENSION_LABEL: Record<string, string> = {
  distance: "Length",
  "horizontal-distance": "Horizontal",
  "vertical-distance": "Vertical",
  radius: "Radius",
  diameter: "Diameter",
  angle: "Angle",
  "ordinate-x": "Ordinate X",
  "ordinate-y": "Ordinate Y",
};

/** Accepts either "." or "," as the decimal separator — a plain `Number()` call rejects
 * a comma outright, and a comma is the ordinary decimal key on most non-US keyboard
 * layouts (Slovak included), which made this field impossible to type into at all. */
function parseLocaleNumber(text: string): number {
  return Number(text.trim().replace(",", "."));
}

/**
 * A driving dimension's editable value.
 *
 * Not a plain `<input type="number">` bound straight to the store for two reasons: that
 * type rejects a typed comma outright on some locales, and even where it doesn't, binding
 * `value` straight to the store echoes the parsed number back on every keystroke — typing
 * "55." only for the trailing dot to vanish immediately (re-rendered from the number 55)
 * makes it impossible to ever type a fractional value one character at a time. Local text
 * state keeps exactly what was typed on screen; it only snaps back to the store's value
 * when that value changed for some other reason (undo, another field, a drag) — detected
 * by comparing the parse of the current text against the incoming value rather than a
 * blur/focus flag, so a programmatic `.fill()` (no real focus event) still commits.
 */
function DimensionValueField({
  dimensionId,
  value,
  label,
  onCommit,
}: {
  dimensionId: string;
  value: number;
  label: string;
  onCommit: (dimensionId: string, value: number) => void;
}) {
  const [text, setText] = useState(() => String(value));

  useEffect(() => {
    if (parseLocaleNumber(text) !== value) setText(String(value));
    // Only react to the store's value changing — re-running this because `text` itself
    // changed would fight every keystroke instead of only resyncing external updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className={styles.dimensionInput}
      type="text"
      inputMode="decimal"
      aria-label={label}
      data-dimension-input={dimensionId}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const parsed = parseLocaleNumber(raw);
        if (Number.isFinite(parsed)) onCommit(dimensionId, parsed);
      }}
    />
  );
}
