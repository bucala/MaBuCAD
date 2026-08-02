import { useEffect } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowUpDown,
  ArrowUpToLine,
  Ban,
  Boxes,
  ChevronsDown,
  Circle,
  CircleDashed,
  CircleDot,
  Combine,
  Cone,
  Cylinder,
  Drill,
  FlipVertical,
  Layers,
  Minus,
  MousePointerClick,
  RotateCcw,
  RotateCw,
  Slice,
  SlidersHorizontal,
  Trash2,
  Triangle,
  type LucideIcon,
} from "lucide-react";

import {
  CLEARANCE_STANDARDS,
  resolveSeatDimensions,
  SEAT_STANDARDS,
  TAPPED_STANDARDS,
  type ClearanceFit,
  type ClearanceStandardId,
  type SeatType,
  type TappedStandardId,
} from "@/data/holeStandards";
import { groupTappedBySize, resolveClearanceDiameter, resolveTapDrill } from "@/data/holeResolution";
import { FEATURE_CATALOG } from "@/state/featureCatalog";
import { useDocumentStore } from "@/state/documentStore";
import { useViewportStore } from "@/state/viewportStore";
import type { EndCondition, FeatureParameters } from "@/types/document";

import styles from "./PropertyManager.module.css";

const HOLE_TYPES: { id: NonNullable<FeatureParameters["holeType"]>; label: string; icon: LucideIcon }[] = [
  { id: "simple", label: "Simple — a plain cylindrical hole, no fastener standard", icon: Circle },
  { id: "clearance", label: "Clearance — sized for a fastener to pass through", icon: CircleDashed },
  { id: "tapped", label: "Tapped — sized as a tap drill for a threaded hole", icon: Drill },
  {
    id: "taper-tapped",
    label:
      "Taper Tapped — NPT pipe-thread sizing (real tap drill, but a straight hole — the pipe taper itself isn't modelled)",
    icon: Cone,
  },
];

const SEAT_TYPES: { id: NonNullable<FeatureParameters["seatType"]>; label: string; icon: LucideIcon }[] = [
  { id: "none", label: "None — the hole starts directly from the flat surface", icon: Ban },
  { id: "counterbore", label: "Counterbore — a flat-bottomed recess for a socket-head screw", icon: Cylinder },
  { id: "spotface", label: "Spotface — a shallow flat-bottomed recess for a rough surface", icon: CircleDot },
  { id: "countersink", label: "Countersink — a conical recess for a flat-head screw", icon: Triangle },
];

const DRILL_POINTS: { id: NonNullable<FeatureParameters["drillPoint"]>; label: string; icon: LucideIcon }[] = [
  { id: "flat", label: "Flat — the blind hole's bottom is flat", icon: Minus },
  { id: "angle", label: "Angle (118°) — the blind hole's bottom tapers to a point, like a real drill bit", icon: ChevronsDown },
];

const END_CONDITIONS: { id: EndCondition; label: string; icon: LucideIcon }[] = [
  { id: "blind", label: "Blind", icon: ArrowUp },
  { id: "through-all", label: "Through All", icon: ArrowUpToLine },
  { id: "mid-plane", label: "Mid Plane (symmetric)", icon: ArrowUpDown },
  { id: "up-to-surface", label: "Up To Surface", icon: Layers },
];

const OPERATIONS: {
  id: NonNullable<FeatureParameters["operation"]>;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "join", label: "Join — add this to the existing body", icon: Combine },
  { id: "cut", label: "Cut — remove this from the existing body", icon: Slice },
  { id: "intersect", label: "Intersect — keep only the overlap", icon: CircleDot },
];

/** Display metadata for the parameters a feature can carry. */
const PARAMETER_FIELDS: {
  key: keyof FeatureParameters;
  label: string;
  unit?: string;
  step?: number;
}[] = [
  { key: "depth", label: "Depth", unit: "mm", step: 1 },
  { key: "radius", label: "Radius", unit: "mm", step: 0.5 },
  { key: "distance", label: "Distance", unit: "mm", step: 1 },
  { key: "thickness", label: "Thickness", unit: "mm", step: 0.5 },
  { key: "angle", label: "Angle", unit: "°", step: 1 },
  { key: "count", label: "Instances", step: 1 },
];

/**
 * Context-sensitive property panel.
 *
 * Shows the selected feature's name and parameters. Editing a value writes straight
 * through to the document store; once the geometry kernel lands in Step 5 the same edit
 * also triggers a rebuild.
 */
export function PropertyManager() {
  const document = useDocumentStore((state) => state.document);
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const renameFeature = useDocumentStore((state) => state.renameFeature);
  const updateParameters = useDocumentStore((state) => state.updateParameters);
  const toggleSuppressed = useDocumentStore((state) => state.toggleSuppressed);
  const deleteFeature = useDocumentStore((state) => state.deleteFeature);
  const edgePickModeFeatureId = useViewportStore((state) => state.edgePickModeFeatureId);
  const setEdgePickMode = useViewportStore((state) => state.setEdgePickMode);

  const feature = document.features.find((candidate) =>
    selectedFeatureIds.includes(candidate.id),
  );

  // Edge-pick mode is meaningless once its feature is no longer the one showing here —
  // leaving it on would silently keep sending viewport clicks to a feature the user can no
  // longer see or stop picking for.
  useEffect(() => {
    if (edgePickModeFeatureId && edgePickModeFeatureId !== feature?.id) {
      setEdgePickMode(null);
    }
  }, [feature?.id, edgePickModeFeatureId, setEdgePickMode]);

  if (!feature) {
    return (
      <div className={styles.manager}>
        <div className={styles.header}>
          <h2 className={styles.title}>Properties</h2>
        </div>

        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <SlidersHorizontal size={22} strokeWidth={1.5} />
          </span>
          <div className={styles.emptyTitle}>No active command</div>
          <p className={styles.emptyBody}>
            Start a tool from the ribbon, or select a feature in the tree, and its options
            appear here.
          </p>
        </div>
      </div>
    );
  }

  const definition = FEATURE_CATALOG[feature.kind];
  const isHole = feature.kind === "hole";
  const isEdgeSelectable = feature.kind === "fillet" || feature.kind === "chamfer";
  const isPickingEdges = edgePickModeFeatureId === feature.id;
  const pickedEdgeCount = feature.parameters.edgePoints?.length ?? 0;
  // A hole's own Hole Wizard section below owns `radius` — as a direct input for a simple
  // hole, or resolved from a standard's table for clearance/tapped — so the generic field
  // list must not also render it.
  const fields = PARAMETER_FIELDS.filter(
    (field) => feature.parameters[field.key] !== undefined && !(isHole && field.key === "radius"),
  );

  const applyClearanceHole = (standardId: ClearanceStandardId, size: string, fit: ClearanceFit) => {
    const diameter = resolveClearanceDiameter(standardId, size, fit);
    updateParameters(feature.id, {
      holeType: "clearance",
      holeStandard: standardId,
      holeSize: size,
      holeFit: fit,
      radius: diameter !== undefined ? diameter / 2 : feature.parameters.radius,
      threadDesignation: undefined,
    });
  };

  const applyTappedHole = (
    standardId: TappedStandardId,
    designation: string,
    holeType: "tapped" | "taper-tapped" = "tapped",
  ) => {
    const entry = resolveTapDrill(standardId, designation);
    updateParameters(feature.id, {
      holeType,
      holeStandard: standardId,
      holeSize: designation,
      holeFit: undefined,
      radius: entry ? entry.tapDrill / 2 : feature.parameters.radius,
      threadDesignation: entry ? `${entry.designation} (${entry.internalClass})` : undefined,
    });
  };

  const applySeat = (seatType: SeatType, sizeLabel: string) => {
    if (seatType === "none") {
      updateParameters(feature.id, { seatType, seatDiameter: undefined, seatDepthOrAngle: undefined });
      return;
    }
    const entry = resolveSeatDimensions(seatType, sizeLabel);
    updateParameters(feature.id, {
      seatType,
      seatDiameter: entry?.headDiameter ?? feature.parameters.seatDiameter,
      seatDepthOrAngle: entry?.depthOrAngle ?? feature.parameters.seatDepthOrAngle,
    });
  };

  const handleHoleTypeChange = (holeType: NonNullable<FeatureParameters["holeType"]>) => {
    if (holeType === "simple") {
      updateParameters(feature.id, {
        holeType,
        holeStandard: undefined,
        holeSize: undefined,
        holeFit: undefined,
        threadDesignation: undefined,
      });
    } else if (holeType === "clearance") {
      const standardId: ClearanceStandardId = "iso";
      applyClearanceHole(standardId, CLEARANCE_STANDARDS[standardId].sizes[0].size, "normal");
    } else if (holeType === "taper-tapped") {
      const standardId: TappedStandardId = "npt";
      const firstVariant = groupTappedBySize(standardId)[0].variants[0];
      applyTappedHole(standardId, firstVariant.designation, "taper-tapped");
    } else {
      const standardId: TappedStandardId = "iso-metric";
      const firstVariant = groupTappedBySize(standardId)[0].variants[0];
      applyTappedHole(standardId, firstVariant.designation, "tapped");
    }
  };

  return (
    <div className={styles.manager}>
      <div className={styles.header}>
        <h2 className={styles.title}>{feature.name}</h2>
      </div>

      <div className={styles.body}>
        <p className={styles.kindDescription}>{definition.description}</p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <input
            className={styles.input}
            value={feature.name}
            disabled={feature.isDefault}
            onChange={(event) => renameFeature(feature.id, event.target.value)}
          />
        </label>

        {isEdgeSelectable && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Edges</span>
            <button
              type="button"
              className={styles.actionButton}
              aria-pressed={isPickingEdges}
              onClick={() => setEdgePickMode(isPickingEdges ? null : feature.id)}
            >
              <MousePointerClick size={14} strokeWidth={1.75} />
              {isPickingEdges ? "Done Selecting" : "Select Edges"}
            </button>
            <p className={styles.sectionHint}>
              {pickedEdgeCount === 0
                ? "No edges selected — applies to every edge of the body."
                : `${pickedEdgeCount} edge${pickedEdgeCount === 1 ? "" : "s"} selected.`}
              {isPickingEdges &&
                " Click edges on the model in the viewport; click a picked edge again to remove it."}
            </p>
            {pickedEdgeCount > 0 && (
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => updateParameters(feature.id, { edgePoints: [] })}
              >
                Clear Selection
              </button>
            )}
          </div>
        )}

        {isHole && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Hole Wizard</span>
            <div className={styles.iconRow} role="group" aria-label="Hole type">
              {HOLE_TYPES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={label}
                  aria-label={label}
                  aria-pressed={(feature.parameters.holeType ?? "simple") === id}
                  onClick={() => handleHoleTypeChange(id)}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
            </div>

            {feature.parameters.holeType === "clearance" && (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Standard</span>
                  <select
                    className={styles.input}
                    value={feature.parameters.holeStandard}
                    onChange={(event) => {
                      const standardId = event.target.value as ClearanceStandardId;
                      applyClearanceHole(
                        standardId,
                        CLEARANCE_STANDARDS[standardId].sizes[0].size,
                        feature.parameters.holeFit ?? "normal",
                      );
                    }}
                  >
                    {Object.values(CLEARANCE_STANDARDS).map((standard) => (
                      <option key={standard.id} value={standard.id}>
                        {standard.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Size</span>
                  <select
                    className={styles.input}
                    value={feature.parameters.holeSize}
                    onChange={(event) =>
                      applyClearanceHole(
                        feature.parameters.holeStandard as ClearanceStandardId,
                        event.target.value,
                        feature.parameters.holeFit ?? "normal",
                      )
                    }
                  >
                    {CLEARANCE_STANDARDS[feature.parameters.holeStandard as ClearanceStandardId].sizes.map(
                      (size) => (
                        <option key={size.size} value={size.size}>
                          {size.size}
                        </option>
                      ),
                    )}
                  </select>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Fit</span>
                  <select
                    className={styles.input}
                    value={feature.parameters.holeFit ?? "normal"}
                    onChange={(event) =>
                      applyClearanceHole(
                        feature.parameters.holeStandard as ClearanceStandardId,
                        feature.parameters.holeSize ?? "",
                        event.target.value as ClearanceFit,
                      )
                    }
                  >
                    <option value="close">Close</option>
                    <option value="normal">Normal</option>
                    <option value="loose">Loose</option>
                  </select>
                </label>

                <p className={styles.sectionHint}>
                  Ø{feature.parameters.radius ? (feature.parameters.radius * 2).toFixed(2) : "?"} mm shaft
                  clearance.
                </p>
              </>
            )}

            {(feature.parameters.holeType === "tapped" || feature.parameters.holeType === "taper-tapped") && (
              <>
                {feature.parameters.holeType === "tapped" && (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Standard</span>
                    <select
                      className={styles.input}
                      value={feature.parameters.holeStandard}
                      onChange={(event) => {
                        const standardId = event.target.value as TappedStandardId;
                        applyTappedHole(standardId, groupTappedBySize(standardId)[0].variants[0].designation, "tapped");
                      }}
                    >
                      {Object.values(TAPPED_STANDARDS)
                        .filter((standard) => standard.kind !== "npt")
                        .map((standard) => (
                          <option key={standard.id} value={standard.id}>
                            {standard.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

                {(() => {
                  const standardId = feature.parameters.holeStandard as TappedStandardId;
                  const holeType = feature.parameters.holeType as "tapped" | "taper-tapped";
                  const groups = groupTappedBySize(standardId);
                  const currentDesignation = feature.parameters.holeSize ?? "";
                  const currentGroup =
                    groups.find((group) => group.variants.some((v) => v.designation === currentDesignation)) ??
                    groups[0];

                  return (
                    <>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Size</span>
                        <select
                          className={styles.input}
                          value={currentGroup.sizeLabel}
                          onChange={(event) => {
                            const group = groups.find((candidate) => candidate.sizeLabel === event.target.value);
                            if (group) applyTappedHole(standardId, group.variants[0].designation, holeType);
                          }}
                        >
                          {groups.map((group) => (
                            <option key={group.sizeLabel} value={group.sizeLabel}>
                              {group.sizeLabel}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Thread designation</span>
                        <select
                          className={styles.input}
                          value={currentDesignation}
                          onChange={(event) => applyTappedHole(standardId, event.target.value, holeType)}
                        >
                          {currentGroup.variants.map((variant) => (
                            <option key={variant.designation} value={variant.designation}>
                              {variant.designation}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  );
                })()}

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Direction</span>
                  <div className={styles.iconRow} role="group" aria-label="Thread direction">
                    <button
                      type="button"
                      className={styles.iconButton}
                      title="Right-hand thread"
                      aria-label="Right-hand thread"
                      aria-pressed={(feature.parameters.threadDirection ?? "right") === "right"}
                      onClick={() => updateParameters(feature.id, { threadDirection: "right" })}
                    >
                      <RotateCw size={15} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      title="Left-hand thread"
                      aria-label="Left-hand thread"
                      aria-pressed={feature.parameters.threadDirection === "left"}
                      onClick={() => updateParameters(feature.id, { threadDirection: "left" })}
                    >
                      <RotateCcw size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.actionButton}
                  title="Full Depth — thread runs the hole's whole depth rather than a shorter engagement length (display only for now, not yet reflected in the model)"
                  aria-pressed={feature.parameters.fullDepthThread ?? false}
                  onClick={() =>
                    updateParameters(feature.id, { fullDepthThread: !feature.parameters.fullDepthThread })
                  }
                >
                  <ArrowDownToLine size={14} strokeWidth={1.75} />
                  Full Depth
                </button>

                <p className={styles.sectionHint}>
                  {feature.parameters.threadDesignation ?? "—"}
                  {feature.parameters.threadDirection === "left" ? " (LH)" : " (RH)"} — tap drill Ø
                  {feature.parameters.radius ? (feature.parameters.radius * 2).toFixed(2) : "?"} mm.
                  {feature.parameters.holeType === "taper-tapped" &&
                    " Straight hole — the NPT pipe taper itself isn't modelled."}
                </p>
              </>
            )}

            {(feature.parameters.holeType ?? "simple") === "simple" && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Radius (mm)</span>
                <input
                  className={styles.input}
                  type="number"
                  step={0.5}
                  min={0.1}
                  value={feature.parameters.radius ?? 3}
                  onChange={(event) => updateParameters(feature.id, { radius: Number(event.target.value) })}
                />
              </label>
            )}

            <p className={styles.sectionHint}>
              One hole is cut per point placed in the hole's sketch, all at this size.
            </p>

            <span className={styles.sectionTitle}>Seat</span>
            <div className={styles.iconRow} role="group" aria-label="Seat type">
              {SEAT_TYPES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={label}
                  aria-label={label}
                  aria-pressed={(feature.parameters.seatType ?? "none") === id}
                  onClick={() => applySeat(id, SEAT_STANDARDS[id === "none" ? "counterbore" : id].sizes[0].size)}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
            </div>

            {feature.parameters.seatType && feature.parameters.seatType !== "none" && (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Seat size</span>
                  <select
                    className={styles.input}
                    value={
                      SEAT_STANDARDS[feature.parameters.seatType].sizes.find(
                        (size) => size.headDiameter === feature.parameters.seatDiameter,
                      )?.size ?? SEAT_STANDARDS[feature.parameters.seatType].sizes[0].size
                    }
                    onChange={(event) => applySeat(feature.parameters.seatType as SeatType, event.target.value)}
                  >
                    {SEAT_STANDARDS[feature.parameters.seatType].sizes.map((size) => (
                      <option key={size.size} value={size.size}>
                        {size.size}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.sectionHint}>
                  {SEAT_STANDARDS[feature.parameters.seatType].label} — Ø
                  {feature.parameters.seatDiameter?.toFixed(2) ?? "?"} mm
                  {feature.parameters.seatType === "countersink"
                    ? ` at ${feature.parameters.seatDepthOrAngle ?? 90}° included angle.`
                    : `, ${feature.parameters.seatDepthOrAngle?.toFixed(2) ?? "?"} mm deep.`}
                </p>
              </>
            )}
          </div>
        )}

        {feature.parameters.endCondition !== undefined && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Direction</span>
            <div className={styles.iconRow} role="group" aria-label="End condition">
              {END_CONDITIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={label}
                  aria-label={label}
                  aria-pressed={feature.parameters.endCondition === id}
                  onClick={() => updateParameters(feature.id, { endCondition: id })}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
            </div>

            {isHole && feature.parameters.endCondition === "blind" && (
              <>
                <span className={styles.fieldLabel}>Drill Point</span>
                <div className={styles.iconRow} role="group" aria-label="Drill point">
                  {DRILL_POINTS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={styles.iconButton}
                      title={label}
                      aria-label={label}
                      aria-pressed={(feature.parameters.drillPoint ?? "flat") === id}
                      onClick={() => updateParameters(feature.id, { drillPoint: id })}
                    >
                      <Icon size={15} strokeWidth={1.75} />
                    </button>
                  ))}
                </div>
              </>
            )}

            {feature.parameters.reversed !== undefined && (
              <button
                type="button"
                className={styles.actionButton}
                title="Reverse direction"
                aria-pressed={feature.parameters.reversed}
                onClick={() =>
                  updateParameters(feature.id, { reversed: !feature.parameters.reversed })
                }
              >
                <FlipVertical size={14} strokeWidth={1.75} />
                Reverse direction
              </button>
            )}
          </div>
        )}

        {feature.parameters.operation !== undefined && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Body</span>
            <div className={styles.iconRow} role="group" aria-label="Boolean operation">
              {OPERATIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={label}
                  aria-label={label}
                  aria-pressed={feature.parameters.operation === id}
                  onClick={() => updateParameters(feature.id, { operation: id })}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
              <button
                type="button"
                className={styles.iconButton}
                title="New Body — not available yet: the kernel keeps one combined body per document"
                aria-label="New Body (unavailable)"
                disabled
              >
                <Boxes size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}

        {feature.parameters.axis !== undefined && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {feature.kind === "mirror"
                ? "Mirror plane"
                : feature.kind === "shell" || feature.kind === "draft"
                  ? "Face (points this way)"
                  : "Direction"}
            </span>
            <select
              className={styles.input}
              value={feature.parameters.axis}
              onChange={(event) =>
                updateParameters(feature.id, {
                  axis: event.target.value as FeatureParameters["axis"],
                })
              }
            >
              <option value="x">X</option>
              <option value="y">Y</option>
              <option value="z">Z</option>
            </select>
          </label>
        )}
        {(feature.kind === "shell" || feature.kind === "draft") && (
          <p className={styles.sectionHint}>
            No face-picking UI yet — acts on whichever face(s) point exactly along this axis
            (e.g. Z for the top face of a simple extruded block).
          </p>
        )}

        {fields.map((field) => (
          <label key={field.key} className={styles.field}>
            <span className={styles.fieldLabel}>
              {field.label}
              {field.unit ? ` (${field.unit})` : ""}
            </span>
            <input
              className={styles.input}
              type="number"
              step={field.step}
              value={String(feature.parameters[field.key] ?? "")}
              onChange={(event) =>
                updateParameters(feature.id, { [field.key]: Number(event.target.value) })
              }
            />
          </label>
        ))}

        {!feature.isDefault && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              aria-pressed={feature.suppressed}
              onClick={() => toggleSuppressed(feature.id)}
            >
              {feature.suppressed ? "Unsuppress" : "Suppress"}
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.danger}`}
              onClick={() => deleteFeature(feature.id)}
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
