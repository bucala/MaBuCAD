import { useEffect, useState } from "react";

/**
 * Mirrors the theme resolution in `src/styles/tokens.css`: the system preference decides,
 * unless `data-theme` on the root element overrides it.
 *
 * Needed because scene colours live in WebGL materials rather than CSS, so they cannot
 * pick up custom properties and have to be resolved in JavaScript.
 */
function resolveIsDark(): boolean {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(resolveIsDark);

  useEffect(() => {
    const update = () => setIsDark(resolveIsDark());

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);

    // Catch manual overrides written to the root element.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return isDark;
}
