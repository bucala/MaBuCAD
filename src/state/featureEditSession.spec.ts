import { beforeEach, describe, expect, it } from "vitest";

import { createDocument, useDocumentStore } from "./documentStore";

/**
 * Feature create/edit session semantics (`beginFeatureEdit`/`endFeatureEdit`), at the level
 * users experience them: creating a feature and tuning it is ONE undo step with a working
 * Cancel — not an immediate document write followed by one undo entry per keystroke.
 *
 * These replay what the real UI fires: a ribbon command calls `addFeature` (which opens the
 * session), `PropertyManager`'s fields call `updateParameters`/`renameFeature` per
 * keystroke, and OK/Cancel (or Escape) call `endFeatureEdit` — see `FeatureActionBar.tsx`,
 * `PropertyManager.tsx` and `useEscapeToDeselect.ts` for the other end of that wire.
 */

/** The feature with this id, or a thrown error — every case below edits a real feature. */
function featureById(id: string) {
  const feature = useDocumentStore.getState().document.features.find(
    (candidate) => candidate.id === id,
  );
  if (!feature) throw new Error(`no feature ${id}`);
  return feature;
}

beforeEach(() => {
  // A fresh Part: no features beyond the defaults, zero history, no session — and
  // `loadDocument` clears the session's closure state too, so no case inherits a leaked
  // `editSnapshot` from the one before it.
  useDocumentStore.getState().loadDocument(createDocument("part", "Test"));
});

describe("feature create/edit sessions", () => {
  it("Cancel on a newly created feature removes it and leaves no history trace", () => {
    const store = useDocumentStore.getState();
    const defaultsOnly = store.document.features.length;
    expect(store.past.length).toBe(0);

    const id = store.addFeature("extrude");
    expect(useDocumentStore.getState().featureEdit).toEqual({ featureId: id, isNew: true });

    // "Deciding" involves changing a parameter — Cancel has to take that back too.
    useDocumentStore.getState().updateParameters(id, { depth: 42 });
    useDocumentStore.getState().endFeatureEdit("cancel");

    const state = useDocumentStore.getState();
    expect(state.document.features.length).toBe(defaultsOnly);
    expect(state.document.features.some((feature) => feature.id === id)).toBe(false);
    // Cancelled is not something Undo should have to step through.
    expect(state.past.length).toBe(0);
    expect(state.future).toEqual([]);
    expect(state.featureEdit).toBeNull();
    expect(state.selectedFeatureIds).toEqual([]);
  });

  it("creating a feature and tuning it is one undo step — not one per keystroke", () => {
    const store = useDocumentStore.getState();
    const id = store.addFeature("extrude");

    // Three changes that used to be three undo entries: two depth keystrokes and a rename.
    useDocumentStore.getState().updateParameters(id, { depth: 12 });
    useDocumentStore.getState().updateParameters(id, { depth: 15 });
    useDocumentStore.getState().renameFeature(id, "Boss");
    useDocumentStore.getState().endFeatureEdit("commit");

    const state = useDocumentStore.getState();
    expect(state.past.length).toBe(1); // the whole creation session
    expect(featureById(id).name).toBe("Boss");

    // One undo removes the feature — the tuned depth never existed as its own step.
    useDocumentStore.getState().undo();
    const undone = useDocumentStore.getState();
    expect(undone.past.length).toBe(0);
    expect(undone.document.features.some((feature) => feature.id === id)).toBe(false);
  });

  it("OK on an existing feature commits name and parameters as one undo step", () => {
    const store = useDocumentStore.getState();
    const id = store.addFeature("extrude");
    useDocumentStore.getState().endFeatureEdit("commit");
    const baseline = useDocumentStore.getState().past.length; // the creation step

    useDocumentStore.getState().beginFeatureEdit(id);
    useDocumentStore.getState().updateParameters(id, { depth: 25 });
    useDocumentStore.getState().renameFeature(id, "Renamed");
    useDocumentStore.getState().endFeatureEdit("commit");

    const state = useDocumentStore.getState();
    expect(state.past.length).toBe(baseline + 1); // one step for the whole edit session
    expect(featureById(id).parameters.depth).toBe(25);
    expect(featureById(id).name).toBe("Renamed");

    // One undo reverts the whole session — depth and name together.
    useDocumentStore.getState().undo();
    expect(featureById(id).parameters.depth).toBe(10);
    expect(featureById(id).name).toBe("Boss-Extrude1");

    // And redo replays it whole.
    useDocumentStore.getState().redo();
    expect(featureById(id).parameters.depth).toBe(25);
    expect(featureById(id).name).toBe("Renamed");
  });

  it("Cancel on an existing feature restores every value, drops the session's undo entry and deselects", () => {
    const store = useDocumentStore.getState();
    const id = store.addFeature("extrude");
    useDocumentStore.getState().endFeatureEdit("commit");
    const baseline = useDocumentStore.getState().past.length;

    useDocumentStore.getState().beginFeatureEdit(id);
    useDocumentStore.getState().updateParameters(id, { depth: 25 });
    useDocumentStore.getState().renameFeature(id, "Renamed");
    useDocumentStore.getState().toggleSuppressed(id); // folds into the session too
    useDocumentStore.getState().endFeatureEdit("cancel");

    const state = useDocumentStore.getState();
    expect(state.past.length).toBe(baseline); // the session's entry is gone
    expect(featureById(id).parameters.depth).toBe(10);
    expect(featureById(id).name).toBe("Boss-Extrude1");
    expect(featureById(id).suppressed).toBe(false);
    expect(state.featureEdit).toBeNull();
    // Cancel dismisses the panel's subject the way SolidWorks dismisses the PropertyManager.
    expect(state.selectedFeatureIds).toEqual([]);

    // The stack is not corrupted: undo still steps past the creation cleanly.
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.features.some((feature) => feature.id === id)).toBe(false);
  });

  it("a session that changes nothing pushes nothing — browsing is free", () => {
    const store = useDocumentStore.getState();
    const id = store.addFeature("extrude");
    useDocumentStore.getState().endFeatureEdit("commit");
    const baseline = useDocumentStore.getState().past.length;

    // Merely opening and closing the feature (select it, look, leave) must not touch
    // history — neither via OK nor via Cancel.
    useDocumentStore.getState().beginFeatureEdit(id);
    useDocumentStore.getState().endFeatureEdit("commit");
    expect(useDocumentStore.getState().past.length).toBe(baseline);

    useDocumentStore.getState().beginFeatureEdit(id);
    useDocumentStore.getState().endFeatureEdit("cancel");
    expect(useDocumentStore.getState().past.length).toBe(baseline);
    expect(featureById(id).parameters.depth).toBe(10);
  });

  it("selecting another feature commits the open session", () => {
    const store = useDocumentStore.getState();
    const a = store.addFeature("extrude");
    useDocumentStore.getState().endFeatureEdit("commit");
    const b = store.addFeature("extrude");
    useDocumentStore.getState().endFeatureEdit("commit");
    const baseline = useDocumentStore.getState().past.length;

    useDocumentStore.getState().beginFeatureEdit(a);
    useDocumentStore.getState().updateParameters(a, { depth: 30 });
    useDocumentStore.getState().selectFeature(b);

    const state = useDocumentStore.getState();
    // The first feature's edit confirmed (OK semantics) rather than silently discarded.
    expect(state.featureEdit).toBeNull();
    expect(featureById(a).parameters.depth).toBe(30);
    expect(state.past.length).toBe(baseline + 1);
    expect(state.selectedFeatureIds).toEqual([b]);
  });

  it("creating a feature while a session is open commits the first session, and Cancel only removes the new one", () => {
    const store = useDocumentStore.getState();
    const a = store.addFeature("extrude");
    useDocumentStore.getState().updateParameters(a, { depth: 50 });

    const b = store.addFeature("extrude"); // commits a's session, opens b's
    expect(useDocumentStore.getState().featureEdit).toEqual({ featureId: b, isNew: true });
    expect(featureById(a).parameters.depth).toBe(50); // a's edit survived the switch

    useDocumentStore.getState().endFeatureEdit("cancel");

    const state = useDocumentStore.getState();
    expect(state.document.features.some((feature) => feature.id === b)).toBe(false);
    expect(featureById(a).parameters.depth).toBe(50); // cancel never reaches the committed session
    expect(state.selectedFeatureIds).toEqual([]);
  });

  it("deleting the session's feature ends the session so no later Cancel can resurrect it", () => {
    const store = useDocumentStore.getState();
    const id = store.addFeature("extrude");
    useDocumentStore.getState().updateParameters(id, { depth: 7 });

    useDocumentStore.getState().deleteFeature(id);

    const state = useDocumentStore.getState();
    expect(state.featureEdit).toBeNull();
    expect(state.document.features.some((feature) => feature.id === id)).toBe(false);
    expect(state.selectedFeatureIds).toEqual([]);

    // A stale Cancel (a second Escape, a late click) must be a no-op, not a resurrection.
    expect(() => useDocumentStore.getState().endFeatureEdit("cancel")).not.toThrow();
    expect(useDocumentStore.getState().document.features.some((feature) => feature.id === id)).toBe(false);

    // The whole create-edit-delete session is the single step Undo restores — the restored
    // document is the pre-creation one, so the feature stays gone after undoing it.
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().document.features.some((feature) => feature.id === id)).toBe(false);
  });

  it("a keyboard undo mid-session ends the session — the next edit is a fresh step", () => {
    const store = useDocumentStore.getState();
    const id = store.addFeature("extrude");
    useDocumentStore.getState().updateParameters(id, { depth: 35 });

    // Ctrl+Z mid-session: the session's snapshot no longer matches the document, so the
    // session must not swallow later edits into it.
    useDocumentStore.getState().undo();
    const state = useDocumentStore.getState();
    expect(state.featureEdit).toBeNull();
    expect(state.document.features.some((feature) => feature.id === id)).toBe(false);

    // A fresh edit opens its own entry, not a frame of the ended session.
    const next = useDocumentStore.getState().addFeature("extrude");
    useDocumentStore.getState().updateParameters(next, { depth: 5 });
    useDocumentStore.getState().endFeatureEdit("commit");
    expect(useDocumentStore.getState().past.length).toBe(1);
    expect(featureById(next).parameters.depth).toBe(5);
  });

  it("sketches and default reference geometry never open a session", () => {
    const store = useDocumentStore.getState();
    const sketchId = store.addFeature("sketch");
    expect(useDocumentStore.getState().featureEdit).toBeNull(); // addFeature: sessionless
    expect(useDocumentStore.getState().document.features.some((feature) => feature.id === sketchId)).toBe(true);

    // A sketch is edited in the sketch editor, a default plane has nothing to edit — both
    // are no-ops for `beginFeatureEdit` rather than opening a session with no OK/Cancel.
    useDocumentStore.getState().beginFeatureEdit(sketchId);
    expect(useDocumentStore.getState().featureEdit).toBeNull();
    useDocumentStore.getState().beginFeatureEdit("plane-front");
    expect(useDocumentStore.getState().featureEdit).toBeNull();
  });
});
