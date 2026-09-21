import type { Language } from "@/i18n/languages";
import { translateFor } from "@/i18n/useTranslation";
import { viewPointToSheet } from "@/kernel/drawingGeometry";
import type { DrawingHoleCalloutMetadata, DrawingHoleTargetData, DrawingViewData } from "@/types/document";

function formatMillimetres(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatDesignation(value: string): string {
  return value.replace(/x(?=\d)/gi, "×");
}

/** Formats the manufacturing callout shown on the sheet, one line per fact, seat first: the
 * counterbore/spotface/countersink recess (ISO 15786's ⌴/⌵ symbols), then the hole or
 * thread designation, then depth/through semantics. Only the words localise — the
 * ⌀/↧/×/⌴/⌵ symbols are the drawing standards' own, identical in every language — and
 * English is the fallback for every language without a dictionary, matching
 * `useTranslation`. Thread direction follows ISO/ASME convention: right-hand is the
 * default and is never annotated, only a left-hand thread gets an LH token. A through
 * hole prints the word "THRU"/"CEZ" — deliberately borrowed ASME-style practice, the
 * wording a shop floor actually reads — rather than ISO 15786's own convention, which
 * signals a through hole by omitting the depth indication entirely. */
export function formatHoleCallout(metadata: DrawingHoleCalloutMetadata, language: Language): string[] {
  const t = translateFor(language);
  const depth = `↧ ${formatMillimetres(metadata.holeDepth)} mm`;
  const lines: string[] = [];

  // Seat fields are snapshotted raw from the feature, so any piece can be absent on an
  // older saved document — a missing number drops its own token instead of being invented.
  if (metadata.seatType && metadata.seatType !== "none" && metadata.seatDiameter !== undefined) {
    const seatDiameter = `⌀${formatMillimetres(metadata.seatDiameter)}`;
    if (metadata.seatType === "countersink") {
      // Every countersink seat standard in `data/holeStandards.ts` uses a 90° included
      // angle, and the kernel's own default when the field is absent is 90 too.
      lines.push(`⌵${seatDiameter} ${Math.round(metadata.seatDepthOrAngle ?? 90)}°`);
    } else {
      lines.push(
        metadata.seatDepthOrAngle === undefined
          ? `⌴${seatDiameter}`
          : `⌴${seatDiameter} ↧ ${formatMillimetres(metadata.seatDepthOrAngle)} mm`,
      );
    }
  }

  if (metadata.holeType === "tapped" || metadata.holeType === "taper-tapped") {
    lines.push(
      [
        formatDesignation(metadata.designation ?? `⌀${formatMillimetres(metadata.diameter)}`),
        metadata.threadClass,
        metadata.threadDirection === "left" ? "LH" : "",
      ]
        .filter(Boolean)
        .join(" - "),
    );

    if (metadata.fullDepthThread === false && metadata.threadDepth !== undefined) {
      lines.push(`${t("holeCallout.threadDepth", "THREAD DEPTH")} ↧ ${formatMillimetres(metadata.threadDepth)} mm`);
    } else if (metadata.endCondition === "through-all") {
      lines.push(t("holeCallout.thru", "THRU"));
    } else if (metadata.fullDepthThread !== false) {
      lines.push(`${t("holeCallout.fullThread", "FULL THREAD")} ${depth}`);
    } else {
      // A shortened thread that never got a real engagement length (an older saved
      // document): report the drilled depth, never an invented thread depth.
      lines.push(depth);
    }

    return lines;
  }

  const size =
    metadata.holeType === "clearance" && metadata.designation
      ? ` ${metadata.designation}${metadata.holeFit ? ` ${metadata.holeFit.toUpperCase()}` : ""}`
      : "";
  lines.push(`⌀${formatMillimetres(metadata.diameter)}${size}`);
  lines.push(metadata.endCondition === "through-all" ? t("holeCallout.thru", "THRU") : depth);
  return lines;
}

/** Maps one raw projected target into the sheet-mm coordinate system used by annotations —
 * the shared `viewPointToSheet` transform (the single source of truth for the view render
 * transform) plus the circle's own radius scaled the same way. */
export function holeTargetSheetPoint(
  view: DrawingViewData,
  target: DrawingHoleTargetData,
): { x: number; y: number; radius: number } {
  const centre = viewPointToSheet(view, { x: target.cx, y: target.cy });
  return { ...centre, radius: target.radius * view.scale };
}

/** Finds the nearest projected hole circumference, not merely the nearest centre, so the
 * tool behaves like a CAD edge picker. */
export function nearestHoleTarget(
  views: DrawingViewData[],
  point: { x: number; y: number },
  tolerance: number,
): { viewId: string; target: DrawingHoleTargetData; x: number; y: number } | null {
  let best: { viewId: string; target: DrawingHoleTargetData; x: number; y: number } | null = null;
  let bestDistance = tolerance;

  for (const view of views) {
    for (const target of view.holeTargets ?? []) {
      const sheet = holeTargetSheetPoint(view, target);
      const radialDistance = Math.abs(Math.hypot(point.x - sheet.x, point.y - sheet.y) - sheet.radius);
      if (radialDistance < bestDistance) {
        bestDistance = radialDistance;
        best = { viewId: view.id, target, x: sheet.x, y: sheet.y };
      }
    }
  }
  return best;
}
