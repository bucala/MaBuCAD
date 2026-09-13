import { create } from "zustand";

import type {
  CadDocument,
  DocumentKind,
  DrawingDatumData,
  DrawingDimensionData,
  DrawingGdtData,
  DrawingNoteData,
  DrawingOrdinateChainData,
  DrawingSheetData,
  DrawingSurfaceFinishData,
  DrawingTableData,
  DrawingViewData,
  DrawingWeldData,
  Feature,
  FeatureKind,
  FeatureParameters,
  Sensor,
} from "@/types/document";
import type { UnitSystemId } from "@/types/ui";

import { FEATURE_CATALOG } from "./featureCatalog";
import { DEFAULT_SHEET_FORMAT_ID, DEFAULT_TITLE_BLOCK_VALUES_SEED } from "./templateStore";

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

/**
 * Builds a fresh document of the given kind, named by the caller.
 *
 * `workspaceStore.ts` is what actually picks `name` (scanning every open tab so two open
 * Parts don't both land on "Part1") and calls this for every new tab — New Document, Open,
 * and Restore Autosave alike. A Part gets the usual reference-geometry starter features; a
 * Drawing has no feature history of its own (see `DrawingSheetData`'s own doc comment in
 * `types/document.ts`) so it starts with none and an empty sheet instead.
 */
export function createDocument(kind: DocumentKind, name: string): CadDocument {
  if (kind === "drawing") {
    return {
      id: nextId("doc"),
      name,
      kind,
      features: [],
      rollbackIndex: 0,
      variables: {},
      sensors: [],
      drawing: {
        sourcePart: null,
        views: [],
        sheetFormatId: DEFAULT_SHEET_FORMAT_ID,
        titleBlockValues: { ...DEFAULT_TITLE_BLOCK_VALUES_SEED },
      },
    };
  }

  const features = createDefaultFeatures();
  return {
    id: nextId("doc"),
    name,
    kind,
    features,
    rollbackIndex: features.length,
    variables: {},
    sensors: [],
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

const HISTORY_LIMIT = 30;

interface DocumentStore {
  document: CadDocument;
  selectedFeatureIds: string[];
  unitSystem: UnitSystemId;

  past: CadDocument[];
  future: CadDocument[];

  addFeature: (kind: FeatureKind, parameters?: FeatureParameters, parents?: string[]) => string;
  setFeatureErrors: (errors: Record<string, string>) => void;
  renameFeature: (id: string, name: string) => void;
  deleteFeature: (id: string) => void;
  toggleSuppressed: (id: string) => void;
  updateParameters: (id: string, parameters: FeatureParameters) => void;
  /** Reassigns which sketch (or other parent feature) a feature consumes at a given
   * `parents` index — e.g. picking a different profile sketch for an Extrude after it was
   * created with the wrong one, or none at all. `PropertyManager.tsx`'s own "Profile
   * Sketch" picker is the only caller. */
  setFeatureParent: (id: string, index: number, parentId: string) => void;

  /** Inspect ▸ Equations. Renaming (deleting the old key, setting the new one) is the
   * caller's job — this only ever touches one name at a time. */
  setVariable: (name: string, value: number) => void;
  deleteVariable: (name: string) => void;

  /** Inspect ▸ Sensors. `addSensor` returns the new id the way `addFeature` does, so the
   * panel that just created a row can address it immediately (e.g. to focus its name field). */
  addSensor: (sensor: Omit<Sensor, "id" | "lastStatus">) => string;
  updateSensor: (id: string, changes: Partial<Omit<Sensor, "id">>) => void;
  deleteSensor: (id: string) => void;
  /**
   * Records a sensor's latest evaluated pass/fail — called after every rebuild, not by the
   * user, so (unlike `updateSensor`) it bypasses `commit()`: a recalculated status is not
   * an edit worth an undo step, and at one call per rebuild it would otherwise crowd real
   * edits out of the capped undo history within a few rebuilds.
   */
  setSensorStatus: (id: string, status: Sensor["lastStatus"]) => void;

  setRollbackIndex: (index: number) => void;
  rollbackToBefore: (id: string) => void;
  rollForwardOne: () => void;
  rollBackOne: () => void;
  rollToEnd: () => void;

  /**
   * Arms a pointer-drag gesture on the Drawing sheet — the sheet container calls this on
   * pointer-down (capture phase) and `endDragEdit` on pointer-up. The gesture's first
   * *changing* `commit()` snapshots the pre-gesture document as the single undo entry for
   * the whole drag; every later frame of the same gesture applies without a fresh entry.
   * Without this, a view/label drag fires `moveDrawingView`/`updateDrawingNote` per
   * pointermove, and one drag evicts everything before it from the capped history — the
   * same class of bug `sketchStore.ts`'s own `beginDrag` exists to prevent for point
   * drags. Arming is lazy (nothing is pushed until a frame actually changes something),
   * so a plain click that never drags leaves the history untouched.
   */
  beginDragEdit: () => void;
  /** Ends the gesture — discards the armed snapshot if no frame ever changed anything. */
  endDragEdit: () => void;

  selectFeature: (id: string | null, additive?: boolean) => void;
  clearSelection: () => void;

  /**
   * Screen position of the 3D viewport's right-click menu, or null when it is closed.
   *
   * Opened from a plane or the solid body inside the react-three-fiber scene, but rendered
   * as a plain DOM overlay outside the Canvas — same reasoning as the sketch canvas's own
   * context menu (see `SketchContextMenu.tsx`): `ReactDOM.createPortal` does not safely
   * escape r3f's reconciler, so the menu component needs to read this from a store instead
   * of being rendered directly by the component that opens it.
   */
  contextMenu: { x: number; y: number } | null;
  openContextMenu: (x: number, y: number) => void;

  /**
   * Whether the New Document type picker (Part / Assembly / Drawing) is open. Lives here
   * rather than as local state in whichever component happens to trigger it, since "New"
   * is dispatched through `commandRegistry.ts`'s `runCommand` from several places at once
   * (the ribbon's Document group, the File menu) — same reasoning as `contextMenu` above.
   */
  newDocumentDialogOpen: boolean;
  openNewDocumentDialog: () => void;
  closeNewDocumentDialog: () => void;
  closeContextMenu: () => void;

  renameDocument: (name: string) => void;
  setUnitSystem: (unitSystem: UnitSystemId) => void;
  /** Replaces a Drawing document's whole sheet — `commands/drawingCommands.ts`'s Insert
   * Model View and Update Views, the only things that ever touch `CadDocument.drawing`. */
  setDrawingSheet: (drawing: DrawingSheetData) => void;
  /** Patches one placed view (drag repositioning, or any other single-view edit) without
   * the caller needing the rest of `drawing` in hand — a no-op if the active document
   * isn't a Drawing or has no view with that id. */
  updateDrawingView: (id: string, patch: Partial<Omit<DrawingViewData, "id">>) => void;
  /** Repositions a view AND every annotation bound to it (`parentViewId === id`) by the
   * same delta — `DrawingSheet.tsx`'s own view-drag handler uses this instead of plain
   * `updateDrawingView` so a bound dimension/datum/GD&T/surface-finish/weld/ordinate-chain
   * actually moves with its view, matching `DrawingViewData`'s own "bound annotations" doc
   * comment. A no-op patch to unbound annotations, same as today. */
  moveDrawingView: (id: string, x: number, y: number) => void;
  deleteDrawingView: (id: string) => void;
  addDrawingView: (view: DrawingViewData) => void;
  addDrawingNote: (note: Omit<DrawingNoteData, "id">) => string;
  updateDrawingNote: (id: string, patch: Partial<Omit<DrawingNoteData, "id">>) => void;
  deleteDrawingNote: (id: string) => void;

  /** `annotation.smart-dimension`'s own data — see `DrawingDimensionData`'s doc comment. */
  addDrawingDimension: (dimension: Omit<DrawingDimensionData, "id">) => string;
  updateDrawingDimension: (id: string, patch: Partial<Omit<DrawingDimensionData, "id">>) => void;
  deleteDrawingDimension: (id: string) => void;

  /** `annotation.ordinate`'s own data. `addDrawingOrdinateChain` starts a new chain with its
   * first point already in it; `addOrdinatePoint` appends a further point to an existing
   * chain — the two-step "pick a datum, then any number of further points" flow
   * `drawingToolStore.ts`'s own `ordinateChainId` doc comment describes. */
  addDrawingOrdinateChain: (
    chain: Omit<DrawingOrdinateChainData, "id" | "points"> & {
      points: Omit<DrawingOrdinateChainData["points"][number], "id">[];
    },
  ) => string;
  addOrdinatePoint: (chainId: string, point: Omit<DrawingOrdinateChainData["points"][number], "id">) => void;
  deleteDrawingOrdinateChain: (id: string) => void;

  /** `annotation.datum`'s own data. */
  addDrawingDatum: (datum: Omit<DrawingDatumData, "id">) => string;
  updateDrawingDatum: (id: string, patch: Partial<Omit<DrawingDatumData, "id">>) => void;
  deleteDrawingDatum: (id: string) => void;

  /** `annotation.gdt`'s own data. */
  addDrawingGdt: (frame: Omit<DrawingGdtData, "id">) => string;
  updateDrawingGdt: (id: string, patch: Partial<Omit<DrawingGdtData, "id">>) => void;
  deleteDrawingGdt: (id: string) => void;

  /** `annotation.surface-finish`'s own data. */
  addDrawingSurfaceFinish: (finish: Omit<DrawingSurfaceFinishData, "id">) => string;
  updateDrawingSurfaceFinish: (id: string, patch: Partial<Omit<DrawingSurfaceFinishData, "id">>) => void;
  deleteDrawingSurfaceFinish: (id: string) => void;

  /** `annotation.weld`'s own data. */
  addDrawingWeld: (weld: Omit<DrawingWeldData, "id">) => string;
  updateDrawingWeld: (id: string, patch: Partial<Omit<DrawingWeldData, "id">>) => void;
  deleteDrawingWeld: (id: string) => void;

  /** `table.bom`/`table.hole`'s own data. */
  addDrawingTable: (table: Omit<DrawingTableData, "id">) => string;
  updateDrawingTable: (id: string, patch: Partial<Omit<DrawingTableData, "id">>) => void;
  deleteDrawingTable: (id: string) => void;

  /**
   * Replaces the whole document — Open, loading a saved file. Bypasses `commit()`
   * deliberately: this is a fresh start, not an edit to the document that was open before
   * it, so undoing it should not be possible, and the previous document's own undo history
   * would be meaningless applied to a different one anyway.
   */
  loadDocument: (document: CadDocument) => void;
  /**
   * Restores a previously snapshotted editing session verbatim — `workspaceStore.ts`'s own
   * tab switch, restoring the tab being switched *to*. Unlike `loadDocument`, this keeps
   * `past`/`future` rather than wiping them: the tab being switched to already had its own
   * undo history before the user switched away from it, and losing that on every switch
   * would make Undo useless the moment more than one document is open.
   */
  restoreSession: (document: CadDocument, past: CadDocument[], future: CadDocument[], unitSystem: UnitSystemId) => void;

  undo: () => void;
  redo: () => void;
}

export const useDocumentStore = create<DocumentStore>((set, get) => {
  /**
   * The pre-gesture document of a pointer-drag currently in progress (`beginDragEdit`
   * until `endDragEdit`), or null outside a gesture — see `beginDragEdit`'s doc comment.
   * Closure state, not store state: it is transient gesture bookkeeping that nothing
   * renders, the same way `sketchStore.ts` keeps its own drag-gesture flags outside the
   * store.
   */
  let dragSnapshot: CadDocument | null = null;
  /** Whether a pointer-drag gesture is currently in progress at all — stays true for the
   * whole gesture, unlike `dragSnapshot`, which the first *changing* commit consumes. */
  let inDragGesture = false;

  /**
   * Applies a change to the document and records the previous state for undo.
   *
   * Every mutation goes through here so history stays complete; selection and unit
   * changes deliberately do not, since undoing a click is surprising.
   *
   * Gesture-aware: inside an armed drag gesture the first *changing* commit records the
   * pre-gesture document as the gesture's single history entry and the gesture's later
   * frames apply without one, so a whole pointer-drag is one undo step.
   */
  const commit = (mutate: (document: CadDocument) => CadDocument) => {
    const { document, past } = get();
    const next = mutate(document);
    if (next === document) return;

    if (inDragGesture) {
      // The pre-gesture document, or null once an earlier frame of this gesture already
      // consumed it — later frames of the same gesture push nothing.
      const snapshot = dragSnapshot;
      dragSnapshot = null;

      set({
        document: next,
        past: snapshot ? [...past, snapshot].slice(-HISTORY_LIMIT) : past,
        future: [],
      });
      return;
    }

    set({
      document: next,
      past: [...past, document].slice(-HISTORY_LIMIT),
      future: [],
    });
  };

  return {
    document: createDocument("part", "Part1"),
    selectedFeatureIds: [],
    unitSystem: "MMGS",
    past: [],
    future: [],

    addFeature: (kind, parameters, parents = []) => {
      const id = nextId(kind);

      commit((document) => {
        const feature: Feature = {
          id,
          kind,
          name: nextFeatureName(document.features, kind),
          suppressed: false,
          isDefault: false,
          parents,
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

    /**
     * Records rebuild failures against their features.
     *
     * Written outside `commit` on purpose: a failed rebuild is a consequence of an edit,
     * not an edit itself, so it must not create an undo step of its own.
     */
    setFeatureErrors: (errors) =>
      set((state) => {
        const changed = state.document.features.some(
          (feature) => (feature.error ?? undefined) !== (errors[feature.id] ?? undefined),
        );
        if (!changed) return state;

        return {
          document: {
            ...state.document,
            features: state.document.features.map((feature) =>
              errors[feature.id]
                ? { ...feature, error: errors[feature.id] }
                : feature.error
                  ? { ...feature, error: undefined }
                  : feature,
            ),
          },
        };
      }),

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

    setFeatureParent: (id, index, parentId) => {
      commit((document) => ({
        ...document,
        features: document.features.map((feature) => {
          if (feature.id !== id) return feature;
          const parents = [...feature.parents];
          parents[index] = parentId;
          return { ...feature, parents };
        }),
      }));
    },

    setVariable: (name, value) => {
      commit((document) => ({
        ...document,
        variables: { ...document.variables, [name]: value },
      }));
    },
    deleteVariable: (name) => {
      commit((document) => {
        const variables = { ...document.variables };
        delete variables[name];
        return { ...document, variables };
      });
    },

    addSensor: (sensor) => {
      const id = nextId("sensor");
      commit((document) => ({
        ...document,
        sensors: [...(document.sensors ?? []), { ...sensor, id, lastStatus: null }],
      }));
      return id;
    },
    updateSensor: (id, changes) => {
      commit((document) => ({
        ...document,
        sensors: (document.sensors ?? []).map((sensor) =>
          sensor.id === id ? { ...sensor, ...changes } : sensor,
        ),
      }));
    },
    deleteSensor: (id) => {
      commit((document) => ({
        ...document,
        sensors: (document.sensors ?? []).filter((sensor) => sensor.id !== id),
      }));
    },
    setSensorStatus: (id, status) => {
      const { document } = get();
      const sensors = (document.sensors ?? []).map((sensor) =>
        sensor.id === id ? { ...sensor, lastStatus: status } : sensor,
      );
      set({ document: { ...document, sensors } });
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

    beginDragEdit: () => {
      inDragGesture = true;
      dragSnapshot = get().document;
    },
    endDragEdit: () => {
      inDragGesture = false;
      dragSnapshot = null;
    },

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

    contextMenu: null,
    openContextMenu: (x, y) => set({ contextMenu: { x, y } }),
    closeContextMenu: () => set({ contextMenu: null }),

    newDocumentDialogOpen: false,
    openNewDocumentDialog: () => set({ newDocumentDialogOpen: true }),
    closeNewDocumentDialog: () => set({ newDocumentDialogOpen: false }),

    renameDocument: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit((document) => (document.name === trimmed ? document : { ...document, name: trimmed }));
    },

    setUnitSystem: (unitSystem) => set({ unitSystem }),

    setDrawingSheet: (drawing) => commit((document) => ({ ...document, drawing })),

    updateDrawingView: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            views: document.drawing.views.map((view) => (view.id === id ? { ...view, ...patch } : view)),
          },
        };
      }),

    moveDrawingView: (id, x, y) =>
      commit((document) => {
        if (!document.drawing) return document;
        const view = document.drawing.views.find((v) => v.id === id);
        if (!view) return document;
        const dx = x - view.x;
        const dy = y - view.y;
        const drawing = document.drawing;
        const shiftBound = <T extends { id: string; parentViewId?: string }>(
          items: T[] | undefined,
          shift: (item: T) => T,
        ) => (items ?? []).map((item) => (item.parentViewId === id ? shift(item) : item));
        return {
          ...document,
          drawing: {
            ...drawing,
            views: drawing.views.map((v) => (v.id === id ? { ...v, x, y } : v)),
            dimensions: shiftBound(drawing.dimensions, (d) => ({
              ...d,
              x1: d.x1 + dx,
              y1: d.y1 + dy,
              x2: d.x2 + dx,
              y2: d.y2 + dy,
            })),
            ordinateChains: shiftBound(drawing.ordinateChains, (chain) => ({
              ...chain,
              datumX: chain.datumX + dx,
              datumY: chain.datumY + dy,
              points: chain.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
            })),
            datums: shiftBound(drawing.datums, (datum) => ({
              ...datum,
              anchorX: datum.anchorX + dx,
              anchorY: datum.anchorY + dy,
              labelX: datum.labelX + dx,
              labelY: datum.labelY + dy,
            })),
            gdtFrames: shiftBound(drawing.gdtFrames, (frame) => ({
              ...frame,
              anchorX: frame.anchorX + dx,
              anchorY: frame.anchorY + dy,
              labelX: frame.labelX + dx,
              labelY: frame.labelY + dy,
            })),
            surfaceFinishes: shiftBound(drawing.surfaceFinishes, (finish) => ({
              ...finish,
              anchorX: finish.anchorX + dx,
              anchorY: finish.anchorY + dy,
              labelX: finish.labelX + dx,
              labelY: finish.labelY + dy,
            })),
            welds: shiftBound(drawing.welds, (weld) => ({
              ...weld,
              anchorX: weld.anchorX + dx,
              anchorY: weld.anchorY + dy,
              labelX: weld.labelX + dx,
              labelY: weld.labelY + dy,
            })),
          },
        };
      }),

    deleteDrawingView: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, views: document.drawing.views.filter((view) => view.id !== id) },
        };
      }),

    addDrawingView: (view) =>
      commit((document) => {
        if (!document.drawing) return document;
        return { ...document, drawing: { ...document.drawing, views: [...document.drawing.views, view] } };
      }),

    addDrawingNote: (note) => {
      const id = nextId("note");
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, notes: [...(document.drawing.notes ?? []), { ...note, id }] },
        };
      });
      return id;
    },

    updateDrawingNote: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            notes: (document.drawing.notes ?? []).map((note) => (note.id === id ? { ...note, ...patch } : note)),
          },
        };
      }),

    deleteDrawingNote: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, notes: (document.drawing.notes ?? []).filter((note) => note.id !== id) },
        };
      }),

    addDrawingDimension: (dimension) => {
      const id = nextId("dim");
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            dimensions: [...(document.drawing.dimensions ?? []), { ...dimension, id }],
          },
        };
      });
      return id;
    },

    updateDrawingDimension: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            dimensions: (document.drawing.dimensions ?? []).map((dimension) =>
              dimension.id === id ? { ...dimension, ...patch } : dimension,
            ),
          },
        };
      }),

    deleteDrawingDimension: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            dimensions: (document.drawing.dimensions ?? []).filter((dimension) => dimension.id !== id),
          },
        };
      }),

    addDrawingOrdinateChain: (chain) => {
      const id = nextId("ord");
      const points = chain.points.map((point) => ({ ...point, id: nextId("ordpt") }));
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            ordinateChains: [...(document.drawing.ordinateChains ?? []), { ...chain, points, id }],
          },
        };
      });
      return id;
    },

    addOrdinatePoint: (chainId, point) =>
      commit((document) => {
        if (!document.drawing) return document;
        const id = nextId("ordpt");
        return {
          ...document,
          drawing: {
            ...document.drawing,
            ordinateChains: (document.drawing.ordinateChains ?? []).map((chain) =>
              chain.id === chainId ? { ...chain, points: [...chain.points, { ...point, id }] } : chain,
            ),
          },
        };
      }),

    deleteDrawingOrdinateChain: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            ordinateChains: (document.drawing.ordinateChains ?? []).filter((chain) => chain.id !== id),
          },
        };
      }),

    addDrawingDatum: (datum) => {
      const id = nextId("datum");
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, datums: [...(document.drawing.datums ?? []), { ...datum, id }] },
        };
      });
      return id;
    },

    updateDrawingDatum: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            datums: (document.drawing.datums ?? []).map((datum) => (datum.id === id ? { ...datum, ...patch } : datum)),
          },
        };
      }),

    deleteDrawingDatum: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, datums: (document.drawing.datums ?? []).filter((datum) => datum.id !== id) },
        };
      }),

    addDrawingGdt: (frame) => {
      const id = nextId("gdt");
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, gdtFrames: [...(document.drawing.gdtFrames ?? []), { ...frame, id }] },
        };
      });
      return id;
    },

    updateDrawingGdt: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            gdtFrames: (document.drawing.gdtFrames ?? []).map((frame) =>
              frame.id === id ? { ...frame, ...patch } : frame,
            ),
          },
        };
      }),

    deleteDrawingGdt: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            gdtFrames: (document.drawing.gdtFrames ?? []).filter((frame) => frame.id !== id),
          },
        };
      }),

    addDrawingSurfaceFinish: (finish) => {
      const id = nextId("finish");
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            surfaceFinishes: [...(document.drawing.surfaceFinishes ?? []), { ...finish, id }],
          },
        };
      });
      return id;
    },

    updateDrawingSurfaceFinish: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            surfaceFinishes: (document.drawing.surfaceFinishes ?? []).map((finish) =>
              finish.id === id ? { ...finish, ...patch } : finish,
            ),
          },
        };
      }),

    deleteDrawingSurfaceFinish: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            surfaceFinishes: (document.drawing.surfaceFinishes ?? []).filter((finish) => finish.id !== id),
          },
        };
      }),

    addDrawingWeld: (weld) => {
      const id = nextId("weld");
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, welds: [...(document.drawing.welds ?? []), { ...weld, id }] },
        };
      });
      return id;
    },

    updateDrawingWeld: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            welds: (document.drawing.welds ?? []).map((weld) => (weld.id === id ? { ...weld, ...patch } : weld)),
          },
        };
      }),

    deleteDrawingWeld: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            welds: (document.drawing.welds ?? []).filter((weld) => weld.id !== id),
          },
        };
      }),

    addDrawingTable: (table) => {
      const id = nextId("table");
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, tables: [...(document.drawing.tables ?? []), { ...table, id }] },
        };
      });
      return id;
    },

    updateDrawingTable: (id, patch) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: {
            ...document.drawing,
            tables: (document.drawing.tables ?? []).map((table) => (table.id === id ? { ...table, ...patch } : table)),
          },
        };
      }),

    deleteDrawingTable: (id) =>
      commit((document) => {
        if (!document.drawing) return document;
        return {
          ...document,
          drawing: { ...document.drawing, tables: (document.drawing.tables ?? []).filter((table) => table.id !== id) },
        };
      }),

    loadDocument: (document) => {
      inDragGesture = false;
      dragSnapshot = null;
      set({ document, past: [], future: [], selectedFeatureIds: [], contextMenu: null });
    },

    restoreSession: (document, past, future, unitSystem) => {
      inDragGesture = false;
      dragSnapshot = null;
      set({ document, past, future, unitSystem, selectedFeatureIds: [], contextMenu: null });
    },

    undo: () => {
      // A keyboard undo mid-drag ends the gesture: the drag's next frame becomes a fresh
      // edit against the restored document rather than being swallowed as a gesture frame.
      inDragGesture = false;
      dragSnapshot = null;
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
      inDragGesture = false;
      dragSnapshot = null;
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

/** Selected plane, if exactly one default plane is selected — used to highlight it in 3D. */
export function selectSelectedPlaneId(state: DocumentStore): string | null {
  const [only] = state.selectedFeatureIds;
  if (state.selectedFeatureIds.length !== 1) return null;
  return (DEFAULT_PLANE_IDS as readonly string[]).includes(only) ? only : null;
}
