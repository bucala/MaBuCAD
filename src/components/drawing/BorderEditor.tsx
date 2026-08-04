import { Download } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { useTemplateStore } from "@/state/templateStore";

import { SheetBorder } from "./DrawingSheet";
import styles from "./TemplateManagerDialog.module.css";

const PREVIEW_WIDTH = 297;
const PREVIEW_HEIGHT = 210;

/**
 * Parametric editor for one `BorderTemplate` — a border is just a zone-grid recipe
 * (margin, column/row counts, centre marks), never freeform artwork, so this is a plain
 * numeric form rather than a drawing tool. Renders live via the exact same `SheetBorder`
 * component `DrawingSheet.tsx` uses, so what's previewed here is what a document using
 * this border actually gets — always against a fixed A4-landscape-shaped preview area
 * regardless of which sheet sizes the border ends up used on.
 */
export function BorderEditor({ borderId }: { borderId: string }) {
  const border = useTemplateStore((state) => state.borders.find((b) => b.id === borderId));
  const updateBorder = useTemplateStore((state) => state.updateBorder);
  const exportBorder = useTemplateStore((state) => state.exportBorder);
  const { t } = useTranslation();

  if (!border) return null;

  return (
    <div className={styles.editor}>
      <div className={styles.editorForm}>
        <label className={styles.field}>
          <span>{t("templates.name", "Name")}</span>
          <input
            type="text"
            value={border.name}
            onChange={(event) => updateBorder(border.id, { name: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>{t("templates.border.margin", "Margin (mm)")}</span>
          <input
            type="number"
            min={2}
            value={border.margin}
            onChange={(event) => updateBorder(border.id, { margin: Number(event.target.value) || 0 })}
          />
        </label>
        <label className={styles.field}>
          <span>{t("templates.border.columns", "Zone columns")}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={border.zoneColumns}
            onChange={(event) =>
              updateBorder(border.id, { zoneColumns: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        </label>
        <label className={styles.field}>
          <span>{t("templates.border.rows", "Zone rows")}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={border.zoneRows}
            onChange={(event) => updateBorder(border.id, { zoneRows: Math.max(1, Number(event.target.value) || 1) })}
          />
        </label>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={border.centreMarks}
            onChange={(event) => updateBorder(border.id, { centreMarks: event.target.checked })}
          />
          <span>{t("templates.border.centre-marks", "Centre marks")}</span>
        </label>

        <button type="button" className={styles.secondaryButton} onClick={() => void exportBorder(border.id)}>
          <Download size={13} strokeWidth={1.75} />
          {t("templates.export", "Export…")}
        </button>
      </div>

      <div className={styles.previewWrap}>
        <svg
          className={styles.previewSheet}
          width={PREVIEW_WIDTH * 2}
          height={PREVIEW_HEIGHT * 2}
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
        >
          <SheetBorder width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} border={border} />
        </svg>
      </div>
    </div>
  );
}
