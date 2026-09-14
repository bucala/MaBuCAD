import { useEffect, useMemo } from "react";
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
import { extractCircles, extractLoops, regionEntityIds, type CircleLoop, type Loop } from "@/kernel/profile";
import { featureDisplayName } from "@/i18n/featureNames";
import { fillTemplate, useTranslation } from "@/i18n/useTranslation";
import { FEATURE_CATALOG } from "@/state/featureCatalog";
import { useDocumentStore } from "@/state/documentStore";
import { useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";
import type { EndCondition, FeatureKind, FeatureParameters } from "@/types/document";

import { FeatureActionBar } from "./FeatureActionBar";
import styles from "./PropertyManager.module.css";

/** Feature kinds whose `parents[0]` is a single profile sketch, editable via the
 * "Profile Sketch" section below — a Loft/Boundary's multiple sketches, or a non-sketch
 * parent like Fillet's solid, are out of scope. */
const SINGLE_SKETCH_KINDS: FeatureKind[] = ["extrude", "cut-extrude", "revolve", "cut-revolve", "rib"];

/** Feature kinds `kernel/profile.ts`'s `profileRegions` actually builds from — Rib takes
 * its sketch's first line directly (see `rebuild.ts`'s own note), so it has no notion of
 * "regions" to narrow down and is excluded from the "Profile Regions" picker below even
 * though it shares the single-sketch picker above. */
const PROFILE_REGION_KINDS: FeatureKind[] = ["extrude", "cut-extrude", "revolve", "cut-revolve"];

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
  const renameFeatureRaw = useDocumentStore((state) => state.renameFeature);
  const updateParametersRaw = useDocumentStore((state) => state.updateParameters);
  const setFeatureParentRaw = useDocumentStore((state) => state.setFeatureParent);
  const beginFeatureEdit = useDocumentStore((state) => state.beginFeatureEdit);
  const endFeatureEdit = useDocumentStore((state) => state.endFeatureEdit);
  const featureEdit = useDocumentStore((state) => state.featureEdit);
  const sketches = useSketchStore((state) => state.sketches);
  const edgePickModeFeatureId = useViewportStore((state) => state.edgePickModeFeatureId);
  const setEdgePickMode = useViewportStore((state) => state.setEdgePickMode);

  const feature = document.features.find((candidate) =>
    selectedFeatureIds.includes(candidate.id),
  );
  const { t } = useTranslation();

  // Editing anything in this panel joins (or opens) that feature's own session, so the whole
  // edit collapses to one undo step and Cancel can back all of it out at once — see
  // `documentStore.featureEdit`. Every write below goes through these wrappers rather than
  // the raw store actions, which is what makes "edit an existing feature" and "tune a
  // feature that was just created" literally the same flow.
  const editParameters = (id: string, parameters: FeatureParameters) => {
    beginFeatureEdit(id);
    updateParametersRaw(id, parameters);
  };
  const editName = (id: string, name: string) => {
    beginFeatureEdit(id);
    renameFeatureRaw(id, name);
  };
  const editParent = (id: string, index: number, parentId: string) => {
    beginFeatureEdit(id);
    setFeatureParentRaw(id, index, parentId);
  };
  const updateParameters = editParameters;

  // Edge-pick mode is meaningless once its feature is no longer the one showing here —
  // leaving it on would silently keep sending viewport clicks to a feature the user can no
  // longer see or stop picking for.
  useEffect(() => {
    if (edgePickModeFeatureId && edgePickModeFeatureId !== feature?.id) {
      setEdgePickMode(null);
    }
  }, [feature?.id, edgePickModeFeatureId, setEdgePickMode]);

  // Showing an editable feature's properties *is* editing it: the session opens as soon as
  // the panel does, so OK/Cancel are live from the first moment rather than appearing only
  // after the first keystroke. A session that never changes anything pushes no undo entry
  // and its Cancel restores an identical document, so browsing the tree stays free.
  const editableFeatureId =
    feature && !feature.isDefault && feature.kind !== "sketch" ? feature.id : null;
  useEffect(() => {
    if (editableFeatureId) beginFeatureEdit(editableFeatureId);
  }, [editableFeatureId, beginFeatureEdit]);

  // Unmounting this panel — switching to the Feature Manager or Configurations tab, or the
  // slot being taken over by sketch mode or an Inspect tool — confirms an open session
  // rather than leaving it armed somewhere its OK/Cancel are no longer on screen: the same
  // "clicking away confirms" rule the store applies to selection changes. Reads the store
  // at unmount time (not a closure) so it ends whatever session is actually open then; a
  // session already ended by OK/Cancel/Delete is a no-op because `featureEdit` is null.
  useEffect(() => {
    return () => {
      const state = useDocumentStore.getState();
      if (state.featureEdit) state.endFeatureEdit("commit");
    };
  }, []);

  // Every closed region of the profile sketch, loops and circles alike, in the same order
  // `profileRegions` itself would rank them (largest first) — purely for display; the
  // filter this picker writes doesn't depend on the order.
  const profileSketch = feature && feature.parents[0] ? sketches[feature.parents[0]] : undefined;
  // Memoized: extraction is a graph traversal over every entity of the sketch, and this
  // component re-renders on any sketch-store write — including each pointermove of a live
  // point drag, which would otherwise re-run the whole traversal per move for nothing.
  // Computed *before* the empty-state early return (an empty list when there is no
  // feature or no sketch) so the hook count is identical on every render — a conditional
  // hook is a rules-of-hooks violation that crashes React the moment the selection
  // toggles between "no active command" and a feature.
  const profileRegionsList: (Loop | CircleLoop)[] = useMemo(
    () => (profileSketch ? [...extractLoops(profileSketch), ...extractCircles(profileSketch)] : []),
    [profileSketch],
  );

  if (!feature) {
    return (
      <div className={styles.manager}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t("propertyManager.properties", "Properties")}</h2>
        </div>

        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <SlidersHorizontal size={22} strokeWidth={1.5} />
          </span>
          <div className={styles.emptyTitle}>{t("propertyManager.emptyTitle", "No active command")}</div>
          <p className={styles.emptyBody}>
            {t(
              "propertyManager.emptyBody",
              "Start a tool from the ribbon, or select a feature in the tree, and its options appear here.",
            )}
          </p>
        </div>
      </div>
    );
  }

  const definition = FEATURE_CATALOG[feature.kind];
  // Exists specifically so a feature created via `resolveTargetSketchId`'s own best guess
  // (or with none at all, if nothing was selected/resolvable when the ribbon command ran)
  // can have its profile sketch fixed up afterward, without deleting and recreating it.
  const takesSingleSketch = SINGLE_SKETCH_KINDS.includes(feature.kind);
  const sketchFeatures = document.features.filter((candidate) => candidate.kind === "sketch");

  const showProfileRegionPicker = PROFILE_REGION_KINDS.includes(feature.kind) && profileRegionsList.length > 1;
  const explicitProfileIds = feature.parameters.profileEntityIds;
  // Absent/empty means "the whole sketch" — every region reads as checked until the user
  // actually excludes one, rather than requiring every region ticked by hand up front.
  const isRegionChecked = (region: Loop | CircleLoop) =>
    !explicitProfileIds ||
    explicitProfileIds.length === 0 ||
    regionEntityIds(region).some((id) => explicitProfileIds.includes(id));
  const toggleProfileRegion = (region: Loop | CircleLoop) => {
    const nextChecked = new Map(profileRegionsList.map((candidate) => [candidate, isRegionChecked(candidate)]));
    nextChecked.set(region, !isRegionChecked(region));
    const stillChecked = [...nextChecked.values()].filter(Boolean).length;
    if (stillChecked === 0) return; // always keep at least one region selected

    const allChecked = stillChecked === profileRegionsList.length;
    const ids = allChecked
      ? []
      : profileRegionsList.filter((candidate) => nextChecked.get(candidate)).flatMap(regionEntityIds);
    updateParameters(feature.id, { profileEntityIds: ids });
  };

  const isHole = feature.kind === "hole";
  const isEdgeSelectable = feature.kind === "fillet" || feature.kind === "chamfer";
  const isPickingEdges = edgePickModeFeatureId === feature.id;
  const pickedEdgeCount = feature.parameters.edgePoints?.length ?? 0;
  const activeHoleType = HOLE_TYPES.find(({ id }) => id === (feature.parameters.holeType ?? "simple"));
  const activeSeatType = SEAT_TYPES.find(({ id }) => id === (feature.parameters.seatType ?? "none"));
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

  const isSessionOpen = featureEdit?.featureId === feature.id;

  return (
    <div
      className={styles.manager}
      // Marks this subtree as "a feature session's own fields", which is what lets the global
      // Escape handler cancel the whole feature from inside one of them instead of taking its
      // usual "let the field handle its own Escape" exit.
      data-feature-session={isSessionOpen ? "open" : undefined}
      // Enter confirms, the way it does in every dialog in the app — pressing it in a depth
      // field is the same "I'm done with this feature" gesture as clicking OK. Escape is
      // handled globally instead (`useEscapeToDeselect`), since it has to win over the
      // panel even when focus is out in the viewport.
      onKeyDown={(event) => {
        if (event.key === "Enter" && isSessionOpen && !event.shiftKey) {
          event.preventDefault();
          (event.target as HTMLElement).blur();
          setEdgePickMode(null);
          endFeatureEdit("commit");
        }
      }}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{featureDisplayName(t, feature)}</h2>
      </div>

      {!feature.isDefault && (
        <div className={styles.sessionBar}>
          <FeatureActionBar feature={feature} />
        </div>
      )}

      <div className={styles.body}>
        <p className={styles.kindDescription}>
          {t(`featureCatalog.${feature.kind}`, definition.description)}
        </p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("propertyManager.name", "Name")}</span>
          <input
            className={styles.input}
            value={feature.name}
            disabled={feature.isDefault}
            onChange={(event) => editName(feature.id, event.target.value)}
          />
        </label>

        {takesSingleSketch && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("propertyManager.profileSketch", "Profile Sketch")}</span>
            <select
              className={styles.input}
              value={feature.parents[0] ?? ""}
              onChange={(event) => editParent(feature.id, 0, event.target.value)}
            >
              <option value="" disabled>
                {t("propertyManager.selectSketch", "Select a sketch…")}
              </option>
              {sketchFeatures.map((sketch) => (
                <option key={sketch.id} value={sketch.id}>
                  {featureDisplayName(t, sketch)}
                </option>
              ))}
            </select>
          </label>
        )}

        {showProfileRegionPicker && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>{t("propertyManager.profileRegions", "Profile Regions")}</span>
            <p className={styles.sectionHint}>
              {fillTemplate(
                t(
                  "propertyManager.profileRegionsHint",
                  "This sketch has {{count}} closed contours. Uncheck any this feature should skip — the rest build the same way they always would: a contour nested inside another becomes a hole in it, and separate, non-overlapping contours each become their own body, fused together.",
                ),
                { count: profileRegionsList.length },
              )}
            </p>
            {profileRegionsList.map((region, index) => (
              <label key={regionEntityIds(region).join(",")} className={styles.regionRow}>
                <input
                  type="checkbox"
                  checked={isRegionChecked(region)}
                  onChange={() => toggleProfileRegion(region)}
                />
                {"radius" in region
                  ? fillTemplate(t("propertyManager.circleRegion", "Circle {{index}} — ⌀{{diameter}} mm"), {
                      index: index + 1,
                      diameter: (region.radius * 2).toFixed(1),
                    })
                  : fillTemplate(t("propertyManager.contourRegion", "Contour {{index}} — {{edges}} edges"), {
                      index: index + 1,
                      edges: region.segments.length,
                    })}
              </label>
            ))}
          </div>
        )}

        {isEdgeSelectable && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>{t("propertyManager.edges", "Edges")}</span>
            <button
              type="button"
              className={styles.actionButton}
              aria-pressed={isPickingEdges}
              onClick={() => setEdgePickMode(isPickingEdges ? null : feature.id)}
            >
              <MousePointerClick size={14} strokeWidth={1.75} />
              {isPickingEdges
                ? t("propertyManager.doneSelecting", "Done Selecting")
                : t("propertyManager.selectEdges", "Select Edges")}
            </button>
            <p className={styles.sectionHint}>
              {pickedEdgeCount === 0
                ? feature.parameters.edgesPending
                  ? t(
                      "propertyManager.noEdgesPicked",
                      "No edges picked yet — nothing is rounded/chamfered until you pick at least one.",
                    )
                  : t(
                      "propertyManager.noEdgesAll",
                      "No edges selected — applies to every edge of the body.",
                    )
                : fillTemplate(t("propertyManager.edgeCount", "{{count}} edge(s) selected."), {
                    count: pickedEdgeCount,
                  })}
              {isPickingEdges &&
                t(
                  "propertyManager.edgePickingHint",
                  " Click edges on the model in the viewport; click a picked edge again to remove it.",
                )}
            </p>
            {pickedEdgeCount > 0 && (
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => updateParameters(feature.id, { edgePoints: [] })}
              >
                {t("propertyManager.clearSelection", "Clear Selection")}
              </button>
            )}
          </div>
        )}

        {isHole && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>{t("feature.hole-wizard", "Hole Wizard")}</span>
            <div className={styles.iconRow} role="group" aria-label={t("propertyManager.holeTypeAria", "Hole type")}>
              {HOLE_TYPES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={t(`propertyManager.holeType.${id}`, label)}
                  aria-label={t(`propertyManager.holeType.${id}`, label)}
                  aria-pressed={(feature.parameters.holeType ?? "simple") === id}
                  onClick={() => handleHoleTypeChange(id)}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
            </div>
            {/* The icon row alone gives no clue that Clearance/Tapped/Taper Tapped each
                reveal their own Standard/Size/Thread fields below — spelling out which one
                is active in plain text, not just a hover tooltip, is what actually makes
                that discoverable. */}
            <p className={styles.sectionHint}>
              {activeHoleType && t(`propertyManager.holeType.${activeHoleType.id}`, activeHoleType.label)}
            </p>

            {feature.parameters.holeType === "clearance" && (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t("propertyManager.standard", "Standard")}</span>
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
                  <span className={styles.fieldLabel}>{t("propertyManager.size", "Size")}</span>
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
                  <span className={styles.fieldLabel}>{t("propertyManager.fit", "Fit")}</span>
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
                    <option value="close">{t("propertyManager.fit.close", "Close")}</option>
                    <option value="normal">{t("propertyManager.fit.normal", "Normal")}</option>
                    <option value="loose">{t("propertyManager.fit.loose", "Loose")}</option>
                  </select>
                </label>

                <p className={styles.sectionHint}>
                  {fillTemplate(t("propertyManager.shaftClearance", "Ø{{diameter}} mm shaft clearance."), {
                    diameter: feature.parameters.radius ? (feature.parameters.radius * 2).toFixed(2) : "?",
                  })}
                </p>
              </>
            )}

            {(feature.parameters.holeType === "tapped" || feature.parameters.holeType === "taper-tapped") && (
              <>
                {feature.parameters.holeType === "tapped" && (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>{t("propertyManager.standard", "Standard")}</span>
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
                        <span className={styles.fieldLabel}>{t("propertyManager.size", "Size")}</span>
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
                        <span className={styles.fieldLabel}>
                          {t("propertyManager.threadDesignation", "Thread designation")}
                        </span>
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
                  <span className={styles.fieldLabel}>{t("propertyManager.direction", "Direction")}</span>
                  <div className={styles.iconRow} role="group" aria-label={t("propertyManager.threadDirectionAria", "Thread direction")}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      title={t("propertyManager.rightHandThread", "Right-hand thread")}
                      aria-label={t("propertyManager.rightHandThread", "Right-hand thread")}
                      aria-pressed={(feature.parameters.threadDirection ?? "right") === "right"}
                      onClick={() => updateParameters(feature.id, { threadDirection: "right" })}
                    >
                      <RotateCw size={15} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      title={t("propertyManager.leftHandThread", "Left-hand thread")}
                      aria-label={t("propertyManager.leftHandThread", "Left-hand thread")}
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
                  title={t(
                    "propertyManager.fullDepthHint",
                    "Full Depth — thread runs the hole's whole depth rather than a shorter engagement length (display only for now, not yet reflected in the model)",
                  )}
                  aria-pressed={feature.parameters.fullDepthThread ?? false}
                  onClick={() =>
                    updateParameters(feature.id, { fullDepthThread: !feature.parameters.fullDepthThread })
                  }
                >
                  <ArrowDownToLine size={14} strokeWidth={1.75} />
                  {t("propertyManager.fullDepth", "Full Depth")}
                </button>

                <p className={styles.sectionHint}>
                  {feature.parameters.threadDesignation ?? "—"}
                  {feature.parameters.threadDirection === "left" ? " (LH)" : " (RH)"}
                  {fillTemplate(t("propertyManager.tapDrillSuffix", " — tap drill Ø{{diameter}} mm."), {
                    diameter: feature.parameters.radius ? (feature.parameters.radius * 2).toFixed(2) : "?",
                  })}
                  {feature.parameters.holeType === "taper-tapped" &&
                    t(
                      "propertyManager.straightHoleNote",
                      " Straight hole — the NPT pipe taper itself isn't modelled.",
                    )}
                </p>
              </>
            )}

            {(feature.parameters.holeType ?? "simple") === "simple" && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t("propertyManager.radius", "Radius (mm)")}</span>
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
              {t(
                "propertyManager.holePerPoint",
                "One hole is cut per point placed in the hole's sketch, all at this size.",
              )}
            </p>

            <span className={styles.sectionTitle}>{t("propertyManager.seat", "Seat")}</span>
            <div className={styles.iconRow} role="group" aria-label={t("propertyManager.seatTypeAria", "Seat type")}>
              {SEAT_TYPES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={t(`propertyManager.seatType.${id}`, label)}
                  aria-label={t(`propertyManager.seatType.${id}`, label)}
                  aria-pressed={(feature.parameters.seatType ?? "none") === id}
                  onClick={() => applySeat(id, SEAT_STANDARDS[id === "none" ? "counterbore" : id].sizes[0].size)}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
            </div>
            <p className={styles.sectionHint}>
              {activeSeatType && t(`propertyManager.seatType.${activeSeatType.id}`, activeSeatType.label)}
            </p>

            {feature.parameters.seatType && feature.parameters.seatType !== "none" && (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t("propertyManager.seatSize", "Seat size")}</span>
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
                  {fillTemplate(
                    t(
                      feature.parameters.seatType === "countersink"
                        ? "propertyManager.seatSummaryAngle"
                        : "propertyManager.seatSummaryDepth",
                      feature.parameters.seatType === "countersink"
                        ? "{{standard}} — Ø{{diameter}} mm at {{angle}}° included angle."
                        : "{{standard}} — Ø{{diameter}} mm, {{depth}} mm deep.",
                    ),
                    {
                      standard: SEAT_STANDARDS[feature.parameters.seatType].label,
                      diameter: feature.parameters.seatDiameter?.toFixed(2) ?? "?",
                      ...(feature.parameters.seatType === "countersink"
                        ? { angle: feature.parameters.seatDepthOrAngle ?? 90 }
                        : { depth: feature.parameters.seatDepthOrAngle?.toFixed(2) ?? "?" }),
                    },
                  )}
                </p>
              </>
            )}
          </div>
        )}

        {feature.parameters.endCondition !== undefined && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>{t("propertyManager.direction", "Direction")}</span>
            <div className={styles.iconRow} role="group" aria-label={t("propertyManager.endConditionAria", "End condition")}>
              {END_CONDITIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={t(`propertyManager.endCondition.${id}`, label)}
                  aria-label={t(`propertyManager.endCondition.${id}`, label)}
                  aria-pressed={feature.parameters.endCondition === id}
                  onClick={() => updateParameters(feature.id, { endCondition: id })}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
            </div>

            {isHole && feature.parameters.endCondition === "blind" && (
              <>
                <span className={styles.fieldLabel}>{t("propertyManager.drillPoint", "Drill Point")}</span>
                <div className={styles.iconRow} role="group" aria-label={t("propertyManager.drillPoint", "Drill point")}>
                  {DRILL_POINTS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={styles.iconButton}
                      title={t(`propertyManager.drillPoint.${id}`, label)}
                      aria-label={t(`propertyManager.drillPoint.${id}`, label)}
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
                title={t("propertyManager.reverseDirection", "Reverse direction")}
                aria-pressed={feature.parameters.reversed}
                onClick={() =>
                  updateParameters(feature.id, { reversed: !feature.parameters.reversed })
                }
              >
                <FlipVertical size={14} strokeWidth={1.75} />
                {t("propertyManager.reverseDirection", "Reverse direction")}
              </button>
            )}
          </div>
        )}

        {feature.parameters.operation !== undefined && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>{t("propertyManager.body", "Body")}</span>
            <div className={styles.iconRow} role="group" aria-label={t("propertyManager.booleanAria", "Boolean operation")}>
              {OPERATIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.iconButton}
                  title={t(`propertyManager.operation.${id}`, label)}
                  aria-label={t(`propertyManager.operation.${id}`, label)}
                  aria-pressed={feature.parameters.operation === id}
                  onClick={() => updateParameters(feature.id, { operation: id })}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              ))}
              <button
                type="button"
                className={styles.iconButton}
                title={t(
                  "propertyManager.newBody",
                  "New Body — not available yet: the kernel keeps one combined body per document",
                )}
                aria-label={t("propertyManager.newBodyAria", "New Body (unavailable)")}
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
                ? t("propertyManager.mirrorPlane", "Mirror plane")
                : feature.kind === "shell" || feature.kind === "draft"
                  ? t("propertyManager.openFace", "Face (points this way)")
                  : t("propertyManager.direction", "Direction")}
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
            {t(
              "propertyManager.facePickingPending",
              "No face-picking UI yet — acts on whichever face(s) point exactly along this axis (e.g. Z for the top face of a simple extruded block).",
            )}
          </p>
        )}

        {fields.map((field) => (
          <label key={field.key} className={styles.field}>
            <span className={styles.fieldLabel}>
              {t(`propertyManager.parameter.${field.key}`, field.label)}
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

      </div>
    </div>
  );
}
