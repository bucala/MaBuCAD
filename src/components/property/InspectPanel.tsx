import { Fragment, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { computeGeometryCheck } from "@/kernel/checkGeometry";
import { faceAngleToAxis } from "@/kernel/faceColoring";
import { computeMassProperties, computeMeasureSummary, computeSectionProperties } from "@/kernel/measure";
import { useDocumentStore } from "@/state/documentStore";
import { evaluateExpression, isValidVariableName } from "@/state/equations";
import { useGeometryStore } from "@/state/geometryStore";
import { useInspectStore, type Axis, type InspectTool } from "@/state/inspectStore";
import type { Sensor, SensorOperator, SensorProperty } from "@/types/document";

import styles from "./InspectPanel.module.css";

const ENTITY_LABEL: Record<"face" | "edge", string> = { face: "Face", edge: "Edge" };
const VALUE_LABEL: Record<"face" | "edge", string> = { face: "Area", edge: "Length" };

const TOOL_TITLE: Record<Exclude<InspectTool, null>, string> = {
  measure: "Measure",
  mass: "Mass Properties",
  section: "Section Properties",
  geometry: "Check Geometry",
  "draft-analysis": "Draft Analysis",
  "parent-child": "Parent / Child",
  equations: "Equations",
  sensors: "Sensors",
  appearance: "Appearance",
};

/** Feature kinds that consume "whatever the current body is" rather than a recorded
 * parent — see `commandRegistry.ts`'s generic `FEATURE_COMMANDS` handler, which creates
 * these with an empty `parents` array because there is no single upstream feature id to
 * point at (the kernel fuses every feature above them into one body and dress-up features
 * act on that combined result). Parent/Child shows an honest note for these instead of a
 * bare "None", which would otherwise look like a real absence of dependency. */
const IMPLICIT_WHOLE_BODY_KINDS = new Set(["fillet", "chamfer", "shell", "draft"]);

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const SENSOR_PROPERTY_LABEL: Record<SensorProperty, string> = { volume: "Volume", area: "Surface area" };
const SENSOR_OPERATOR_LABEL: Record<SensorOperator, string> = { lt: "<", gt: ">", eq: "=" };

/**
 * Property manager contents while an Inspect tool has taken over the viewport. Each tool
 * gets its own section function below; all of them share this component's header/Escape/
 * Close handling, mirroring `SketchPanel.tsx`'s "own header + Exit button, sections below"
 * shape.
 */
export function InspectPanel() {
  const activeTool = useInspectStore((state) => state.activeTool);
  const closeInspect = useInspectStore((state) => state.closeInspect);

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

  if (!activeTool) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{TOOL_TITLE[activeTool]}</h2>
        <button type="button" className={styles.closeButton} aria-label="Close Inspect" onClick={closeInspect}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.body}>
        {activeTool === "measure" && <MeasureSection />}
        {activeTool === "mass" && <MassPropertiesSection />}
        {activeTool === "section" && <SectionPropertiesSection />}
        {activeTool === "geometry" && <CheckGeometrySection />}
        {activeTool === "draft-analysis" && <DraftAnalysisSection />}
        {activeTool === "parent-child" && <ParentChildSection />}
        {activeTool === "equations" && <EquationsSection />}
        {activeTool === "sensors" && <SensorsSection />}
        {activeTool === "appearance" && <AppearanceSection />}
      </div>
    </div>
  );
}

function MeasureSection() {
  const measurePicks = useInspectStore((state) => state.measurePicks);
  const clearMeasurePicks = useInspectStore((state) => state.clearMeasurePicks);
  const mesh = useGeometryStore((state) => state.mesh);

  // Recomputed whenever the committed mesh reference changes — the same trigger
  // `SolidModel.tsx` uses to know a rebuild actually happened. The kernel's own current
  // shape (`getCurrentShape()`) only ever reflects the *latest* rebuild, so this can't be
  // computed once and cached across edits.
  const measureSummary = useMemo(() => computeMeasureSummary(measurePicks), [measurePicks, mesh]);

  return (
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
  );
}

function MassPropertiesSection() {
  const mesh = useGeometryStore((state) => state.mesh);
  const massProperties = useMemo(() => computeMassProperties(), [mesh]);

  return (
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
  );
}

function SectionPropertiesSection() {
  const sectionFacePick = useInspectStore((state) => state.sectionFacePick);
  const clearSectionPick = useInspectStore((state) => state.clearSectionPick);
  const mesh = useGeometryStore((state) => state.mesh);

  const properties = useMemo(
    () => (sectionFacePick === null ? null : computeSectionProperties(sectionFacePick)),
    [sectionFacePick, mesh],
  );

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Section Properties</h3>
      <p className={styles.hint}>
        {sectionFacePick === null ? "Click a planar face in the 3D view." : "Click another face to switch to it."}
      </p>

      {sectionFacePick !== null && !properties && (
        <p className={styles.hint}>That face no longer exists — pick another one.</p>
      )}

      {properties && (
        <>
          <dl className={styles.stats}>
            <dt>Area</dt>
            <dd>{formatNumber(properties.area)} mm²</dd>
            <dt>Centroid X</dt>
            <dd>{formatNumber(properties.centroid[0])} mm</dd>
            <dt>Centroid Y</dt>
            <dd>{formatNumber(properties.centroid[1])} mm</dd>
            <dt>Centroid Z</dt>
            <dd>{formatNumber(properties.centroid[2])} mm</dd>
            <dt>Surface type</dt>
            <dd>{properties.surfaceType}</dd>
          </dl>
          {properties.surfaceType !== "PLANE" && (
            <p className={styles.hint}>
              This face isn't planar — area and centroid are still exact, but a "planar" reading (e.g. a single
              flat centroid) is only fully meaningful for one that is.
            </p>
          )}
          <button type="button" className={styles.clearButton} onClick={clearSectionPick}>
            Clear
          </button>
        </>
      )}
    </section>
  );
}

function CheckGeometrySection() {
  const mesh = useGeometryStore((state) => state.mesh);
  const result = useMemo(() => computeGeometryCheck(), [mesh]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Check Geometry</h3>
      {!result ? (
        <p className={styles.hint}>There is no solid body to check yet.</p>
      ) : (
        <>
          <dl className={styles.stats}>
            <dt>Faces</dt>
            <dd>{result.faceCount}</dd>
            <dt>Edges</dt>
            <dd>{result.edgeCount}</dd>
          </dl>
          {result.issues.length === 0 ? (
            <p className={styles.statusOk}>No issues found.</p>
          ) : (
            <ul className={styles.issueList}>
              {result.issues.map((issue) => (
                <li key={issue} className={styles.statusAlert}>
                  {issue}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>
            Checks every face and edge for zero area/length — the OpenCascade build this app ships exposes no
            full topology validator, so self-intersections and non-manifold edges aren't covered.
          </p>
        </>
      )}
    </section>
  );
}

const AXIS_OPTIONS: Axis[] = ["x", "y", "z"];

function DraftAnalysisSection() {
  const draftAxis = useInspectStore((state) => state.draftAxis);
  const setDraftAxis = useInspectStore((state) => state.setDraftAxis);
  const draftLimitDegrees = useInspectStore((state) => state.draftLimitDegrees);
  const setDraftLimitDegrees = useInspectStore((state) => state.setDraftLimitDegrees);
  const [limitText, setLimitText] = useState(() => String(draftLimitDegrees));
  const mesh = useGeometryStore((state) => state.mesh);

  const summary = useMemo(() => {
    if (!mesh) return null;
    let unsafe = 0;
    for (const group of mesh.faceGroups) {
      const angleToAxis = faceAngleToAxis(mesh, group.id, draftAxis);
      if (angleToAxis === null) continue;
      if (Math.abs(90 - angleToAxis) < draftLimitDegrees) unsafe += 1;
    }
    return { total: mesh.faceGroups.length, unsafe };
  }, [mesh, draftAxis, draftLimitDegrees]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Draft Analysis</h3>

      <div className={styles.modifyRow}>
        <span className={styles.modifyLabel}>Pull direction</span>
        <div className={styles.buttonRow}>
          {AXIS_OPTIONS.map((axis) => (
            <button
              key={axis}
              type="button"
              className={styles.toolButton}
              aria-pressed={draftAxis === axis}
              onClick={() => setDraftAxis(axis)}
            >
              {axis.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.modifyRow}>
        <span className={styles.modifyLabel}>Limit (deg)</span>
        <input
          className={styles.modifyInput}
          type="text"
          inputMode="decimal"
          aria-label="Draft angle limit in degrees"
          value={limitText}
          onChange={(event) => {
            const text = event.target.value;
            setLimitText(text);
            const parsed = Number(text.replace(",", "."));
            if (Number.isFinite(parsed) && parsed >= 0) setDraftLimitDegrees(parsed);
          }}
        />
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchSafe}`} /> Draft ≥ limit
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchUnsafe}`} /> Needs more draft
        </span>
      </div>

      {summary && (
        <p className={styles.hint}>
          {summary.unsafe} of {summary.total} faces need more draft along this axis.
        </p>
      )}
      {!mesh && <p className={styles.hint}>There is no solid body to analyse yet.</p>}
    </section>
  );
}

function ParentChildSection() {
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const features = useDocumentStore((state) => state.document.features);

  const feature = selectedFeatureIds.length === 1 ? features.find((f) => f.id === selectedFeatureIds[0]) : undefined;

  const nameById = useMemo(() => new Map(features.map((f) => [f.id, f.name])), [features]);

  if (!feature) {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Parent / Child</h3>
        <p className={styles.hint}>Select a single feature in the Feature Manager to see its dependencies.</p>
      </section>
    );
  }

  const children = features.filter((candidate) => candidate.parents.includes(feature.id));

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{feature.name}</h3>

      <h4 className={styles.subTitle}>Parents</h4>
      {feature.parents.length > 0 ? (
        <ul className={styles.list}>
          {feature.parents.map((id) => (
            <li key={id}>{nameById.get(id) ?? id}</li>
          ))}
        </ul>
      ) : IMPLICIT_WHOLE_BODY_KINDS.has(feature.kind) ? (
        <p className={styles.hint}>Depends on the whole body — every feature above it in the tree.</p>
      ) : (
        <p className={styles.hint}>None.</p>
      )}

      <h4 className={styles.subTitle}>Children</h4>
      {children.length > 0 ? (
        <ul className={styles.list}>
          {children.map((child) => (
            <li key={child.id}>{child.name}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>None.</p>
      )}
    </section>
  );
}

function EquationsSection() {
  const variables = useDocumentStore((state) => state.document.variables ?? {});
  const setVariable = useDocumentStore((state) => state.setVariable);
  const deleteVariable = useDocumentStore((state) => state.deleteVariable);

  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmedName = name.trim();
    if (!isValidVariableName(trimmedName)) {
      setError("Name must start with a letter or underscore, and contain only letters, digits and underscores.");
      return;
    }
    const value = evaluateExpression(expression, variables);
    if (value === null) {
      setError("That doesn't evaluate to a number — check for a typo or an undefined variable.");
      return;
    }
    setVariable(trimmedName, value);
    setError(null);
    setName("");
    setExpression("");
  };

  const entries = Object.entries(variables).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Equations</h3>
      <p className={styles.hint}>
        Define a named number here, then type <code>=name</code> (or an expression using one, like{" "}
        <code>=width*2</code>) into a sketch dimension's value field to drive it from this variable.
      </p>

      <div className={styles.modifyRow}>
        <input
          className={styles.modifyInput}
          type="text"
          aria-label="Variable name"
          placeholder="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className={styles.modifyInput}
          type="text"
          aria-label="Variable expression"
          placeholder="value or expression"
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
        />
        <button type="button" className={styles.modifyApply} onClick={handleAdd}>
          Set
        </button>
      </div>
      {error && <p className={styles.statusAlert}>{error}</p>}

      {entries.length > 0 ? (
        <dl className={styles.stats}>
          {entries.map(([variableName, value]) => (
            <Fragment key={variableName}>
              <dt>{variableName}</dt>
              <dd>
                {formatNumber(value)}
                <button
                  type="button"
                  className={styles.rowDeleteButton}
                  aria-label={`Delete ${variableName}`}
                  onClick={() => deleteVariable(variableName)}
                >
                  ×
                </button>
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className={styles.hint}>No variables defined yet.</p>
      )}
    </section>
  );
}

function SensorsSection() {
  const sensors = useDocumentStore((state) => state.document.sensors ?? []);
  const addSensor = useDocumentStore((state) => state.addSensor);
  const deleteSensor = useDocumentStore((state) => state.deleteSensor);

  const [name, setName] = useState("");
  const [property, setProperty] = useState<SensorProperty>("volume");
  const [operator, setOperator] = useState<SensorOperator>("gt");
  const [thresholdText, setThresholdText] = useState("0");

  const handleAdd = () => {
    const threshold = Number(thresholdText.replace(",", "."));
    if (!Number.isFinite(threshold)) return;
    addSensor({
      name: name.trim() || `Sensor ${sensors.length + 1}`,
      property,
      operator,
      threshold,
    });
    setName("");
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Sensors</h3>
      <p className={styles.hint}>
        Alerts (a toast, plus the status below) whenever the watched property crosses the threshold on a rebuild.
      </p>

      <div className={styles.modifyGroup}>
        <input
          className={styles.modifyInput}
          type="text"
          aria-label="Sensor name"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className={styles.modifyRow}>
          <select
            className={styles.modifyInput}
            aria-label="Watched property"
            value={property}
            onChange={(event) => setProperty(event.target.value as SensorProperty)}
          >
            <option value="volume">Volume</option>
            <option value="area">Surface area</option>
          </select>
          <select
            className={styles.modifyInput}
            aria-label="Alert condition"
            value={operator}
            onChange={(event) => setOperator(event.target.value as SensorOperator)}
          >
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
            <option value="eq">=</option>
          </select>
          <input
            className={styles.modifyInput}
            type="text"
            inputMode="decimal"
            aria-label="Alert threshold"
            value={thresholdText}
            onChange={(event) => setThresholdText(event.target.value)}
          />
        </div>
        <button type="button" className={styles.modifyApplyFull} onClick={handleAdd}>
          Add Sensor
        </button>
      </div>

      {sensors.length > 0 ? (
        <ul className={styles.list}>
          {sensors.map((sensor) => (
            <SensorRow key={sensor.id} sensor={sensor} onDelete={() => deleteSensor(sensor.id)} />
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>No sensors defined yet.</p>
      )}
    </section>
  );
}

function SensorRow({ sensor, onDelete }: { sensor: Sensor; onDelete: () => void }) {
  return (
    <li className={styles.sensorRow}>
      <span className={styles.sensorLabel}>
        {sensor.name}: {SENSOR_PROPERTY_LABEL[sensor.property]} {SENSOR_OPERATOR_LABEL[sensor.operator]}{" "}
        {formatNumber(sensor.threshold)}
      </span>
      <span
        className={
          sensor.lastStatus === "alert"
            ? styles.statusAlert
            : sensor.lastStatus === "ok"
              ? styles.statusOk
              : styles.hint
        }
      >
        {sensor.lastStatus === "alert" ? "Alert" : sensor.lastStatus === "ok" ? "OK" : "—"}
      </span>
      <button type="button" className={styles.rowDeleteButton} aria-label={`Delete sensor ${sensor.name}`} onClick={onDelete}>
        ×
      </button>
    </li>
  );
}

const APPEARANCE_SWATCHES = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#64748b"];

function AppearanceSection() {
  const appearanceColor = useInspectStore((state) => state.appearanceColor);
  const setAppearanceColor = useInspectStore((state) => state.setAppearanceColor);
  const faceColors = useInspectStore((state) => state.faceColors);
  const clearAllFaceColors = useInspectStore((state) => state.clearAllFaceColors);

  const paintedCount = Object.keys(faceColors).length;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Appearance</h3>
      <p className={styles.hint}>
        Pick a colour, then click faces in the 3D view to paint them. Clicking a face already in that colour clears
        it.
      </p>

      <div className={styles.colorSwatchGrid}>
        {APPEARANCE_SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.colorSwatch}
            style={{ backgroundColor: color }}
            aria-pressed={appearanceColor === color}
            aria-label={`Paint colour ${color}`}
            onClick={() => setAppearanceColor(color)}
          />
        ))}
        <input
          type="color"
          className={styles.colorPicker}
          aria-label="Custom paint colour"
          value={appearanceColor}
          onChange={(event) => setAppearanceColor(event.target.value)}
        />
      </div>

      <p className={styles.hint}>{paintedCount === 0 ? "No faces painted yet." : `${paintedCount} face(s) painted.`}</p>

      {paintedCount > 0 && (
        <button type="button" className={styles.clearButton} onClick={clearAllFaceColors}>
          Clear All
        </button>
      )}
    </section>
  );
}
