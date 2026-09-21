import { useState } from "react";
import {
  AlignHorizontalJustifyCenter,
  Anchor,
  Axis3D,
  Circle,
  CircleDashed,
  CircleDot,
  Columns3,
  CopyPlus,
  Diameter,
  FlipHorizontal2,
  GitCommitHorizontal,
  Grid2x2,
  Grid3x3,
  LayoutGrid,
  Lock,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  Radius,
  Route,
  Ruler,
  Scissors,
  Spline,
  Square,
  Tangent,
  type LucideIcon,
} from "lucide-react";

import { DimensionValueField, parseLocaleNumber } from "@/components/shared/DimensionValueField";
import { fillTemplate, useTranslation } from "@/i18n/useTranslation";
import type { GeometricConstraintKind } from "@/sketch/types";
import type { PatternOptions } from "@/sketch/sketchModel";
import { useGeometryStore } from "@/state/geometryStore";
import {
  selectActiveSketch,
  selectProfileClosed,
  useSketchStore,
  type SketchTool,
} from "@/state/sketchStore";

import styles from "./SketchPanel.module.css";

// Tool and relation labels reuse the ribbon command keys so the dock and the ribbon can
// never drift apart terminologically — the panel only invents keys for its own chrome.
const TOOLS: { id: SketchTool; key: string; label: string; icon: LucideIcon }[] = [
  { id: "select", key: "sketch.select", label: "Select", icon: MousePointer2 },
  { id: "rectangle", key: "sketch.rectangle", label: "Rectangle", icon: Square },
  { id: "circle", key: "sketch.circle", label: "Circle", icon: Circle },
  { id: "arc", key: "sketch.arc", label: "Arc", icon: CircleDashed },
  { id: "spline", key: "sketch.spline", label: "Spline", icon: Spline },
  { id: "construction-line", key: "sketch.construction", label: "Construction", icon: Route },
  { id: "point", key: "sketch.point", label: "Point", icon: CircleDot },
  { id: "trim", key: "sketch.trim", label: "Trim", icon: Scissors },
  { id: "fillet", key: "feature.fillet", label: "Fillet", icon: Radius },
];

/**
 * The Line button cycles through three line variants on repeated clicks rather than each
 * getting its own button — Construction still has its own dedicated entry in `TOOLS` above
 * for direct access, this is just a second, faster path to it (and the only path to Axis
 * Line, which doesn't get a dedicated button of its own to avoid crowding the grid further).
 */
const LINE_CYCLE = ["line", "construction-line", "axis-line"] as const satisfies readonly SketchTool[];
const LINE_CYCLE_META: Record<(typeof LINE_CYCLE)[number], { key: string; label: string; icon: LucideIcon }> = {
  line: { key: "sketch.line", label: "Line", icon: Minus },
  "construction-line": { key: "sketch.construction", label: "Construction", icon: Route },
  "axis-line": { key: "sketchPanel.axisLine", label: "Axis Line", icon: Axis3D },
};

const CONSTRAINTS: { kind: GeometricConstraintKind; label: string; icon: LucideIcon; hint: string }[] = [
  { kind: "horizontal", label: "Horizontal", icon: MoveHorizontal, hint: "Select one or more lines" },
  { kind: "vertical", label: "Vertical", icon: MoveVertical, hint: "Select one or more lines" },
  { kind: "parallel", label: "Parallel", icon: Columns3, hint: "Select two lines" },
  { kind: "perpendicular", label: "Perpendicular", icon: Grid2x2, hint: "Select two lines" },
  { kind: "colinear", label: "Colinear", icon: GitCommitHorizontal, hint: "Select two lines" },
  { kind: "tangent", label: "Tangent", icon: Tangent, hint: "Select a line and a circle or arc" },
  { kind: "concentric", label: "Concentric", icon: Diameter, hint: "Select two circles" },
  {
    kind: "coincident",
    label: "Coincident",
    icon: Anchor,
    hint: "Select two points, or a point and a line/circle/spline",
  },
  { kind: "equal", label: "Equal", icon: AlignHorizontalJustifyCenter, hint: "Select two lines, or two circles/arcs" },
  {
    kind: "fix",
    label: "Fix",
    icon: Lock,
    hint: "Select a point to pin it, or a line/circle/arc to pin its position and size (endpoints can still slide along it)",
  },
];

/**
 * Property manager contents while a sketch is open: tools, constraints, dimensioning and
 * the list of dimensions — driving ones editable, driven (reference) ones read-only.
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
  const { t } = useTranslation();

  const filletRadius = useSketchStore((state) => state.filletRadius);
  const setFilletRadius = useSketchStore((state) => state.setFilletRadius);
  const pendingFilletLineId = useSketchStore((state) => state.pendingFilletLineId);
  const [filletRadiusText, setFilletRadiusText] = useState(() => String(filletRadius));

  const armConstraint = useSketchStore((state) => state.armConstraint);
  const pendingConstraintKind = useSketchStore((state) => state.pendingConstraintKind);
  const applyOrdinateDimension = useSketchStore((state) => state.applyOrdinateDimension);
  const setDimensionValue = useSketchStore((state) => state.setDimensionValue);
  const deleteDimension = useSketchStore((state) => state.deleteDimension);
  const exitSketch = useSketchStore((state) => state.exitSketch);
  const deleteSelection = useSketchStore((state) => state.deleteSelection);

  const mirrorSelection = useSketchStore((state) => state.mirrorSelection);
  const offsetSelection = useSketchStore((state) => state.offsetSelection);
  const patternSelection = useSketchStore((state) => state.patternSelection);

  const [offsetText, setOffsetText] = useState("5");
  const [patternMode, setPatternMode] = useState<PatternOptions["mode"]>("linear");
  const [patternCountText, setPatternCountText] = useState("3");
  const [patternDxText, setPatternDxText] = useState("10");
  const [patternDyText, setPatternDyText] = useState("0");
  const [patternAngleText, setPatternAngleText] = useState("90");

  const handleMirror = () => {
    if (!mirrorSelection()) {
      useGeometryStore.getState().showToast(t("sketchPanel.mirrorToast", "Select the entities to mirror plus one construction line to use as the axis."), 3500);
    }
  };

  const handleOffset = () => {
    const distance = parseLocaleNumber(offsetText);
    if (!Number.isFinite(distance) || distance === 0 || !offsetSelection(distance)) {
      useGeometryStore.getState().showToast(t("sketchPanel.offsetToast", "Select one or more lines, circles or arcs to offset first."), 3500);
    }
  };

  const handlePattern = () => {
    const count = parseLocaleNumber(patternCountText);
    const options: PatternOptions =
      patternMode === "linear"
        ? { mode: "linear", count, dx: parseLocaleNumber(patternDxText), dy: parseLocaleNumber(patternDyText) }
        : { mode: "circular", count, angleDegrees: parseLocaleNumber(patternAngleText) };
    if (!patternSelection(options)) {
      useGeometryStore.getState().showToast(t("sketchPanel.patternToast", "Select one or more entities to pattern first."), 3500);
    }
  };

  if (!sketch) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t("sketch", "Sketch")}</h2>
        <button type="button" className={styles.exitButton} onClick={exitSketch}>
          {t("sketch.exit", "Exit Sketch")}
        </button>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("sketchPanel.tools", "Tools")}</h3>
          <div className={styles.toolGrid}>
            <button
              type="button"
              className={styles.toolButton}
              aria-pressed={isLineCycleTool(tool)}
              title={t("sketchPanel.lineCycle", "Click to cycle: Line -> Construction -> Axis Line")}
              onClick={cycleLineTool}
            >
              <LineIcon size={14} strokeWidth={1.75} />
              {t(lineCycleMeta.key, lineCycleMeta.label)}
            </button>
            {TOOLS.map(({ id, key, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={styles.toolButton}
                aria-pressed={tool === id}
                title={t(key, label)}
                onClick={() => setTool(id)}
              >
                <Icon size={14} strokeWidth={1.75} />
                {t(key, label)}
              </button>
            ))}
          </div>
          {tool === "fillet" && (
            <>
              <div className={styles.modifyRow}>
                <span className={styles.modifyLabel}>
                  <Radius size={14} strokeWidth={1.75} />
                  {t("sketchPanel.radius", "Radius")}
                </span>
                <input
                  className={styles.modifyInput}
                  type="text"
                  inputMode="decimal"
                  aria-label={t("sketchPanel.filletRadiusAria", "Fillet radius")}
                  value={filletRadiusText}
                  onChange={(event) => {
                    const text = event.target.value;
                    setFilletRadiusText(text);
                    const parsed = parseLocaleNumber(text);
                    if (Number.isFinite(parsed) && parsed > 0) setFilletRadius(parsed);
                  }}
                />
              </div>
              <p className={styles.hint}>
                {pendingFilletLineId
                  ? t("sketchPanel.filletPending", "Click the second line to complete the corner.")
                  : t("sketchPanel.filletIdle", "Click two lines that share a corner to round it.")}
              </p>
            </>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("sketchPanel.addRelation", "Add Relation")}</h3>
          <div className={styles.toolGrid}>
            {CONSTRAINTS.map(({ kind, label, icon: Icon, hint }) => (
              <button
                key={kind}
                type="button"
                className={styles.toolButton}
                title={t(`relation.hint.${kind}`, hint)}
                aria-pressed={pendingConstraintKind === kind}
                onClick={() => armConstraint(kind)}
              >
                <Icon size={14} strokeWidth={1.75} />
                {t(`relation.${kind}`, label)}
              </button>
            ))}
          </div>
          <p className={styles.hint}>
            {pendingConstraintKind
              ? t("sketchPanel.pendingHint", "Click the elements it applies to in the graphics area.")
              : selection.length === 0
                ? t("sketchPanel.selectFirstHint", "Select geometry first, or click a relation above, then pick its elements.")
                : fillTemplate(t("sketchPanel.selectedCount", "{{count}} selected"), { count: selection.length })}
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("sketchPanel.modify", "Modify")}</h3>
          <div className={styles.toolGrid}>
            <button
              type="button"
              className={styles.toolButton}
              title={t(
                "sketchPanel.mirrorHint",
                "Select the entities to mirror plus one construction line as the axis, then click Mirror",
              )}
              onClick={handleMirror}
            >
              <FlipHorizontal2 size={14} strokeWidth={1.75} />
              {t("sketch.mirror", "Mirror")}
            </button>
          </div>

          <div className={styles.modifyRow}>
            <span className={styles.modifyLabel}>
              <CopyPlus size={14} strokeWidth={1.75} />
              {t("sketchPanel.offset", "Offset")}
            </span>
            <input
              className={styles.modifyInput}
              type="text"
              inputMode="decimal"
              aria-label={t("sketchPanel.offsetDistanceAria", "Offset distance")}
              value={offsetText}
              onChange={(event) => setOffsetText(event.target.value)}
            />
            <button type="button" className={styles.modifyApply} onClick={handleOffset}>
              {t("sketchPanel.apply", "Apply")}
            </button>
          </div>

          <div className={styles.modifyGroup}>
            <span className={styles.modifyLabel}>
              <LayoutGrid size={14} strokeWidth={1.75} />
              {t("sketchPanel.pattern", "Pattern")}
            </span>
            <div className={styles.toolGrid}>
              <button
                type="button"
                className={styles.toolButton}
                aria-pressed={patternMode === "linear"}
                onClick={() => setPatternMode("linear")}
              >
                {t("sketchPanel.linear", "Linear")}
              </button>
              <button
                type="button"
                className={styles.toolButton}
                aria-pressed={patternMode === "circular"}
                onClick={() => setPatternMode("circular")}
              >
                {t("sketchPanel.circular", "Circular")}
              </button>
            </div>
            <div className={styles.modifyRow}>
              <span className={styles.modifyLabel}>{t("sketchPanel.count", "Count")}</span>
              <input
                className={styles.modifyInput}
                type="text"
                inputMode="numeric"
                aria-label={t("sketchPanel.countAria", "Pattern instance count")}
                value={patternCountText}
                onChange={(event) => setPatternCountText(event.target.value)}
              />
            </div>
            {patternMode === "linear" ? (
              <>
                <div className={styles.modifyRow}>
                  <span className={styles.modifyLabel}>{t("sketchPanel.xSpacing", "X spacing")}</span>
                  <input
                    className={styles.modifyInput}
                    type="text"
                    inputMode="decimal"
                    aria-label={t("sketchPanel.xSpacingAria", "Pattern X spacing")}
                    value={patternDxText}
                    onChange={(event) => setPatternDxText(event.target.value)}
                  />
                </div>
                <div className={styles.modifyRow}>
                  <span className={styles.modifyLabel}>{t("sketchPanel.ySpacing", "Y spacing")}</span>
                  <input
                    className={styles.modifyInput}
                    type="text"
                    inputMode="decimal"
                    aria-label={t("sketchPanel.ySpacingAria", "Pattern Y spacing")}
                    value={patternDyText}
                    onChange={(event) => setPatternDyText(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className={styles.modifyRow}>
                <span className={styles.modifyLabel}>{t("sketchPanel.angle", "Angle")}</span>
                <input
                  className={styles.modifyInput}
                  type="text"
                  inputMode="decimal"
                  aria-label={t("sketchPanel.angleAria", "Pattern angle")}
                  value={patternAngleText}
                  onChange={(event) => setPatternAngleText(event.target.value)}
                />
              </div>
            )}
            <button type="button" className={styles.modifyApplyFull} onClick={handlePattern}>
              {t("sketchPanel.applyPattern", "Apply Pattern")}
            </button>
          </div>

          <p className={styles.hint}>
            {t(
              "sketchPanel.modifyHint",
              "Mirror needs a construction line selected as the axis, alongside the entities to mirror. Offset and Pattern act on whatever's currently selected — a circular pattern always rotates about the sketch origin.",
            )}
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("sketchPanel.dimensions", "Dimensions")}</h3>
          <div className={styles.toolGrid}>
            <button
              type="button"
              className={styles.toolButton}
              aria-pressed={tool === "smart-dimension"}
              title={t(
                "sketchPanel.smartHint",
                "Click elements in the viewport to dimension them — stays active until you pick another tool",
              )}
              onClick={() => setTool(tool === "smart-dimension" ? "select" : "smart-dimension")}
            >
              <Ruler size={14} strokeWidth={1.75} />
              {t("sketchPanel.smart", "Smart")}
            </button>
            <button
              type="button"
              className={styles.toolButton}
              title={t("sketchPanel.ordinateHint", "Ordinate X and Y from the sketch origin")}
              disabled={selection.length === 0}
              onClick={() => applyOrdinateDimension("both")}
            >
              <Grid3x3 size={14} strokeWidth={1.75} />
              {t("sketchPanel.ordinate", "Ordinate")}
            </button>
            <button
              type="button"
              className={styles.toolButton}
              title={t("sketchPanel.ordinateXHint", "Ordinate along X from the sketch origin")}
              disabled={selection.length === 0}
              onClick={() => applyOrdinateDimension("x")}
            >
              <MoveHorizontal size={14} strokeWidth={1.75} />
              {t("sketchPanel.ordinateX", "Ord. X")}
            </button>
            <button
              type="button"
              className={styles.toolButton}
              title={t("sketchPanel.ordinateYHint", "Ordinate along Y from the sketch origin")}
              disabled={selection.length === 0}
              onClick={() => applyOrdinateDimension("y")}
            >
              <MoveVertical size={14} strokeWidth={1.75} />
              {t("sketchPanel.ordinateY", "Ord. Y")}
            </button>
          </div>

          {sketch.dimensions.length > 0 && (
            <ul className={styles.dimensionList}>
              {sketch.dimensions.map((dimension) => (
                <li key={dimension.id} className={styles.dimensionRow}>
                  <span className={styles.dimensionKind}>
                    {t(`sketchPanel.dimensionLabel.${dimension.kind}`, DIMENSION_LABEL[dimension.kind])}
                  </span>
                  {dimension.driven ? (
                    // A driven dimension measures rather than constrains — its value is
                    // the solve's output, so the row shows it read-only and
                    // parenthesised (the same convention the viewport label uses)
                    // instead of an editable field whose every edit would be silently
                    // overwritten by the next solve's refresh.
                    <span className={styles.dimensionDrivenValue}>({dimension.value.toFixed(2)})</span>
                  ) : (
                    <DimensionValueField
                      dimensionId={dimension.id}
                      value={dimension.value}
                      label={`${t(`sketchPanel.dimensionLabel.${dimension.kind}`, DIMENSION_LABEL[dimension.kind])} value`}
                      onCommit={setDimensionValue}
                    />
                  )}
                  <button
                    type="button"
                    className={styles.dimensionDelete}
                    aria-label={t("sketchPanel.deleteDimensionAria", "Delete dimension")}
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
          <h3 className={styles.sectionTitle}>{t("sketchPanel.status", "Status")}</h3>
          <dl className={styles.stats}>
            <dt>{t("sketchPanel.dof", "Degrees of freedom")}</dt>
            <dd data-testid="sketch-dof">{diagnostics.dof}</dd>
            <dt>{t("sketchPanel.entities", "Entities")}</dt>
            <dd data-testid="sketch-entity-count">{sketch.entities.length}</dd>
            <dt>{t("sketchPanel.relations", "Relations")}</dt>
            <dd>{sketch.constraints.length}</dd>
            <dt>{t("sketchPanel.profile", "Profile")}</dt>
            <dd data-testid="profile-closed">
              {isClosed
                ? t("sketchPanel.profileClosed", "Closed")
                : t("sketchPanel.profileOpen", "Open")}
            </dd>
          </dl>

          {selection.length > 0 && (
            <button type="button" className={styles.deleteButton} onClick={deleteSelection}>
              {t("sketchPanel.deleteSelection", "Delete selection")}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

const DIMENSION_LABEL: Record<string, string> = {
  distance: "Length",
  "point-line-distance": "Point-Line",
  "horizontal-distance": "Horizontal",
  "vertical-distance": "Vertical",
  radius: "Radius",
  diameter: "Diameter",
  angle: "Angle",
  "ordinate-x": "Ordinate X",
  "ordinate-y": "Ordinate Y",
};
