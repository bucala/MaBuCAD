import { Fragment, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { computeGeometryCheck } from "@/kernel/checkGeometry";
import { faceAngleToAxis } from "@/kernel/faceColoring";
import { computeMassProperties, computeMeasureSummary, computeSectionProperties } from "@/kernel/measure";
import { fillTemplate, useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { evaluateExpression, isValidVariableName } from "@/state/equations";
import { useGeometryStore } from "@/state/geometryStore";
import { useInspectStore, type Axis, type InspectTool } from "@/state/inspectStore";
import type { Sensor, SensorOperator, SensorProperty } from "@/types/document";

import styles from "./InspectPanel.module.css";

const ENTITY_LABEL: Record<"face" | "edge", string> = { face: "Face", edge: "Edge" };
const VALUE_LABEL: Record<"face" | "edge", string> = { face: "Area", edge: "Length" };

/** Section title per tool — the value reuses the matching `inspect.*` command key, so the
 * ribbon button and the panel it opens always show the same words. */
const TOOL_TITLE: Record<Exclude<InspectTool, null>, { key: string; label: string }> = {
  measure: { key: "inspect.measure", label: "Measure" },
  mass: { key: "inspect.mass", label: "Mass Properties" },
  section: { key: "inspect.section", label: "Section Properties" },
  geometry: { key: "inspect.geometry", label: "Check Geometry" },
  "draft-analysis": { key: "inspect.draft-analysis", label: "Draft Analysis" },
  "parent-child": { key: "inspect.parent-child", label: "Parent / Child" },
  equations: { key: "inspect.equations", label: "Equations" },
  sensors: { key: "inspect.sensors", label: "Sensors" },
  appearance: { key: "inspect.appearance", label: "Appearance" },
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
const SENSOR_PROPERTY_KEY: Record<SensorProperty, string> = {
  volume: "inspectPanel.volume",
  area: "inspectPanel.surfaceArea",
};
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
  const { t } = useTranslation();

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
        <h2 className={styles.title}>{t(TOOL_TITLE[activeTool].key, TOOL_TITLE[activeTool].label)}</h2>
        <button
          type="button"
          className={styles.closeButton}
          aria-label={t("inspectPanel.closeAria", "Close Inspect")}
          onClick={closeInspect}
        >
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
  const { t } = useTranslation();

  // Recomputed whenever the committed mesh reference changes — the same trigger
  // `SolidModel.tsx` uses to know a rebuild actually happened. The kernel's own current
  // shape (`getCurrentShape()`) only ever reflects the *latest* rebuild, so this can't be
  // computed once and cached across edits.
  const measureSummary = useMemo(
    () => computeMeasureSummary(measurePicks),
    // `mesh` is the rebuild signal, not an input — see the comment above; dropping it
    // would keep stale measurements on screen after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measurePicks, mesh],
  );

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("inspectPanel.pickedEntities", "Picked Entities")}</h3>
      <p className={styles.hint}>
        {measurePicks.length === 0
          ? t("inspectPanel.measureHintNone", "Click a face or edge in the 3D view.")
          : measurePicks.length === 1
            ? t(
                "inspectPanel.measureHintOne",
                "Click a second face or edge to measure the distance between them.",
              )
            : t(
                "inspectPanel.measureHintTwo",
                "Click either one again to replace it, or Clear to start over.",
              )}
      </p>

      {!measureSummary && measurePicks.length > 0 && (
        <p className={styles.hint}>
          {t(
            "inspectPanel.measureStale",
            "One of the picked entities no longer exists — Clear and pick again.",
          )}
        </p>
      )}

      {measureSummary && measureSummary.picks.length > 0 && (
        <dl className={styles.stats}>
          {measureSummary.picks.map((pick, index) => (
            <Fragment key={`${pick.kind}-${pick.id}`}>
              <dt>
                {t(pick.kind === "face" ? "inspectPanel.face" : "inspectPanel.edge", ENTITY_LABEL[pick.kind])}{" "}
                {index + 1} —{" "}
                {t(pick.kind === "face" ? "inspectPanel.area" : "inspectPanel.length", VALUE_LABEL[pick.kind])}
              </dt>
              <dd>
                {formatNumber(pick.value)} {pick.kind === "face" ? "mm²" : "mm"}
              </dd>
            </Fragment>
          ))}
          {measureSummary.distance !== null && (
            <Fragment>
              <dt>{t("inspectPanel.distance", "Distance")}</dt>
              <dd>{formatNumber(measureSummary.distance)} mm</dd>
            </Fragment>
          )}
        </dl>
      )}

      {measurePicks.length > 0 && (
        <button type="button" className={styles.clearButton} onClick={clearMeasurePicks}>
          {t("inspectPanel.clear", "Clear")}
        </button>
      )}
    </section>
  );
}

function MassPropertiesSection() {
  const mesh = useGeometryStore((state) => state.mesh);
  const { t } = useTranslation();
  // `mesh` is the rebuild signal, not an input: the computation reads the kernel's
  // current shape (`getCurrentShape()`), which only ever reflects the latest rebuild —
  // the same pattern the Measure section documents above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const massProperties = useMemo(() => computeMassProperties(), [mesh]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("inspect.mass", "Mass Properties")}</h3>
      {massProperties ? (
        <dl className={styles.stats}>
          <dt>{t("inspectPanel.volume", "Volume")}</dt>
          <dd>{formatNumber(massProperties.volume)} mm³</dd>
          <dt>{t("inspectPanel.surfaceArea", "Surface area")}</dt>
          <dd>{formatNumber(massProperties.area)} mm²</dd>
          <dt>
            {t("inspectPanel.centerOfMass", "Centre of mass")} X
          </dt>
          <dd>{formatNumber(massProperties.centerOfMass[0])} mm</dd>
          <dt>
            {t("inspectPanel.centerOfMass", "Centre of mass")} Y
          </dt>
          <dd>{formatNumber(massProperties.centerOfMass[1])} mm</dd>
          <dt>
            {t("inspectPanel.centerOfMass", "Centre of mass")} Z
          </dt>
          <dd>{formatNumber(massProperties.centerOfMass[2])} mm</dd>
        </dl>
      ) : (
        <p className={styles.hint}>{t("inspectPanel.noBodyMeasure", "There is no solid body to measure yet.")}</p>
      )}
    </section>
  );
}

function SectionPropertiesSection() {
  const sectionFacePick = useInspectStore((state) => state.sectionFacePick);
  const clearSectionPick = useInspectStore((state) => state.clearSectionPick);
  const mesh = useGeometryStore((state) => state.mesh);
  const { t } = useTranslation();

  const properties = useMemo(
    () => (sectionFacePick === null ? null : computeSectionProperties(sectionFacePick)),
    // `mesh` is the rebuild signal, not an input — see the Measure section's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionFacePick, mesh],
  );

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("inspect.section", "Section Properties")}</h3>
      <p className={styles.hint}>
        {sectionFacePick === null
          ? t("inspectPanel.sectionHintNone", "Click a planar face in the 3D view.")
          : t("inspectPanel.sectionHintSwitch", "Click another face to switch to it.")}
      </p>

      {sectionFacePick !== null && !properties && (
        <p className={styles.hint}>{t("inspectPanel.sectionStale", "That face no longer exists — pick another one.")}</p>
      )}

      {properties && (
        <>
          <dl className={styles.stats}>
            <dt>{t("inspectPanel.area", "Area")}</dt>
            <dd>{formatNumber(properties.area)} mm²</dd>
            <dt>
              {t("inspectPanel.centroid", "Centroid")} X
            </dt>
            <dd>{formatNumber(properties.centroid[0])} mm</dd>
            <dt>
              {t("inspectPanel.centroid", "Centroid")} Y
            </dt>
            <dd>{formatNumber(properties.centroid[1])} mm</dd>
            <dt>
              {t("inspectPanel.centroid", "Centroid")} Z
            </dt>
            <dd>{formatNumber(properties.centroid[2])} mm</dd>
            <dt>{t("inspectPanel.surfaceType", "Surface type")}</dt>
            <dd>{properties.surfaceType}</dd>
          </dl>
          {properties.surfaceType !== "PLANE" && (
            <p className={styles.hint}>
              {t(
                "inspectPanel.sectionNonPlanar",
                "This face isn't planar — area and centroid are still exact, but a \"planar\" reading (e.g. a single flat centroid) is only fully meaningful for one that is.",
              )}
            </p>
          )}
          <button type="button" className={styles.clearButton} onClick={clearSectionPick}>
            {t("inspectPanel.clear", "Clear")}
          </button>
        </>
      )}
    </section>
  );
}

function CheckGeometrySection() {
  const mesh = useGeometryStore((state) => state.mesh);
  const { t } = useTranslation();
  // `mesh` is the rebuild signal, not an input — see the Measure section's comment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => computeGeometryCheck(), [mesh]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("inspect.geometry", "Check Geometry")}</h3>
      {!result ? (
        <p className={styles.hint}>{t("inspectPanel.noBodyCheck", "There is no solid body to check yet.")}</p>
      ) : (
        <>
          <dl className={styles.stats}>
            <dt>{t("inspectPanel.faces", "Faces")}</dt>
            <dd>{result.faceCount}</dd>
            <dt>{t("inspectPanel.edges", "Edges")}</dt>
            <dd>{result.edgeCount}</dd>
          </dl>
          {result.issues.length === 0 ? (
            <p className={styles.statusOk}>{t("inspectPanel.noIssues", "No issues found.")}</p>
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
            {t(
              "inspectPanel.geometryHint",
              "Checks every face and edge for zero area/length — the OpenCascade build this app ships exposes no full topology validator, so self-intersections and non-manifold edges aren't covered.",
            )}
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
  const { t } = useTranslation();

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
      <h3 className={styles.sectionTitle}>{t("inspect.draft-analysis", "Draft Analysis")}</h3>

      <div className={styles.modifyRow}>
        <span className={styles.modifyLabel}>{t("inspectPanel.pullDirection", "Pull direction")}</span>
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
        <span className={styles.modifyLabel}>{t("inspectPanel.limitDeg", "Limit (deg)")}</span>
        <input
          className={styles.modifyInput}
          type="text"
          inputMode="decimal"
          aria-label={t("inspectPanel.limitDeg", "Draft angle limit in degrees")}
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
          <span className={`${styles.legendSwatch} ${styles.legendSwatchSafe}`} />{" "}
          {t("inspectPanel.draftLimit", "Draft ≥ limit")}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchUnsafe}`} />{" "}
          {t("inspectPanel.needsMoreDraft", "Needs more draft")}
        </span>
      </div>

      {summary && (
        <p className={styles.hint}>
          {fillTemplate(
            t(
              "inspectPanel.draftSummary",
              "{{unsafe}} of {{total}} faces need more draft along this axis.",
            ),
            { unsafe: summary.unsafe, total: summary.total },
          )}
        </p>
      )}
      {!mesh && <p className={styles.hint}>{t("inspectPanel.noBodyAnalyse", "There is no solid body to analyse yet.")}</p>}
    </section>
  );
}

function ParentChildSection() {
  const selectedFeatureIds = useDocumentStore((state) => state.selectedFeatureIds);
  const features = useDocumentStore((state) => state.document.features);
  const { t } = useTranslation();

  const feature = selectedFeatureIds.length === 1 ? features.find((f) => f.id === selectedFeatureIds[0]) : undefined;

  const nameById = useMemo(() => new Map(features.map((f) => [f.id, f.name])), [features]);

  if (!feature) {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("inspect.parent-child", "Parent / Child")}</h3>
        <p className={styles.hint}>
          {t(
            "inspectPanel.parentChildHint",
            "Select a single feature in the Feature Manager to see its dependencies.",
          )}
        </p>
      </section>
    );
  }

  const children = features.filter((candidate) => candidate.parents.includes(feature.id));

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{feature.name}</h3>

      <h4 className={styles.subTitle}>{t("inspectPanel.parents", "Parents")}</h4>
      {feature.parents.length > 0 ? (
        <ul className={styles.list}>
          {feature.parents.map((id) => (
            <li key={id}>{nameById.get(id) ?? id}</li>
          ))}
        </ul>
      ) : IMPLICIT_WHOLE_BODY_KINDS.has(feature.kind) ? (
        <p className={styles.hint}>
          {t("inspectPanel.wholeBody", "Depends on the whole body — every feature above it in the tree.")}
        </p>
      ) : (
        <p className={styles.hint}>{t("inspectPanel.none", "None.")}</p>
      )}

      <h4 className={styles.subTitle}>{t("inspectPanel.children", "Children")}</h4>
      {children.length > 0 ? (
        <ul className={styles.list}>
          {children.map((child) => (
            <li key={child.id}>{child.name}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>{t("inspectPanel.none", "None.")}</p>
      )}
    </section>
  );
}

function EquationsSection() {
  const variables = useDocumentStore((state) => state.document.variables ?? {});
  const setVariable = useDocumentStore((state) => state.setVariable);
  const deleteVariable = useDocumentStore((state) => state.deleteVariable);
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmedName = name.trim();
    if (!isValidVariableName(trimmedName)) {
      setError(
        t(
          "inspectPanel.invalidName",
          "Name must start with a letter or underscore, and contain only letters, digits and underscores.",
        ),
      );
      return;
    }
    const value = evaluateExpression(expression, variables);
    if (value === null) {
      setError(
        t(
          "inspectPanel.notANumber",
          "That doesn't evaluate to a number — check for a typo or an undefined variable.",
        ),
      );
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
      <h3 className={styles.sectionTitle}>{t("inspect.equations", "Equations")}</h3>
      <p className={styles.hint}>
        {t(
          "inspectPanel.equationsHintPrefix",
          "Define a named number here, then type ",
        )}
        <code>=name</code>
        {t("inspectPanel.equationsHintMiddle", " (or an expression using one, like ")}
        <code>=width*2</code>
        {t(
          "inspectPanel.equationsHintSuffix",
          ") into a sketch dimension's value field to drive it from this variable.",
        )}
      </p>

      <div className={styles.modifyRow}>
        <input
          className={styles.modifyInput}
          type="text"
          aria-label={t("inspectPanel.variableNameAria", "Variable name")}
          placeholder={t("inspectPanel.variableNamePlaceholder", "name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className={styles.modifyInput}
          type="text"
          aria-label={t("inspectPanel.variableExpressionAria", "Variable expression")}
          placeholder={t("inspectPanel.variableExpressionPlaceholder", "value or expression")}
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
        />
        <button type="button" className={styles.modifyApply} onClick={handleAdd}>
          {t("inspectPanel.set", "Set")}
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
                  aria-label={`${t("inspectPanel.deleteVariable", "Delete variable")} ${variableName}`}
                  onClick={() => deleteVariable(variableName)}
                >
                  ×
                </button>
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className={styles.hint}>{t("inspectPanel.noVariables", "No variables defined yet.")}</p>
      )}
    </section>
  );
}

function SensorsSection() {
  const sensors = useDocumentStore((state) => state.document.sensors ?? []);
  const addSensor = useDocumentStore((state) => state.addSensor);
  const deleteSensor = useDocumentStore((state) => state.deleteSensor);
  const { t } = useTranslation();

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
      <h3 className={styles.sectionTitle}>{t("inspect.sensors", "Sensors")}</h3>
      <p className={styles.hint}>
        {t(
          "inspectPanel.sensorsHint",
          "Alerts (a toast, plus the status below) whenever the watched property crosses the threshold on a rebuild.",
        )}
      </p>

      <div className={styles.modifyGroup}>
        <input
          className={styles.modifyInput}
          type="text"
          aria-label={t("inspectPanel.sensorNameAria", "Sensor name")}
          placeholder={t("inspectPanel.sensorNamePlaceholder", "Name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className={styles.modifyRow}>
          <select
            className={styles.modifyInput}
            aria-label={t("inspectPanel.watchedPropertyAria", "Watched property")}
            value={property}
            onChange={(event) => setProperty(event.target.value as SensorProperty)}
          >
            <option value="volume">{t("inspectPanel.volume", "Volume")}</option>
            <option value="area">{t("inspectPanel.surfaceArea", "Surface area")}</option>
          </select>
          <select
            className={styles.modifyInput}
            aria-label={t("inspectPanel.alertConditionAria", "Alert condition")}
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
            aria-label={t("inspectPanel.alertThresholdAria", "Alert threshold")}
            value={thresholdText}
            onChange={(event) => setThresholdText(event.target.value)}
          />
        </div>
        <button type="button" className={styles.modifyApplyFull} onClick={handleAdd}>
          {t("inspectPanel.addSensor", "Add Sensor")}
        </button>
      </div>

      {sensors.length > 0 ? (
        <ul className={styles.list}>
          {sensors.map((sensor) => (
            <SensorRow key={sensor.id} sensor={sensor} onDelete={() => deleteSensor(sensor.id)} />
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>{t("inspectPanel.noSensors", "No sensors defined yet.")}</p>
      )}
    </section>
  );
}

function SensorRow({ sensor, onDelete }: { sensor: Sensor; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <li className={styles.sensorRow}>
      <span className={styles.sensorLabel}>
        {sensor.name}: {t(SENSOR_PROPERTY_KEY[sensor.property], SENSOR_PROPERTY_LABEL[sensor.property])}{" "}
        {SENSOR_OPERATOR_LABEL[sensor.operator]} {formatNumber(sensor.threshold)}
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
        {sensor.lastStatus === "alert"
          ? t("inspectPanel.alert", "Alert")
          : sensor.lastStatus === "ok"
            ? t("inspectPanel.ok", "OK")
            : "—"}
      </span>
      <button
        type="button"
        className={styles.rowDeleteButton}
        aria-label={`${t("inspectPanel.deleteSensor", "Delete sensor")} ${sensor.name}`}
        onClick={onDelete}
      >
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
  const { t } = useTranslation();

  const paintedCount = Object.keys(faceColors).length;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("inspect.appearance", "Appearance")}</h3>
      <p className={styles.hint}>
        {t(
          "inspectPanel.appearanceHint",
          "Pick a colour, then click faces in the 3D view to paint them. Clicking a face already in that colour clears it.",
        )}
      </p>

      <div className={styles.colorSwatchGrid}>
        {APPEARANCE_SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.colorSwatch}
            style={{ backgroundColor: color }}
            aria-pressed={appearanceColor === color}
            aria-label={`${t("inspectPanel.paintColour", "Paint colour")} ${color}`}
            onClick={() => setAppearanceColor(color)}
          />
        ))}
        <input
          type="color"
          className={styles.colorPicker}
          aria-label={t("inspectPanel.customPaintColour", "Custom paint colour")}
          value={appearanceColor}
          onChange={(event) => setAppearanceColor(event.target.value)}
        />
      </div>

      <p className={styles.hint}>
        {paintedCount === 0
          ? t("inspectPanel.noPaintedFaces", "No faces painted yet.")
          : fillTemplate(t("inspectPanel.paintedFaces", "{{count}} face(s) painted."), { count: paintedCount })}
      </p>

      {paintedCount > 0 && (
        <button type="button" className={styles.clearButton} onClick={clearAllFaceColors}>
          {t("inspectPanel.clearAll", "Clear All")}
        </button>
      )}
    </section>
  );
}
