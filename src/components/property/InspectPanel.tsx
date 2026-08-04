import { Fragment, useEffect, useMemo } from "react";
import { X } from "lucide-react";

import { computeMassProperties, computeMeasureSummary } from "@/kernel/measure";
import { useGeometryStore } from "@/state/geometryStore";
import { useInspectStore } from "@/state/inspectStore";

import styles from "./InspectPanel.module.css";

const ENTITY_LABEL: Record<"face" | "edge", string> = { face: "Face", edge: "Edge" };
const VALUE_LABEL: Record<"face" | "edge", string> = { face: "Area", edge: "Length" };

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/**
 * Property manager contents while an Inspect tool has taken over the viewport — Measure's
 * accumulating two-entity pick list, or Mass Properties' whole-body summary. Mirrors
 * `SketchPanel.tsx`'s "own header + Exit button, sections below" shape.
 */
export function InspectPanel() {
  const activeTool = useInspectStore((state) => state.activeTool);
  const measurePicks = useInspectStore((state) => state.measurePicks);
  const clearMeasurePicks = useInspectStore((state) => state.clearMeasurePicks);
  const closeInspect = useInspectStore((state) => state.closeInspect);
  const mesh = useGeometryStore((state) => state.mesh);

  // Escape backs out of an Inspect tool the same way it backs out of Hole Wizard
  // placement (see `SolidModel.tsx`'s own Escape handler for `holePlacementActive`) —
  // there is no feature selected here to drive cancellation any other way.
  useEffect(() => {
    if (!activeTool) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeInspect();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, closeInspect]);

  // Recomputed whenever the committed mesh reference changes — the same trigger
  // `SolidModel.tsx` uses to know a rebuild actually happened. The kernel's own current
  // shape (`getCurrentShape()`) only ever reflects the *latest* rebuild, so these can't be
  // computed once and cached across edits.
  const massProperties = useMemo(
    () => (activeTool === "mass" ? computeMassProperties() : null),
    [activeTool, mesh],
  );
  const measureSummary = useMemo(
    () => (activeTool === "measure" ? computeMeasureSummary(measurePicks) : null),
    [activeTool, measurePicks, mesh],
  );

  if (!activeTool) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{activeTool === "measure" ? "Measure" : "Mass Properties"}</h2>
        <button type="button" className={styles.closeButton} aria-label="Close Inspect" onClick={closeInspect}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.body}>
        {activeTool === "measure" && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Picked Entities</h3>
            <p className={styles.hint}>
              {measurePicks.length === 0
                ? "Click a face or edge in the 3D view."
                : measurePicks.length === 1
                  ? "Click a second face or edge to measure the distance between them."
                  : "Click either one again to replace it, or Clear to start over."}
            </p>

            {!measureSummary && measurePicks.length > 0 && (
              <p className={styles.hint}>One of the picked entities no longer exists — Clear and pick again.</p>
            )}

            {measureSummary && measureSummary.picks.length > 0 && (
              <dl className={styles.stats}>
                {measureSummary.picks.map((pick, index) => (
                  <Fragment key={`${pick.kind}-${pick.id}`}>
                    <dt>
                      {ENTITY_LABEL[pick.kind]} {index + 1} {VALUE_LABEL[pick.kind]}
                    </dt>
                    <dd>
                      {formatNumber(pick.value)} {pick.kind === "face" ? "mm²" : "mm"}
                    </dd>
                  </Fragment>
                ))}
                {measureSummary.distance !== null && (
                  <Fragment>
                    <dt>Distance</dt>
                    <dd>{formatNumber(measureSummary.distance)} mm</dd>
                  </Fragment>
                )}
              </dl>
            )}

            {measurePicks.length > 0 && (
              <button type="button" className={styles.clearButton} onClick={clearMeasurePicks}>
                Clear
              </button>
            )}
          </section>
        )}

        {activeTool === "mass" && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Mass Properties</h3>
            {massProperties ? (
              <dl className={styles.stats}>
                <dt>Volume</dt>
                <dd>{formatNumber(massProperties.volume)} mm³</dd>
                <dt>Surface area</dt>
                <dd>{formatNumber(massProperties.area)} mm²</dd>
                <dt>Centre of mass X</dt>
                <dd>{formatNumber(massProperties.centerOfMass[0])} mm</dd>
                <dt>Centre of mass Y</dt>
                <dd>{formatNumber(massProperties.centerOfMass[1])} mm</dd>
                <dt>Centre of mass Z</dt>
                <dd>{formatNumber(massProperties.centerOfMass[2])} mm</dd>
              </dl>
            ) : (
              <p className={styles.hint}>There is no solid body to measure yet.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
