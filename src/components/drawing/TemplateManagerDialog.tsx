import { useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload, X } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { useDocumentStore } from "@/state/documentStore";
import { useTemplateStore } from "@/state/templateStore";
import type { SheetOrientation, SheetSize } from "@/types/drawingTemplates";

import { BorderEditor } from "./BorderEditor";
import { TitleBlockEditor } from "./TitleBlockEditor";
import styles from "./TemplateManagerDialog.module.css";

const SHEET_SIZES: SheetSize[] = ["A4", "A3", "A2", "A1", "A0"];
const TABS = ["formats", "borders", "titleblocks"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, string> = {
  formats: "Sheet Formats",
  borders: "Borders",
  titleblocks: "Title Blocks",
};

/** Inline editor for one `SheetFormat`: which size/orientation/border/title-block it
 * pairs, plus a shortcut to apply it to whichever Drawing is currently active. */
function SheetFormatEditor({ formatId }: { formatId: string }) {
  const format = useTemplateStore((state) => state.sheetFormats.find((f) => f.id === formatId));
  const borders = useTemplateStore((state) => state.borders);
  const titleBlocks = useTemplateStore((state) => state.titleBlocks);
  const updateSheetFormat = useTemplateStore((state) => state.updateSheetFormat);
  const activeDocument = useDocumentStore((state) => state.document);
  const setDrawingSheet = useDocumentStore((state) => state.setDrawingSheet);
  const { t } = useTranslation();

  if (!format) return null;

  const canApply = activeDocument.kind === "drawing" && !!activeDocument.drawing;

  return (
    <div className={styles.editorForm} style={{ width: "100%" }}>
      <label className={styles.field}>
        <span>{t("templates.name", "Name")}</span>
        <input
          type="text"
          value={format.name}
          onChange={(event) => updateSheetFormat(format.id, { name: event.target.value })}
        />
      </label>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span>{t("templates.format.size", "Paper size")}</span>
          <select
            value={format.size}
            onChange={(event) => updateSheetFormat(format.id, { size: event.target.value as SheetSize })}
          >
            {SHEET_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("templates.format.orientation", "Orientation")}</span>
          <select
            value={format.orientation}
            onChange={(event) =>
              updateSheetFormat(format.id, { orientation: event.target.value as SheetOrientation })
            }
          >
            <option value="landscape">{t("templates.format.landscape", "Landscape")}</option>
            <option value="portrait">{t("templates.format.portrait", "Portrait")}</option>
          </select>
        </label>
      </div>
      <label className={styles.field}>
        <span>{t("templates.format.border", "Border")}</span>
        <select
          value={format.borderTemplateId}
          onChange={(event) => updateSheetFormat(format.id, { borderTemplateId: event.target.value })}
        >
          {borders.map((border) => (
            <option key={border.id} value={border.id}>
              {border.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>{t("templates.format.titleblock", "Title Block")}</span>
        <select
          value={format.titleBlockTemplateId}
          onChange={(event) => updateSheetFormat(format.id, { titleBlockTemplateId: event.target.value })}
        >
          {titleBlocks.map((block) => (
            <option key={block.id} value={block.id}>
              {block.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={styles.primaryButton}
        disabled={!canApply}
        title={canApply ? undefined : t("templates.format.apply-disabled", "Open a Drawing document first")}
        onClick={() => {
          if (!activeDocument.drawing) return;
          setDrawingSheet({ ...activeDocument.drawing, sheetFormatId: format.id });
        }}
      >
        {t("templates.format.apply", "Apply to Current Drawing")}
      </button>
    </div>
  );
}

/**
 * Drawing Resources: the library of Sheet Formats, Borders and Title Blocks
 * (`state/templateStore.ts`), with New/Delete/Export per item and Import per category.
 * Opened from the Drawing ribbon's Sheet Format button and `DrawingSheet.tsx`'s own
 * toolbar — both just call `templateStore.openManager()`.
 */
export function TemplateManagerDialog() {
  const open = useTemplateStore((state) => state.managerOpen);
  const initialTab = useTemplateStore((state) => state.managerInitialTab);
  const close = useTemplateStore((state) => state.closeManager);
  const sheetFormats = useTemplateStore((state) => state.sheetFormats);
  const borders = useTemplateStore((state) => state.borders);
  const titleBlocks = useTemplateStore((state) => state.titleBlocks);
  const addSheetFormat = useTemplateStore((state) => state.addSheetFormat);
  const addBorder = useTemplateStore((state) => state.addBorder);
  const addTitleBlock = useTemplateStore((state) => state.addTitleBlock);
  const deleteSheetFormat = useTemplateStore((state) => state.deleteSheetFormat);
  const deleteBorder = useTemplateStore((state) => state.deleteBorder);
  const deleteTitleBlock = useTemplateStore((state) => state.deleteTitleBlock);
  const importBorder = useTemplateStore((state) => state.importBorder);
  const importTitleBlock = useTemplateStore((state) => state.importTitleBlock);

  const [activeTab, setActiveTab] = useState<TabId>("formats");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Lands on whichever tab `openManager(tab)` was asked for (e.g. the sheet's own "Edit
  // Background" button jumping straight to Borders) — read once per open, so navigating
  // tabs inside the dialog afterwards isn't fought by this effect re-running.
  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const list = activeTab === "formats" ? sheetFormats : activeTab === "borders" ? borders : titleBlocks;
  const selected = list.find((item) => item.id === selectedId) ?? null;

  const addNew = () => {
    if (activeTab === "formats") {
      if (borders.length === 0 || titleBlocks.length === 0) return;
      const id = addSheetFormat({
        name: t("templates.new-format", "New Sheet Format"),
        size: "A3",
        orientation: "landscape",
        borderTemplateId: borders[0].id,
        titleBlockTemplateId: titleBlocks[0].id,
      });
      setSelectedId(id);
    } else if (activeTab === "borders") {
      const id = addBorder({
        name: t("templates.new-border", "New Border"),
        margin: 10,
        zoneColumns: 8,
        zoneRows: 6,
        centreMarks: true,
      });
      setSelectedId(id);
    } else {
      const id = addTitleBlock({ name: t("templates.new-titleblock", "New Title Block"), width: 180, height: 50, fields: [] });
      setSelectedId(id);
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (activeTab === "formats") deleteSheetFormat(selected.id);
    else if (activeTab === "borders") deleteBorder(selected.id);
    else deleteTitleBlock(selected.id);
    setSelectedId(null);
  };

  const importCurrent = async () => {
    const id = activeTab === "borders" ? await importBorder() : activeTab === "titleblocks" ? await importTitleBlock() : null;
    if (id) setSelectedId(id);
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) close();
      }}
    >
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Drawing Resources">
        <div className={styles.header}>
          <h2 className={styles.title}>{t("templates.title", "Drawing Resources")}</h2>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={close}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.tabStrip} role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={activeTab === tab}
              onClick={() => {
                setActiveTab(tab);
                setSelectedId(null);
              }}
            >
              {t(`templates.tab.${tab}`, TAB_LABELS[tab])}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          <div className={styles.list}>
            {list.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.listItem}
                data-selected={item.id === selectedId || undefined}
                onClick={() => setSelectedId(item.id)}
              >
                <span className={styles.listItemName}>{item.name}</span>
              </button>
            ))}
            <div className={styles.listFooter}>
              <button type="button" className={styles.listFooterButton} onClick={addNew}>
                <Plus size={13} strokeWidth={1.75} />
                {t("templates.new", "New")}
              </button>
              {activeTab !== "formats" && (
                <button type="button" className={styles.listFooterButton} onClick={() => void importCurrent()}>
                  <Upload size={13} strokeWidth={1.75} />
                  {t("templates.import", "Import…")}
                </button>
              )}
              {selected && (
                <button type="button" className={styles.listFooterButton} onClick={deleteSelected}>
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>

          <div className={styles.detail}>
            {!selected && (
              <div className={styles.emptyDetail}>
                {t("templates.select-hint", "Select an item on the left, or create a new one.")}
              </div>
            )}
            {selected && activeTab === "formats" && <SheetFormatEditor formatId={selected.id} />}
            {selected && activeTab === "borders" && <BorderEditor borderId={selected.id} />}
            {selected && activeTab === "titleblocks" && <TitleBlockEditor titleBlockId={selected.id} />}
          </div>
        </div>

        <div className={styles.footer}>
          <span style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
            <Download size={12} strokeWidth={1.75} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            {t("templates.export-hint", "Export a Border or Title Block from its own editor panel.")}
          </span>
          <div className={styles.footerSpacer} />
          <button type="button" className={styles.footerButton} onClick={close}>
            {t("templates.close", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
