import { useCallback, useEffect, useRef } from "react";

/** How far the pointer may travel between press and release and still count as a click. */
const DRAG_THRESHOLD_PX = 4;

export interface ClickGuardEvent {
  nativeEvent: MouseEvent;
}

/**
 * Distinguishes a genuine pick from the tail end of a navigation drag.
 *
 * Without this, releasing an orbit or pan over a plane fires a click and selects it, and
 * left-dragging across the graphics area selects whatever sits under the release point.
 * Returns true only for a real left-button click that did not travel.
 *
 * The press is recorded on `window` in the capture phase so it is seen even when the
 * gesture starts outside the object that ends up receiving the click.
 */
export function useClickGuard(): (event: ClickGuardEvent) => boolean {
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleDown = (event: PointerEvent) => {
      pressedAt.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener("pointerdown", handleDown, true);
    return () => window.removeEventListener("pointerdown", handleDown, true);
  }, []);

  return useCallback((event: ClickGuardEvent) => {
    if (event.nativeEvent.button !== 0) {
      return false;
    }

    const start = pressedAt.current;
    if (!start) {
      return false;
    }

    const travelled = Math.hypot(
      event.nativeEvent.clientX - start.x,
      event.nativeEvent.clientY - start.y,
    );

    return travelled <= DRAG_THRESHOLD_PX;
  }, []);
}
