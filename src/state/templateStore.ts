import { create } from "zustand";
import { persist } from "zustand/middleware";

import { openFile, saveBlob } from "@/io/files";
import type {
  BorderTemplate,
  SheetFormat,
  SheetOrientation,
  SheetSize,
  TitleBlockField,
  TitleBlockTemplate,
} from "@/types/drawingTemplates";
import { highestIdSuffix } from "@/utils/idSuffix";

/**
 * The Drawing Resources library: every Border, Title Block and Sheet Format the app
 * knows about — see `types/drawingTemplates.ts`'s own doc comment for why these are a
 * shared library rather than something each Drawing document carries a copy of.
 *
 * Persisted to `localStorage` the same way `settingsStore.ts` persists preferences: a
 * template created or edited here survives a restart without an explicit save, and
 * Export/Import (`exportTemplate`/`importBorder`/`importTitleBlock` below) is for moving
 * one to a different machine or sharing it with a colleague, not for every-day use.
 */

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** `idCounter` above is a plain module-level variable, not part of this store's
 * zustand `persist`ed state, so a page reload rehydrates `borders`/`titleBlocks`/
 * `sheetFormats` from `localStorage` while `idCounter` itself resets to 0 — the next
 * `addBorder`/`addTitleBlock`/`addSheetFormat`/`addTitleBlockField` call would then
 * generate an id that already exists in what was just rehydrated. `onRehydrateStorage`
 * below reseeds it from the rehydrated state's own highest existing id the same way
 * `documentStore.ts` and `sketchModel.ts` reseed theirs on load. */
export function seedTemplateIdCounter(atLeast: number): void {
  if (atLeast > idCounter) idCounter = atLeast;
}

const EXTENSION = "mabutpl";

/** The one border every seeded Sheet Format uses — an 8x6 zone grid with centre marks,
 * the same defaults a stock Inventor/SolidWorks border ships with. */
const DEFAULT_BORDER: BorderTemplate = {
  id: "border-default",
  name: "Default Border",
  margin: 10,
  zoneColumns: 8,
  zoneRows: 6,
  centreMarks: true,
};

/**
 * The one title block every seeded Sheet Format uses. Deliberately generic: every field
 * that would identify a person or a specific job (Drawn By, Checked By, their dates,
 * Title, Drawing Number, Company) starts with no `defaultValue` at all, so it renders
 * blank until a real drawing fills it in via `titleBlockValues` — never a placeholder
 * name or date filled in on the user's behalf. The handful of fields that *do* carry a
 * `defaultValue` (general tolerancing notes, "THIRD ANGLE" projection, "1 / 1" sheet
 * count) are standard ISO drafting boilerplate, not personal data, so shipping a sensible
 * default for those is the same kind of default the sheet formats' own zone grid already
 * is — easy to override per drawing or edit permanently in `TitleBlockEditor.tsx`.
 */
const DEFAULT_TITLE_BLOCK: TitleBlockTemplate = {
  id: "titleblock-default",
  name: "Title Block",
  width: 180,
  height: 50,
  fields: [
    {
      id: "field-notes",
      key: "notes",
      label: "NOTES",
      x: 0,
      y: 0,
      width: 90,
      height: 20,
      fontSize: 2.6,
    },
    { id: "field-drawn-by", key: "drawnBy", label: "DRAWN BY", x: 0, y: 20, width: 45, height: 7.5, fontSize: 3 },
    { id: "field-drawn-date", key: "drawnDate", label: "DATE", x: 45, y: 20, width: 45, height: 7.5, fontSize: 3 },
    {
      id: "field-checked-by",
      key: "checkedBy",
      label: "CHECKED BY",
      x: 0,
      y: 27.5,
      width: 45,
      height: 7.5,
      fontSize: 3,
    },
    {
      id: "field-checked-date",
      key: "checkedDate",
      label: "DATE",
      x: 45,
      y: 27.5,
      width: 45,
      height: 7.5,
      fontSize: 3,
    },
    { id: "field-material", key: "material", label: "MATERIAL", x: 0, y: 35, width: 90, height: 7.5, fontSize: 3 },
    {
      id: "field-title",
      key: "title",
      label: "TITLE",
      x: 0,
      y: 42.5,
      width: 90,
      height: 7.5,
      fontSize: 3.6,
      bold: true,
    },
    {
      id: "field-projection",
      key: "projection",
      label: "PROJECTION",
      x: 90,
      y: 0,
      width: 45,
      height: 15,
      fontSize: 3,
      fieldType: "projection-symbol",
    },
    { id: "field-scale", key: "scale", label: "SCALE", x: 135, y: 0, width: 45, height: 7.5, fontSize: 3 },
    { id: "field-size", key: "size", label: "SIZE", x: 135, y: 7.5, width: 45, height: 7.5, fontSize: 3 },
    {
      id: "field-drawing-number",
      key: "drawingNumber",
      label: "DRAWING NUMBER",
      x: 90,
      y: 15,
      width: 90,
      height: 7.5,
      fontSize: 3,
    },
    { id: "field-sheet", key: "sheet", label: "SHEET", x: 90, y: 22.5, width: 45, height: 7.5, fontSize: 3 },
    { id: "field-rev", key: "rev", label: "REV", x: 135, y: 22.5, width: 45, height: 7.5, fontSize: 3 },
    { id: "field-weight", key: "weight", label: "WEIGHT (kg)", x: 90, y: 30, width: 45, height: 7.5, fontSize: 3 },
    {
      id: "field-surface-finish",
      key: "surfaceFinish",
      label: "SURFACE FINISH",
      x: 135,
      y: 30,
      width: 45,
      height: 7.5,
      fontSize: 3,
    },
    { id: "field-company", key: "company", label: "COMPANY", x: 90, y: 37.5, width: 90, height: 12.5, fontSize: 3 },
  ],
};

/** Per-field default *values* — separate from the field definitions above so a value can
 * be told apart from "the user typed this in" without a parallel boolean on every field.
 * Only standard boilerplate, per this template's own doc comment. */
const DEFAULT_TITLE_BLOCK_VALUES: Record<string, string> = {
  notes: "ALL DIMENSIONS IN MM. TOLERANCES PER ISO 2768-mK UNLESS OTHERWISE STATED.",
  sheet: "1 / 1",
};

function sheetFormat(
  id: string,
  name: string,
  size: SheetSize,
  orientation: SheetOrientation,
): SheetFormat {
  return { id, name, size, orientation, borderTemplateId: DEFAULT_BORDER.id, titleBlockTemplateId: DEFAULT_TITLE_BLOCK.id };
}

const DEFAULT_SHEET_FORMATS: SheetFormat[] = [
  sheetFormat("sheet-a4-portrait", "A4 size, Portrait, 1 view", "A4", "portrait"),
  sheetFormat("sheet-a4-landscape", "A4 size, Landscape, 1 view", "A4", "landscape"),
  sheetFormat("sheet-a3-2views", "A3 size, 2 views", "A3", "landscape"),
  sheetFormat("sheet-a2-4views", "A2 size, 4 views", "A2", "landscape"),
  sheetFormat("sheet-a1-6views", "A1 size, 6 views", "A1", "landscape"),
  sheetFormat("sheet-a0-7views", "A0 size, 7 views", "A0", "landscape"),
];

/** What a new Drawing document (`documentStore.ts`'s `createDocument`) starts with, and
 * what a Drawing saved before Sheet Formats existed falls back to. */
export const DEFAULT_SHEET_FORMAT_ID = "sheet-a3-2views";
export const DEFAULT_TITLE_BLOCK_VALUES_SEED = DEFAULT_TITLE_BLOCK_VALUES;

interface TemplateStore {
  borders: BorderTemplate[];
  titleBlocks: TitleBlockTemplate[];
  sheetFormats: SheetFormat[];

  addBorder: (border: Omit<BorderTemplate, "id">) => string;
  updateBorder: (id: string, patch: Partial<Omit<BorderTemplate, "id">>) => void;
  deleteBorder: (id: string) => void;

  addTitleBlock: (titleBlock: Omit<TitleBlockTemplate, "id">) => string;
  updateTitleBlock: (id: string, patch: Partial<Omit<TitleBlockTemplate, "id">>) => void;
  deleteTitleBlock: (id: string) => void;
  addTitleBlockField: (titleBlockId: string, field: Omit<TitleBlockField, "id">) => void;
  updateTitleBlockField: (titleBlockId: string, fieldId: string, patch: Partial<Omit<TitleBlockField, "id">>) => void;
  deleteTitleBlockField: (titleBlockId: string, fieldId: string) => void;

  addSheetFormat: (format: Omit<SheetFormat, "id">) => string;
  updateSheetFormat: (id: string, patch: Partial<Omit<SheetFormat, "id">>) => void;
  deleteSheetFormat: (id: string) => void;

  /** Downloads any one template (a Border, a Title Block, or a Sheet Format — the last
   * only meaningfully portable alongside the Border/Title Block ids it points at, so
   * exporting one bundles the two templates it references) as a `.mabutpl` JSON file. */
  exportBorder: (id: string) => Promise<void>;
  exportTitleBlock: (id: string) => Promise<void>;
  /** Opens a file picker and adds whatever it contains to the library, returning the new
   * item's id (or `null` if the user cancelled or the file didn't parse). */
  importBorder: () => Promise<string | null>;
  importTitleBlock: () => Promise<string | null>;

  /** Whether `TemplateManagerDialog.tsx` is open — lives here (rather than local state in
   * whichever component happens to trigger it) for the same reason `documentStore.ts`'s
   * `newDocumentDialogOpen` does: it's opened from more than one place at once (the
   * Drawing ribbon's Sheet Format button, and `DrawingSheet.tsx`'s own toolbar). Excluded
   * from persistence via `partialize` below — a reload should never resume with the
   * dialog already open just because it happened to be open when the tab last closed. */
  managerOpen: boolean;
  /** Which tab `TemplateManagerDialog.tsx` should land on when it next opens — set by
   * `openManager`'s own optional argument, read once and cleared so a later plain
   * `openManager()` (no tab requested) doesn't keep reopening onto a stale one. */
  managerInitialTab: "formats" | "borders" | "titleblocks" | null;
  openManager: (tab?: "formats" | "borders" | "titleblocks") => void;
  closeManager: () => void;
}

interface BorderFile {
  kind: "mabucad-border";
  border: Omit<BorderTemplate, "id">;
}
interface TitleBlockFile {
  kind: "mabucad-titleblock";
  titleBlock: Omit<TitleBlockTemplate, "id">;
}

function isBorderFile(value: unknown): value is BorderFile {
  return typeof value === "object" && value !== null && (value as BorderFile).kind === "mabucad-border";
}
function isTitleBlockFile(value: unknown): value is TitleBlockFile {
  return typeof value === "object" && value !== null && (value as TitleBlockFile).kind === "mabucad-titleblock";
}

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set, get) => ({
      borders: [DEFAULT_BORDER],
      titleBlocks: [DEFAULT_TITLE_BLOCK],
      sheetFormats: DEFAULT_SHEET_FORMATS,

      addBorder: (border) => {
        const id = nextId("border");
        set((state) => ({ borders: [...state.borders, { ...border, id }] }));
        return id;
      },
      updateBorder: (id, patch) =>
        set((state) => ({
          borders: state.borders.map((border) => (border.id === id ? { ...border, ...patch } : border)),
        })),
      deleteBorder: (id) => set((state) => ({ borders: state.borders.filter((border) => border.id !== id) })),

      addTitleBlock: (titleBlock) => {
        const id = nextId("titleblock");
        set((state) => ({ titleBlocks: [...state.titleBlocks, { ...titleBlock, id }] }));
        return id;
      },
      updateTitleBlock: (id, patch) =>
        set((state) => ({
          titleBlocks: state.titleBlocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
        })),
      deleteTitleBlock: (id) =>
        set((state) => ({ titleBlocks: state.titleBlocks.filter((block) => block.id !== id) })),

      addTitleBlockField: (titleBlockId, field) =>
        set((state) => ({
          titleBlocks: state.titleBlocks.map((block) =>
            block.id === titleBlockId
              ? { ...block, fields: [...block.fields, { ...field, id: nextId("field") }] }
              : block,
          ),
        })),
      updateTitleBlockField: (titleBlockId, fieldId, patch) =>
        set((state) => ({
          titleBlocks: state.titleBlocks.map((block) =>
            block.id === titleBlockId
              ? {
                  ...block,
                  fields: block.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
                }
              : block,
          ),
        })),
      deleteTitleBlockField: (titleBlockId, fieldId) =>
        set((state) => ({
          titleBlocks: state.titleBlocks.map((block) =>
            block.id === titleBlockId
              ? { ...block, fields: block.fields.filter((field) => field.id !== fieldId) }
              : block,
          ),
        })),

      addSheetFormat: (format) => {
        const id = nextId("sheetformat");
        set((state) => ({ sheetFormats: [...state.sheetFormats, { ...format, id }] }));
        return id;
      },
      updateSheetFormat: (id, patch) =>
        set((state) => ({
          sheetFormats: state.sheetFormats.map((format) => (format.id === id ? { ...format, ...patch } : format)),
        })),
      deleteSheetFormat: (id) =>
        set((state) => ({ sheetFormats: state.sheetFormats.filter((format) => format.id !== id) })),

      exportBorder: async (id) => {
        const border = get().borders.find((b) => b.id === id);
        if (!border) return;
        const { id: _unused, ...rest } = border;
        const payload: BorderFile = { kind: "mabucad-border", border: rest };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        await saveBlob(blob, `${border.name}.${EXTENSION}`, [EXTENSION]);
      },

      exportTitleBlock: async (id) => {
        const titleBlock = get().titleBlocks.find((b) => b.id === id);
        if (!titleBlock) return;
        const { id: _unused, ...rest } = titleBlock;
        const payload: TitleBlockFile = { kind: "mabucad-titleblock", titleBlock: rest };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        await saveBlob(blob, `${titleBlock.name}.${EXTENSION}`, [EXTENSION]);
      },

      importBorder: async () => {
        const picked = await openFile([EXTENSION, "json"]);
        if (!picked) return null;
        const parsed: unknown = JSON.parse(new TextDecoder().decode(picked.data));
        if (!isBorderFile(parsed)) return null;
        return get().addBorder(parsed.border);
      },

      importTitleBlock: async () => {
        const picked = await openFile([EXTENSION, "json"]);
        if (!picked) return null;
        const parsed: unknown = JSON.parse(new TextDecoder().decode(picked.data));
        if (!isTitleBlockFile(parsed)) return null;
        return get().addTitleBlock(parsed.titleBlock);
      },

      managerOpen: false,
      managerInitialTab: null,
      openManager: (tab) => set({ managerOpen: true, managerInitialTab: tab ?? null }),
      closeManager: () => set({ managerOpen: false }),
    }),
    {
      name: "mabucad-drawing-templates",
      partialize: (state) => ({
        borders: state.borders,
        titleBlocks: state.titleBlocks,
        sheetFormats: state.sheetFormats,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) seedTemplateIdCounter(highestIdSuffix(state));
      },
    },
  ),
);
