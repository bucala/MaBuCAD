import { useEffect, useState } from "react";
import { Euler, MathUtils, Quaternion } from "three";

import { runRelinkComponent } from "@/commands/assemblyCommands";
import { useTranslation } from "@/i18n/useTranslation";
import {
  selectComponentNow,
  useActiveComponentGeometry,
  useSelectedComponentId,
  type ComponentGeometry,
} from "@/state/assemblyStore";
import { useDocumentStore } from "@/state/documentStore";
import type { AssemblyComponent, ComponentTransform } from "@/types/document";

import { FeatureTree } from "./FeatureTree";
import styles from "./AssemblyTree.module.css";

/** An Assembly's Feature Manager: its own origin planes (the usual feature tree) above the
 * component list, with actions and a numeric placement panel for the selected component. */
export function AssemblyManager() {
  return (
    <div className={styles.manager}>
      <div className={styles.origin}>
        <FeatureTree />
      </div>
      <AssemblyTree />
    </div>
  );
}

function AssemblyTree() {
  const { t } = useTranslation();
  const components = useDocumentStore((state) => state.document.assembly?.components ?? []);
  const geometry = useActiveComponentGeometry();
  const selectedId = useSelectedComponentId();
  const selected = components.find((component) => component.id === selectedId) ?? null;

  return (
    <div className={styles.components} data-testid="assembly-tree">
      <div className={styles.heading}>{t("assembly.tree.title", "Components")}</div>
      {components.length === 0 && (
        <div className={styles.empty}>
          {t("assembly.tree.empty", "No components yet. Insert a saved part with Insert Component.")}
        </div>
      )}
      <div role="tree" aria-label={t("assembly.tree.title", "Components")}>
        {components.map((component) => (
          <ComponentRow
            key={component.id}
            component={component}
            geometry={geometry[component.id]}
            selected={component.id === selectedId}
          />
        ))}
      </div>
      {selected && <ComponentActions component={selected} status={geometry[selected.id]?.status} />}
      {selected && <PlacementPanel component={selected} />}
    </div>
  );
}

function ComponentRow({
  component,
  geometry,
  selected,
}: {
  component: AssemblyComponent;
  geometry: ComponentGeometry | undefined;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const status = component.suppressed ? null : geometry?.status;

  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={selected}
      className={`${styles.row} ${component.suppressed ? styles.rowSuppressed : ""}`}
      title={geometry?.message ?? component.source.fileName}
      onClick={() => selectComponentNow(selected ? null : component.id)}
    >
      <span className={styles.name}>{component.name}</span>
      {component.grounded && <span className={styles.badge}>{t("assembly.tree.grounded", "Grounded")}</span>}
      {status === "loading" && <span className={styles.badge}>{t("assembly.tree.loading", "Loading…")}</span>}
      {status === "missing" && (
        <span className={`${styles.badge} ${styles.badgeWarning}`}>{t("assembly.tree.missing", "File missing")}</span>
      )}
      {status === "error" && (
        <span className={`${styles.badge} ${styles.badgeWarning}`}>{t("assembly.tree.error", "Error")}</span>
      )}
    </button>
  );
}

function ComponentActions({ component, status }: { component: AssemblyComponent; status?: ComponentGeometry["status"] }) {
  const { t } = useTranslation();
  const update = useDocumentStore((state) => state.updateComponent);

  return (
    <div className={styles.actions}>
      <button type="button" className={styles.action} onClick={() => void runRelinkComponent(component.id)}>
        {t("assembly.tree.relink", "Relink…")}
        {status === "missing" || status === "error" ? " ⚠" : ""}
      </button>
      <button
        type="button"
        className={styles.action}
        onClick={() => update(component.id, { grounded: !component.grounded })}
      >
        {component.grounded ? t("assembly.tree.float", "Float") : t("assembly.tree.ground", "Ground")}
      </button>
      <button
        type="button"
        className={styles.action}
        onClick={() => update(component.id, { suppressed: !component.suppressed })}
      >
        {component.suppressed ? t("assembly.tree.unsuppress", "Unsuppress") : t("assembly.tree.suppress", "Suppress")}
      </button>
      <button
        type="button"
        className={styles.action}
        onClick={() => {
          useDocumentStore.getState().removeComponent(component.id);
          selectComponentNow(null);
        }}
      >
        {t("assembly.tree.delete", "Delete")}
      </button>
    </div>
  );
}

const AXES = ["X", "Y", "Z"] as const;

function rotationDegrees(transform: ComponentTransform): [number, number, number] {
  const euler = new Euler().setFromQuaternion(new Quaternion(...transform.quaternion), "XYZ");
  return [euler.x, euler.y, euler.z].map((radians) => MathUtils.radToDeg(radians)) as [number, number, number];
}

/** Numeric placement: position in mm and rotation as XYZ Euler angles in degrees. A value
 * applies on Enter or when the field loses focus — one undo step per edited field, not per
 * keystroke. */
function PlacementPanel({ component }: { component: AssemblyComponent }) {
  const { t } = useTranslation();
  const { transform, grounded } = component;
  const rotation = rotationDegrees(transform);

  const setPosition = (axis: number, value: number) => {
    const position = [...transform.position] as ComponentTransform["position"];
    position[axis] = value;
    useDocumentStore.getState().setComponentTransform(component.id, { ...transform, position });
  };

  const setRotation = (axis: number, value: number) => {
    const degrees = [...rotation];
    degrees[axis] = value;
    const [x, y, z] = degrees.map((d) => MathUtils.degToRad(d));
    const q = new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ"));
    useDocumentStore.getState().setComponentTransform(component.id, {
      ...transform,
      quaternion: [q.x, q.y, q.z, q.w],
    });
  };

  return (
    <div className={styles.panel} data-testid="component-placement">
      <span className={styles.panelLabel}>{t("assembly.panel.position", "Position (mm)")}</span>
      {AXES.map((axis, index) => (
        <NumberField
          key={`p${axis}`}
          label={`${axis} position`}
          value={transform.position[index]!}
          disabled={grounded}
          onCommit={(value) => setPosition(index, value)}
        />
      ))}
      <span className={styles.panelLabel}>{t("assembly.panel.rotation", "Rotation (°)")}</span>
      {AXES.map((axis, index) => (
        <NumberField
          key={`r${axis}`}
          label={`${axis} rotation`}
          value={rotation[index]!}
          disabled={grounded}
          onCommit={(value) => setRotation(index, value)}
        />
      ))}
      {grounded && (
        <span className={styles.hint}>
          {t("assembly.panel.groundedHint", "A grounded component can't be moved. Float it to reposition it.")}
        </span>
      )}
      <span className={styles.hint}>
        {t("assembly.panel.source", "Source file")}: {component.source.path ?? component.source.fileName}
      </span>
    </div>
  );
}

function format(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function NumberField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(format(value));
  useEffect(() => setText(format(value)), [value]);

  const commit = () => {
    const parsed = Number(text.replace(",", "."));
    if (Number.isFinite(parsed) && format(parsed) !== format(value)) onCommit(parsed);
    else setText(format(value));
  };

  return (
    <input
      className={styles.panelInput}
      aria-label={label}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          setText(format(value));
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
