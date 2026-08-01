import { useEffect, useState } from "react";

import styles from "./DimensionValueField.module.css";

/** Accepts either "." or "," as the decimal separator — a plain `Number()` call rejects
 * a comma outright, and a comma is the ordinary decimal key on most non-US keyboard
 * layouts (Slovak included), which made this field impossible to type into at all. */
export function parseLocaleNumber(text: string): number {
  return Number(text.trim().replace(",", "."));
}

/**
 * A driving dimension's editable value — shared by the Property Manager's dimension list
 * and the dimension's own floating label in the viewport (double-click to edit in place).
 *
 * Not a plain `<input type="number">` bound straight to the store for two reasons: that
 * type rejects a typed comma outright on some locales, and even where it doesn't, binding
 * `value` straight to the store echoes the parsed number back on every keystroke — typing
 * "55." only for the trailing dot to vanish immediately (re-rendered from the number 55)
 * makes it impossible to ever type a fractional value one character at a time. Local text
 * state keeps exactly what was typed on screen; it only snaps back to the store's value
 * when that value changed for some other reason (undo, another field, a drag) — detected
 * by comparing the parse of the current text against the incoming value rather than a
 * blur/focus flag, so a programmatic `.fill()` (no real focus event) still commits.
 */
export function DimensionValueField({
  dimensionId,
  value,
  label,
  onCommit,
  onBlur,
  autoFocus,
  className,
}: {
  dimensionId: string;
  value: number;
  label: string;
  onCommit: (dimensionId: string, value: number) => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() => String(value));

  useEffect(() => {
    if (parseLocaleNumber(text) !== value) setText(String(value));
    // Only react to the store's value changing — re-running this because `text` itself
    // changed would fight every keystroke instead of only resyncing external updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className={className ? `${styles.input} ${className}` : styles.input}
      type="text"
      inputMode="decimal"
      aria-label={label}
      data-dimension-input={dimensionId}
      autoFocus={autoFocus}
      value={text}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const parsed = parseLocaleNumber(raw);
        if (Number.isFinite(parsed)) onCommit(dimensionId, parsed);
      }}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}
