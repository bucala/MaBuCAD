import { useRef, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { useTemplateStore } from "@/state/templateStore";
import type { TitleBlockField } from "@/types/drawingTemplates";

import sheetStyles from "./DrawingSheet.module.css";
import styles from "./TemplateManagerDialog.module.css";

/** Pixels per mm the live preview renders at — drag/resize deltas (real screen pixels)
 * are divided by this to land back in the title block's own mm coordinate space. */
const PREVIEW_SCALE = 4;

function clamp(value: number, min: number): number {
  return Math.max(min, value);
}

/** One field's box in the live preview: click to select, drag the body to move it, drag
 * the small bottom-right handle to resize it. Both gestures go through the Pointer Events
 * API with `setPointerCapture` so the drag keeps tracking even if the cursor leaves the
 * small field rect mid-gesture. */
function FieldBox({
  field,
  selected,
  onSelect,
  onMove,
  onResize,
}: {
  field: TitleBlockField;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
}) {
  const moveOrigin = useRef<{ x: number; y: number; fieldX: number; fieldY: number } | null>(null);
  const resizeOrigin = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  return (
    <g>
      <rect
        x={field.x}
        y={field.y}
        width={field.width}
        height={field.height}
        className={selected ? sheetStyles.titleBlockCellSelected : sheetStyles.titleBlockCell}
        onPointerDown={(event) => {
          onSelect();
          event.currentTarget.setPointerCapture(event.pointerId);
          moveOrigin.current = { x: event.clientX, y: event.clientY, fieldX: field.x, fieldY: field.y };
        }}
        onPointerMove={(event) => {
          if (!moveOrigin.current) return;
          const dx = (event.clientX - moveOrigin.current.x) / PREVIEW_SCALE;
          const dy = (event.clientY - moveOrigin.current.y) / PREVIEW_SCALE;
          onMove(clamp(moveOrigin.current.fieldX + dx, 0), clamp(moveOrigin.current.fieldY + dy, 0));
        }}
        onPointerUp={() => {
          moveOrigin.current = null;
        }}
      />
      <text x={field.x + 1} y={field.y + 2.4} className={sheetStyles.titleBlockLabel}>
        {field.label}
      </text>
      {selected && (
        <rect
          x={field.x + field.width - 2.5}
          y={field.y + field.height - 2.5}
          width={2.5}
          height={2.5}
          className={styles.resizeHandle}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeOrigin.current = { x: event.clientX, y: event.clientY, width: field.width, height: field.height };
          }}
          onPointerMove={(event) => {
            if (!resizeOrigin.current) return;
            event.stopPropagation();
            const dx = (event.clientX - resizeOrigin.current.x) / PREVIEW_SCALE;
            const dy = (event.clientY - resizeOrigin.current.y) / PREVIEW_SCALE;
            onResize(clamp(resizeOrigin.current.width + dx, 5), clamp(resizeOrigin.current.height + dy, 3));
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            resizeOrigin.current = null;
          }}
        />
      )}
    </g>
  );
}

/**
 * Editor for one `TitleBlockTemplate`: a live preview where fields can be dragged and
 * resized directly, plus a side form for the selected field's label/key/font — the same
 * split every other pick-then-edit flow in this app already uses (e.g. Fillet/Chamfer's
 * edge picking driving `PropertyManager.tsx`'s fields), applied to a title block's cells
 * instead of a solid's edges.
 */
export function TitleBlockEditor({ titleBlockId }: { titleBlockId: string }) {
  const titleBlock = useTemplateStore((state) => state.titleBlocks.find((b) => b.id === titleBlockId));
  const updateTitleBlock = useTemplateStore((state) => state.updateTitleBlock);
  const updateField = useTemplateStore((state) => state.updateTitleBlockField);
  const addField = useTemplateStore((state) => state.addTitleBlockField);
  const deleteField = useTemplateStore((state) => state.deleteTitleBlockField);
  const exportTitleBlock = useTemplateStore((state) => state.exportTitleBlock);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const { t } = useTranslation();

  if (!titleBlock) return null;
  const selectedField = titleBlock.fields.find((field) => field.id === selectedFieldId) ?? null;

  return (
    <div className={styles.editor}>
      <div className={styles.editorForm}>
        <label className={styles.field}>
          <span>{t("templates.name", "Name")}</span>
          <input
            type="text"
            value={titleBlock.name}
            onChange={(event) => updateTitleBlock(titleBlock.id, { name: event.target.value })}
          />
        </label>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>{t("templates.titleblock.width", "Width (mm)")}</span>
            <input
              type="number"
              min={20}
              value={titleBlock.width}
              onChange={(event) => updateTitleBlock(titleBlock.id, { width: Number(event.target.value) || 0 })}
            />
          </label>
          <label className={styles.field}>
            <span>{t("templates.titleblock.height", "Height (mm)")}</span>
            <input
              type="number"
              min={10}
              value={titleBlock.height}
              onChange={(event) => updateTitleBlock(titleBlock.id, { height: Number(event.target.value) || 0 })}
            />
          </label>
        </div>

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => {
            // Dropped just below whatever's already there rather than always at (0, 0) —
            // stacking every new field on top of the same corner would bury it under
            // existing ones, invisible until dragged out from underneath by someone who
            // doesn't yet know it's there.
            const fieldsBottom = titleBlock.fields.reduce((max, field) => Math.max(max, field.y + field.height), 0);
            addField(titleBlock.id, {
              key: `field${titleBlock.fields.length + 1}`,
              label: "FIELD",
              x: 0,
              y: Math.min(fieldsBottom, Math.max(0, titleBlock.height - 7.5)),
              width: 30,
              height: 7.5,
              fontSize: 3,
            });
          }}
        >
          <Plus size={13} strokeWidth={1.75} />
          {t("templates.titleblock.add-field", "Add Field")}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => void exportTitleBlock(titleBlock.id)}>
          <Download size={13} strokeWidth={1.75} />
          {t("templates.export", "Export…")}
        </button>

        {selectedField && (
          <div className={styles.fieldEditor}>
            <span className={styles.fieldEditorTitle}>{t("templates.titleblock.selected-field", "Selected field")}</span>
            <label className={styles.field}>
              <span>{t("templates.titleblock.label", "Label")}</span>
              <input
                type="text"
                value={selectedField.label}
                onChange={(event) => updateField(titleBlock.id, selectedField.id, { label: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>{t("templates.titleblock.key", "Value key")}</span>
              <input
                type="text"
                value={selectedField.key}
                onChange={(event) => updateField(titleBlock.id, selectedField.id, { key: event.target.value })}
              />
            </label>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>X</span>
                <input
                  type="number"
                  value={Math.round(selectedField.x * 10) / 10}
                  onChange={(event) => updateField(titleBlock.id, selectedField.id, { x: Number(event.target.value) || 0 })}
                />
              </label>
              <label className={styles.field}>
                <span>Y</span>
                <input
                  type="number"
                  value={Math.round(selectedField.y * 10) / 10}
                  onChange={(event) => updateField(titleBlock.id, selectedField.id, { y: Number(event.target.value) || 0 })}
                />
              </label>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>{t("templates.titleblock.font-size", "Font size")}</span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={selectedField.fontSize}
                  onChange={(event) =>
                    updateField(titleBlock.id, selectedField.id, { fontSize: Number(event.target.value) || 1 })
                  }
                />
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={!!selectedField.bold}
                  onChange={(event) => updateField(titleBlock.id, selectedField.id, { bold: event.target.checked })}
                />
                <span>{t("templates.titleblock.bold", "Bold")}</span>
              </label>
            </div>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => {
                deleteField(titleBlock.id, selectedField.id);
                setSelectedFieldId(null);
              }}
            >
              <Trash2 size={13} strokeWidth={1.75} />
              {t("templates.titleblock.delete-field", "Delete Field")}
            </button>
          </div>
        )}
      </div>

      <div className={styles.previewWrap}>
        <svg
          className={styles.previewSheet}
          width={titleBlock.width * PREVIEW_SCALE}
          height={titleBlock.height * PREVIEW_SCALE}
          viewBox={`0 0 ${titleBlock.width} ${titleBlock.height}`}
          onPointerDown={() => setSelectedFieldId(null)}
        >
          <rect
            x={0}
            y={0}
            width={titleBlock.width}
            height={titleBlock.height}
            className={sheetStyles.titleBlockOutline}
          />
          {titleBlock.fields.map((field) => (
            <FieldBox
              key={field.id}
              field={field}
              selected={field.id === selectedFieldId}
              onSelect={() => setSelectedFieldId(field.id)}
              onMove={(x, y) => updateField(titleBlock.id, field.id, { x, y })}
              onResize={(width, height) => updateField(titleBlock.id, field.id, { width, height })}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
