import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/**
 * File access for interchange.
 *
 * Inside Tauri the user picks a path with a native dialog and the bytes go through a
 * dedicated Rust command. In a plain browser — `vite dev`, and the automated tests — the
 * same calls fall back to a download and a file input, so the export and import paths can
 * be exercised without packaging the desktop app.
 */

export interface PickedFile {
  name: string;
  data: ArrayBuffer;
}

/** Writes a blob to a location the user chooses. Returns false if they cancelled. */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  extensions: string[],
): Promise<boolean> {
  if (!isTauri()) {
    downloadInBrowser(blob, suggestedName);
    return true;
  }

  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: extensions.join("/").toUpperCase(), extensions }],
  });

  if (!path) return false;

  const contents = Array.from(new Uint8Array(await blob.arrayBuffer()));
  await invoke("write_binary_file", { path, contents });
  return true;
}

/** Reads a file the user chooses. Returns null if they cancelled. */
export async function openFile(extensions: string[]): Promise<PickedFile | null> {
  if (!isTauri()) {
    return pickInBrowser(extensions);
  }

  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: extensions.join("/").toUpperCase(), extensions }],
  });

  if (typeof path !== "string") return null;

  const contents = await invoke<number[]>("read_binary_file", { path });
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    data: Uint8Array.from(contents).buffer,
  };
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
      resolve(file ? { name: file.name, data: await file.arrayBuffer() } : null);
    });

    // A cancelled picker fires no event in some browsers; the element is cleaned up when
    // the next import runs rather than being leaked indefinitely.
    document.body.appendChild(input);
    input.click();
  });
}
