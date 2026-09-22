import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DrawingSourceStamp } from "@/types/document";

/**
 * File access for interchange.
 *
 * Inside Tauri the dialogs are opened by the Rust side (`pick_open_path`/`pick_save_path`
 * in `src-tauri/src/fileio.rs`), which remembers every path it handed out and gates the
 * read/write commands on that set — the page never gets to name a location the user
 * didn't choose in a real dialog or a real drop. In a plain browser — `vite dev`, and the
 * automated tests — the same calls fall back to a download and a file input, so the
 * export and import paths can be exercised without packaging the desktop app.
 */

export interface PickedFile {
  name: string;
  data: ArrayBuffer;
  /**
   * The real filesystem path the user picked, only ever set inside Tauri — the browser's
   * File API hands back a blob with no reusable location. A Drawing's "Update View" uses
   * this (via `readFileAtPath` below) to silently re-read a referenced part without
   * re-prompting; with no path it falls back to asking the user to pick the file again.
   */
  path: string | null;
}

/** Writes a blob to a location the user chooses. Returns the path saved to, or null if they
 * cancelled — the browser fallback has no real path, so it returns `""` on success there. */
export async function saveBlobAs(
  blob: Blob,
  suggestedName: string,
  extensions: string[],
): Promise<string | null> {
  if (!isTauri()) {
    downloadInBrowser(blob, suggestedName);
    return "";
  }

  const path = await invoke<string | null>("pick_save_path", { suggestedName, extensions });
  if (!path) return null;

  await writeBinaryAtPath(path, blob);
  return path;
}

/** Writes a blob directly to an already-known path, no dialog — what plain Save uses once a
 * document has a real file behind it, so re-saving never re-prompts for a location the way
 * Save As deliberately does. The Rust side only honours paths one of its own dialogs (or a
 * drop) handed back this session, which is exactly where a document's `filePath` comes
 * from. Browser-only sessions have no such path to begin with (`saveBlobAs` always
 * returns `""` there), so callers only reach this inside Tauri. */
export async function writeBinaryAtPath(path: string, blob: Blob): Promise<void> {
  const contents = Array.from(new Uint8Array(await blob.arrayBuffer()));
  await invoke("write_binary_file", { path, contents });
}

/** Writes a blob to a location the user chooses. Returns false if they cancelled.
 * @deprecated kept for callers that only need the boolean outcome; prefer `saveBlobAs` when
 * the resulting path needs to be remembered (e.g. so a later plain Save can reuse it). */
export async function saveBlob(blob: Blob, suggestedName: string, extensions: string[]): Promise<boolean> {
  return (await saveBlobAs(blob, suggestedName, extensions)) !== null;
}

/** Reads a file the user chooses. Returns null if they cancelled. */
export async function openFile(extensions: string[]): Promise<PickedFile | null> {
  if (!isTauri()) {
    return pickInBrowser(extensions);
  }

  const path = await invoke<string | null>("pick_open_path", { extensions });
  if (!path) return null;

  const contents = await invoke<number[]>("read_binary_file", { path });
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    data: Uint8Array.from(contents).buffer,
    path,
  };
}

/**
 * Re-reads a file at a path previously returned by `openFile` (or announced by the Rust
 * drag-drop handler), with no dialog — Tauri only, since it's the only mode that ever
 * hands back a real `path` to begin with. Callers must check for a `null` path themselves
 * (see `PickedFile.path`'s own doc comment) rather than calling this speculatively.
 */
export async function readFileAtPath(path: string): Promise<ArrayBuffer> {
  const contents = await invoke<number[]>("read_binary_file", { path });
  return Uint8Array.from(contents).buffer;
}

/**
 * Metadata (mtime + size) of a previously-picked file path — what a Drawing's "are the
 * views still current?" check compares against the stamp captured at projection time.
 * Metadata only, no file contents: the check stays as cheap as the OS lets it be. Tauri
 * only, since only it hands out real paths; returns `null` when the browser fallback is
 * in use or the path isn't blessed this session (see `fileio.rs`'s `stat_file`), so the
 * caller can treat "can't verify" and "up to date" the same way.
 */
export async function statAtPath(path: string): Promise<DrawingSourceStamp | null> {
  if (!isTauri()) return null;
  return invoke<DrawingSourceStamp | null>("stat_file", { path });
}

function downloadInBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in some browsers, so give it a tick.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickInBrowser(extensions: string[]): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((extension) => `.${extension}`).join(",");
    input.style.display = "none";
    input.setAttribute("data-testid", "import-file-input");

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { name: file.name, data: await file.arrayBuffer(), path: null } : null);
    });

    // A cancelled picker fires no event in some browsers; the element is cleaned up when
    // the next import runs rather than being leaked indefinitely.
    document.body.appendChild(input);
    input.click();
  });
}
