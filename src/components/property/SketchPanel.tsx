import {
  AlignHorizontalJustifyCenter,
  Anchor,
  Axis3D,
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

import { DimensionValueField } from "@/components/shared/DimensionValueField";
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
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "arc", label: "Arc", icon: CircleDashed },
  { id: "spline", label: "Spline", icon: Spline },
  { id: "construction-line", label: "Construction", icon: Route },
  { id: "point", label: "Point", icon: CircleDot },
  { id: "trim", label: "Trim", icon: Scissors },
];

/**
 * The Line button cycles through three line variants on repeated clicks rather than each
 * getting its own button — Construction still has its own dedicated entry in `TOOLS` above
 * for direct access, this is just a second, faster path to it (and the only path to Axis
 * Line, which doesn't get a dedicated button of its own to avoid crowding the grid further).
 */
const LINE_CYCLE = ["line", "construction-line", "axis-line"] as const satisfies readonly SketchTool[];
const LINE_CYCLE_META: Record<(typeof LINE_CYCLE)[number], { label: string; icon: LucideIcon }> = {
  line: { label: "Line", icon: Minus },
  "construction-line": { label: "Construction", icon: Route },
  "axis-line": { label: "Axis Line", icon: Axis3D },
};

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
function isLineCycleTool(tool: SketchTool): tool is (typeof LINE_CYCLE)[number] {
  return (LINE_CYCLE as readonly SketchTool[]).includes(tool);
}

export function SketchPanel() {
  const sketch = useSketchStore(selectActiveSketch);
  const tool = useSketchStore((state) => state.tool);
  const setTool = useSketchStore((state) => state.setTool);
  const selection = useSketchStore((state) => state.selection);
  const lineCycleMeta = LINE_CYCLE_META[isLineCycleTool(tool) ? tool : "line"];
  const LineIcon = lineCycleMeta.icon;
  const cycleLineTool = () => {
    const index = isLineCycleTool(tool) ? LINE_CYCLE.indexOf(tool) : -1;
    setTool(LINE_CYCLE[(index + 1) % LINE_CYCLE.length]);
  };
  const diagnostics = useSketchStore((state) => state.diagnostics);
  const isClosed = useSketchStore(selectProfileClosed);

  const applyConstraint = useSketchStore((state) => state.applyConstraint);
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
            <button
              type="button"
              className={styles.toolButton}
              aria-pressed={isLineCycleTool(tool)}
              title="Click to cycle: Line -> Construction -> Axis Line"
              onClick={cycleLineTool}
            >
              <LineIcon size={14} strokeWidth={1.75} />
              {lineCycleMeta.label}
            </button>
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
              aria-pressed={tool === "smart-dimension"}
              title="Click elements in the viewport to dimension them — stays active until you pick another tool"
              onClick={() => setTool(tool === "smart-dimension" ? "select" : "smart-dimension")}
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

