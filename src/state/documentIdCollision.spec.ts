import { beforeEach, describe, expect, it } from "vitest";

import { createDocument, useDocumentStore } from "./documentStore";

/**
 * Regression coverage for the "new feature overwrites an existing one by id collision"
 * bug (WP00): `nextId`'s counter is a plain module-level variable, so loading a document
 * whose features already carry high-numbered ids (Open, autosave restore, a tab switch —
 * all go through `restoreSession`) used to leave the counter wherever it last was in *this*
 * session, letting the very next `addFeature` mint an id that already exists in what was
 * just loaded and silently clobber it. `restoreSession` now reseeds the counter from the
 * loaded document's own highest existing id before any new id can be minted.
 */
describe("documentStore: id counter reseeds on restoreSession", () => {
  beforeEach(() => {
    useDocumentStore.getState().loadDocument(createDocument("part", "Reset"));
  });

  it("a feature added after restoreSession never collides with a high-numbered loaded id", () => {
    const base = createDocument("part", "Loaded");
    const highId = "extrude-500";
    const document = { ...base, features: [...base.features, { id: highId, kind: "extrude" } as never] };

    useDocumentStore.getState().restoreSession(document, [], [], "MMGS");

    const newId = useDocumentStore.getState().addFeature("extrude");

    expect(newId).not.toBe(highId);
    expect(useDocumentStore.getState().document.features.filter((f) => f.id === highId)).toHaveLength(1);
  });
});
