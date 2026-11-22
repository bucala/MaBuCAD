import { beforeEach, describe, expect, it } from "vitest";

import { createDocument, useDocumentStore } from "./documentStore";

const source = { fileName: "Bracket.mabucad", path: "/parts/Bracket.mabucad" };

function components() {
  return useDocumentStore.getState().document.assembly?.components ?? [];
}

describe("assembly component actions", () => {
  beforeEach(() => {
    useDocumentStore.getState().loadDocument(createDocument("assembly", "Assembly1"));
  });

  it("starts an assembly with origin planes and no components", () => {
    const { document } = useDocumentStore.getState();
    expect(document.assembly).toEqual({ components: [] });
    expect(document.features.length).toBeGreaterThan(0);
  });

  it("grounds the first component only and numbers instances per source name", () => {
    const store = useDocumentStore.getState();
    store.addComponent(source, "Bracket");
    store.addComponent(source, "Bracket");
    store.addComponent({ fileName: "Shaft.mabucad", path: null }, "Shaft");

    expect(components().map((c) => [c.name, c.grounded])).toEqual([
      ["Bracket<1>", true],
      ["Bracket<2>", false],
      ["Shaft<1>", false],
    ]);
  });

  it("moves an ungrounded component, refuses to move a grounded one, and undoes", () => {
    const store = useDocumentStore.getState();
    const grounded = store.addComponent(source, "Bracket")!;
    const free = store.addComponent(source, "Bracket")!;
    const moved = { position: [10, 0, 0] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] };

    const before = useDocumentStore.getState().past.length;
    useDocumentStore.getState().setComponentTransform(grounded, moved);
    expect(useDocumentStore.getState().past.length).toBe(before);
    expect(components()[0]!.transform.position).toEqual([0, 0, 0]);

    useDocumentStore.getState().setComponentTransform(free, moved);
    expect(components()[1]!.transform.position).toEqual([10, 0, 0]);

    useDocumentStore.getState().undo();
    expect(components()[1]!.transform.position).toEqual([0, 0, 0]);
  });

  it("batches a whole drag into one undo step", () => {
    const store = useDocumentStore.getState();
    store.addComponent(source, "Bracket");
    const free = store.addComponent(source, "Bracket")!;
    const before = useDocumentStore.getState().past.length;

    useDocumentStore.getState().beginDragEdit();
    for (const x of [1, 2, 3]) {
      useDocumentStore.getState().setComponentTransform(free, { position: [x, 0, 0], quaternion: [0, 0, 0, 1] });
    }
    useDocumentStore.getState().endDragEdit();

    expect(useDocumentStore.getState().past.length).toBe(before + 1);
    useDocumentStore.getState().undo();
    expect(components()[1]!.transform.position).toEqual([0, 0, 0]);
  });

  it("relinks, suppresses and removes", () => {
    const store = useDocumentStore.getState();
    const id = store.addComponent(source, "Bracket")!;
    const relinked = { fileName: "Bracket.mabucad", path: "/moved/Bracket.mabucad" };

    useDocumentStore.getState().updateComponent(id, { source: relinked, suppressed: true });
    expect(components()[0]).toMatchObject({ source: relinked, suppressed: true });

    useDocumentStore.getState().removeComponent(id);
    expect(components()).toEqual([]);
  });

  it("is a no-op outside an assembly", () => {
    useDocumentStore.getState().loadDocument(createDocument("part", "Part1"));
    expect(useDocumentStore.getState().addComponent(source, "Bracket")).toBeNull();
    expect(useDocumentStore.getState().document.assembly).toBeUndefined();
  });
});
