import { useEffect, useState } from "react";

export interface ModifierKeys {
  ctrl: boolean;
  shift: boolean;
}

const NO_MODIFIERS: ModifierKeys = { ctrl: false, shift: false };

/**
 * Tracks whether Ctrl or Shift is currently held.
 *
 * Listeners sit on `window` rather than the canvas because the modifier is usually
 * pressed before the pointer enters the viewport. The `blur` reset matters: without it,
 * alt-tabbing away while holding Ctrl never delivers the keyup, and the middle mouse
 * button stays stuck in pan mode when the user comes back.
 */
export function useModifierKeys(): ModifierKeys {
  const [modifiers, setModifiers] = useState<ModifierKeys>(NO_MODIFIERS);

  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      setModifiers((current) =>
        current.ctrl === event.ctrlKey && current.shift === event.shiftKey
          ? current
          : { ctrl: event.ctrlKey, shift: event.shiftKey },
      );
    };

    const reset = () => setModifiers(NO_MODIFIERS);

    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", reset);

    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return modifiers;
}
