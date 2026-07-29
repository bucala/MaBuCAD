import { create } from "zustand";

import type { CadDocument, Feature, FeatureKind, FeatureParameters } from "@/types/document";
import type { SketchStatus, UnitSystemId } from "@/types/ui";

import { FEATURE_CATALOG } from "./featureCatalog";

/** Ids of the default planes, shared with the viewport so tree and 3D selection agree. */
export const DEFAULT_PLANE_IDS = ["plane-front", "plane-top", "plane-right"] as const;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function createDefaultFeatures(): Feature[] {
  const base = { suppressed: false, isDefault: true, parents: [], parameters: {} };

  return [
    { ...base, id: "annotations", kind: "annotations", name: "Annotations" },
    { ...base, id: "material", kind: "material", name: "Material <not specified>" },
    { ...base, id: "plane-front", kind: "plane", name: "Front Plane" },
    { ...base, id: "plane-top", kind: "plane", name: "Top Plane" },
    { ...base, id: "plane-right", kind: "plane", name: "Right Plane" },
    { ...base, id: "origin", kind: "origin", name: "Origin" },
  ];
}

function createDocument(): CadDocument {
  const features = createDefaultFeatures();
  return {
    id: nextId("doc"),
    name: "Part1",
    kind: "part",
    features,
    rollbackIndex: features.length,
  };
}

/**
 * Picks the next free name for a kind, e.g. "Boss-Extrude3".
 *
 * Numbering scans the existing names rather than keeping a counter, so deleting
 * "Boss-Extrude2" and adding another reuses the gap — which is what users expect and
 * what avoids ever-climbing numbers in a long editing session.
 */
function nextFeatureName(features: Feature[], kind: FeatureKind): string {
  const { namePrefix } = FEATURE_CATALOG[kind];
  const taken = new Set(features.map((feature) => feature.name));

  for (let index = 1; ; index += 1) {
    const candidate = `${namePrefix}${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** How many default features every document starts with — the rollback floor. */
const DEFAULT_FEATURE_COUNT = createDefaultFeatures().length;

const HISTORY_LIMIT = 50;

interface DocumentStore {
  document: CadDocument;
  selectedFeatureIds: string[];
  unitSystem: UnitSystemId;
  /** Set once the sketcher lands in Step 4. */
  activeSketchId: string | null;

  past: CadDocument[];
  future: CadDocument[];

  addFeature: (kind: FeatureKind, parameters?: FeatureParameters) => string;
  renameFeature: (id: string, name: string) => void;
  deleteFeature: (id: string) => void;
  toggleSuppressed: (id: string) => void;
  updateParameters: (id: string, parameters: FeatureParameters) => void;

  setRollbackIndex: (index: number) => void;
  rollbackToBefore: (id: string) => void;
  rollForwardOne: () => void;
  rollBackOne: () => void;
  rollToEnd: () => void;

  selectFeature: (id: string | null, additive?: boolean) => void;
  clearSelection: () => void;

  renameDocument: (name: string) => void;
  setUnitSystem: (unitSystem: UnitSystemId) => void;

  undo: () => void;
  redo: () => void;
}

export const useDocumentStore = create<DocumentStore>((set, get) => {
  /**
   * Applies a change to the document and records the previous state for undo.
   *
   * Every mutation goes through here so history stays complete; selection and unit
   * changes deliberately do not, since undoing a click is surprising.
   */
  const commit = (mutate: (document: CadDocument) => CadDocument) => {
    const { document, past } = get();
    const next = mutate(document);
    if (next === document) return;

    set({
      document: next,
      past: [...past, document].slice(-HISTORY_LIMIT),
      future: [],
    });
  };

  return {
    document: createDocument(),
    selectedFeatureIds: [],
    unitSystem: "MMGS",
    activeSketchId: null,
    past: [],
    future: [],

    addFeature: (kind, parameters) => {
      const id = nextId(kind);

      commit((document) => {
        const feature: Feature = {
          id,
          kind,
          name: nextFeatureName(document.features, kind),
          suppressed: false,
          isDefault: false,
          parents: [],
          parameters: { ...FEATURE_CATALOG[kind].defaultParameters, ...parameters },
        };

        // New features land at the rollback bar, not at the end of the list — inserting
        // below a rolled-back bar is how history-based modellers let you edit mid-history.
        const features = [...document.features];
        features.splice(document.rollbackIndex, 0, feature);

        return { ...document, features, rollbackIndex: document.rollbackIndex + 1 };
      });

      set({ selectedFeatureIds: [id] });
      return id;
    },

    renameFeature: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      commit((document) => {
        const target = document.features.find((feature) => feature.id === id);
        if (!target || target.name === trimmed) return document;

        return {
          ...document,
          features: document.features.map((feature) =>
            feature.id === id ? { ...feature, name: trimmed } : feature,
          ),
        };
      });
    },

    deleteFeature: (id) => {
      commit((document) => {
        const index = document.features.findIndex((feature) => feature.id === id);
        if (index === -1 || document.features[index].isDefault) return document;

        // Anything built on the deleted feature goes with it, since a parametric child
        // cannot rebuild without its parent.
        const doomed = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const feature of document.features) {
            if (!doomed.has(feature.id) && feature.parents.some((parent) => doomed.has(parent))) {
              doomed.add(feature.id);
              changed = true;
            }
          }
        }

        const features = document.features.filter((feature) => !doomed.has(feature.id));
        const removedBeforeBar = document.features
          .slice(0, document.rollbackIndex)
          .filter((feature) => doomed.has(feature.id)).length;

        return {
          ...document,
          features,
          rollbackIndex: Math.min(document.rollbackIndex - removedBeforeBar, features.length),
        };
      });

      set((state) => ({
        selectedFeatureIds: state.selectedFeatureIds.filter((selected) => selected !== id),
      }));
    },

    toggleSuppressed: (id) => {
      commit((document) => ({
        ...document,
        features: document.features.map((feature) =>
          feature.id === id && !feature.isDefault
            ? { ...feature, suppressed: !feature.suppressed }
            : feature,
        ),
      }));
    },

    updateParameters: (id, parameters) => {
      commit((document) => ({
        ...document,
        features: document.features.map((feature) =>
          feature.id === id
            ? { ...feature, parameters: { ...feature.parameters, ...parameters } }
            : feature,
        ),
      }));
    },

    setRollbackIndex: (index) => {
      commit((document) => {
        // The bar can never move above the default reference geometry.
        const clamped = Math.max(DEFAULT_FEATURE_COUNT, Math.min(index, document.features.length));
        return clamped === document.rollbackIndex ? document : { ...document, rollbackIndex: clamped };
      });
    },

    rollbackToBefore: (id) => {
      const { document } = get();
      const index = document.features.findIndex((feature) => feature.id === id);
      if (index !== -1) {
        get().setRollbackIndex(index);
      }
    },

    rollBackOne: () => get().setRollbackIndex(get().document.rollbackIndex - 1),
    rollForwardOne: () => get().setRollbackIndex(get().document.rollbackIndex + 1),
    rollToEnd: () => get().setRollbackIndex(get().document.features.length),

    selectFeature: (id, additive = false) => {
      if (id === null) {
        set({ selectedFeatureIds: [] });
        return;
      }

      set((state) => {
        if (!additive) {
          return { selectedFeatureIds: [id] };
        }
        return {
          selectedFeatureIds: state.selectedFeatureIds.includes(id)
            ? state.selectedFeatureIds.filter((selected) => selected !== id)
            : [...state.selectedFeatureIds, id],
        };
      });
    },

    clearSelection: () => set({ selectedFeatureIds: [] }),

    renameDocument: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit((document) => (document.name === trimmed ? document : { ...document, name: trimmed }));
    },

    setUnitSystem: (unitSystem) => set({ unitSystem }),

    undo: () => {
      const { past, document, future } = get();
      const previous = past[past.length - 1];
      if (!previous) return;

      set({
        document: previous,
        past: past.slice(0, -1),
        future: [document, ...future].slice(0, HISTORY_LIMIT),
      });
    },

    redo: () => {
      const { past, document, future } = get();
      const [next, ...rest] = future;
      if (!next) return;

      set({
        document: next,
        past: [...past, document].slice(-HISTORY_LIMIT),
        future: rest,
      });
    },
  };
});

/* ------------------------------------------------------------------ selectors */

/** Features above the rollback bar, i.e. the ones a rebuild would evaluate. */
export function selectBuiltFeatures(state: DocumentStore): Feature[] {
  return state.document.features.slice(0, state.document.rollbackIndex);
}

export function selectRolledBackCount(state: DocumentStore): number {
  return state.document.features.length - state.document.rollbackIndex;
}

export function selectSketchStatus(state: DocumentStore): SketchStatus {
  // Constraint solving arrives in Step 4; until then a document has no active sketch.
  return state.activeSketchId === null ? "no-sketch" : "under-defined";
}

/** Selected plane, if exactly one default plane is selected — used to highlight it in 3D. */
export function selectSelectedPlaneId(state: DocumentStore): string | null {
  const [only] = state.selectedFeatureIds;
  if (state.selectedFeatureIds.length !== 1) return null;
  return (DEFAULT_PLANE_IDS as readonly string[]).includes(only) ? only : null;
}
