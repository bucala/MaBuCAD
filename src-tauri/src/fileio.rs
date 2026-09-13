use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// Filesystem paths the user has explicitly picked in a native dialog (or dropped) during
/// this session, split by the direction the gesture implies.
///
/// The read/write commands below are guarded by these sets. Rather than accepting any
/// path the webview hands them — which is the whole filesystem, exactly the surface a
/// compromised webview would want — they only touch a path a *real* gesture returned:
/// chosen by a human, in this run. Paths stay blessed for the process lifetime so a
/// document's plain Save can keep writing to the location its Save As chose, and a
/// Drawing's "Update View" can keep re-reading the part it was opened from.
///
/// The two directions are deliberately separate sets, not one: what an *open* dialog or a
/// drop hands back is a "read this" decision and never becomes a write target — otherwise
/// a compromised webview could overwrite a file the user merely opened or dragged in. Only
/// a *save* dialog blesses for writing, which is the one gesture where the user chose the
/// path as a destination. Dropped files (see `lib.rs`'s window event handler) land in the
/// readable set: a drop is a file-choosing gesture the same way an open pick is, and the
/// OS — not the webview — is what reports the path.
#[derive(Default)]
pub struct PickedPaths {
  readable: Mutex<HashSet<String>>,
  writable: Mutex<HashSet<String>>,
}

impl PickedPaths {
  pub fn bless_readable(&self, path: &str) {
    if let Ok(mut set) = self.readable.lock() {
      set.insert(path.to_string());
    }
  }

  pub fn bless_writable(&self, path: &str) {
    if let Ok(mut set) = self.writable.lock() {
      set.insert(path.to_string());
    }
  }

  fn may_read(&self, path: &str) -> bool {
    let readable = self.readable.lock().map(|set| set.contains(path)).unwrap_or(false);
    // A path the user chose as a save destination is at least as trusted as one they
    // opened, so reads accept both directions' blessings.
    readable || self.writable.lock().map(|set| set.contains(path)).unwrap_or(false)
  }

  fn may_write(&self, path: &str) -> bool {
    self.writable.lock().map(|set| set.contains(path)).unwrap_or(false)
  }
}

/// Blesses a dialog result for `readable` and returns it as a plain string path.
fn bless_read_from_dialog(app: &AppHandle, picked: Option<tauri_plugin_dialog::FilePath>) -> Option<String> {
  let path = picked?.into_path().ok()?.to_string_lossy().into_owned();
  app.state::<PickedPaths>().bless_readable(&path);
  Some(path)
}

/// Blesses a dialog result for `writable` and returns it as a plain string path.
fn bless_write_from_dialog(app: &AppHandle, picked: Option<tauri_plugin_dialog::FilePath>) -> Option<String> {
  let path = picked?.into_path().ok()?.to_string_lossy().into_owned();
  app.state::<PickedPaths>().bless_writable(&path);
  Some(path)
}

/// Opens a native file-open dialog and returns the picked path, remembered as blessed.
///
/// Runs in Rust rather than through the dialog plugin's webview API on purpose: the
/// blessing is only a security boundary if the *decision to bless* never travels through
/// the webview, and the dialog plugin's JS side hands its results straight back to
/// arbitrary page script. Here the page only ever receives a path that a dialog already
/// blessed, and forging one requires opening a real dialog in front of the user.
#[tauri::command(async)]
pub fn pick_open_path(app: AppHandle, extensions: Vec<String>) -> Option<String> {
  let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
  let mut dialog = app.dialog().file();
  if !exts.is_empty() {
    dialog = dialog.add_filter(exts.join("/").to_uppercase(), &exts);
  }
  bless_read_from_dialog(&app, dialog.blocking_pick_file())
}

/// Opens a native save dialog pre-seeded with `suggested_name` and returns the picked
/// path, blessed as a write target. `None` means the user cancelled.
#[tauri::command(async)]
pub fn pick_save_path(app: AppHandle, suggested_name: String, extensions: Vec<String>) -> Option<String> {
  let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
  let mut dialog = app.dialog().file().set_file_name(suggested_name);
  if !exts.is_empty() {
    dialog = dialog.add_filter(exts.join("/").to_uppercase(), &exts);
  }
  bless_write_from_dialog(&app, dialog.blocking_save_file())
}

/// Writes bytes to a path the user chose as a save destination in a native dialog this
/// session — the only gesture that blesses for writing, so a file the user merely opened
/// or dropped can never be overwritten through the webview.
#[tauri::command]
pub fn write_binary_file(app: AppHandle, path: String, contents: Vec<u8>) -> Result<(), String> {
  if !app.state::<PickedPaths>().may_write(&path) {
    return Err(format!(
      "Refusing to write to {path}: not a location chosen in a save dialog this session"
    ));
  }

  let path = PathBuf::from(&path);
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }

  fs::write(&path, contents).map_err(|error| error.to_string())
}

/// Reads a file the user picked in a native dialog (or dropped) this session, or chose
/// as a save destination.
#[tauri::command]
pub fn read_binary_file(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
  if !app.state::<PickedPaths>().may_read(&path) {
    return Err(format!(
      "Refusing to read {path}: not a location chosen in a file dialog this session"
    ));
  }

  fs::read(PathBuf::from(&path)).map_err(|error| error.to_string())
}

/// What `lib.rs`'s drag-drop window event handler forwards to the frontend: a dropped
/// file's plain name and its (already blessed) path. The frontend imports STEP/STL from
/// it; a `.mabucad` is deliberately left to File ▸ Open.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
  pub name: String,
  pub path: String,
}

/// Blesses (for reading only — a drop is a "look at this" gesture, never a permission to
/// overwrite) and announces a dropped file to the frontend. Called from the window event
/// handler, where the OS — not the webview — is what reported the path.
pub fn announce_dropped_file(window: &tauri::Window, path: &std::path::Path) {
  let path_string = path.to_string_lossy().into_owned();
  window.state::<PickedPaths>().bless_readable(&path_string);
  let name = path
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_else(|| path_string.clone());

  let _ = window.emit(
    "file-dropped",
    DroppedFile {
      name,
      path: path_string,
    },
  );
}

#[cfg(test)]
mod tests {
  use super::PickedPaths;

  /// The direction split is the security property: an open pick or a drop grants reads
  /// only, so a path that merely passed through the webview as "import this" can never be
  /// turned into an overwrite target, while a save pick keeps granting plain Save's
  /// repeated writes to the same destination.
  #[test]
  fn open_and_drop_blessings_never_grant_writes() {
    let picked = PickedPaths::default();
    picked.bless_readable("C:/parts/bracket.step");
    assert!(picked.may_read("C:/parts/bracket.step"));
    assert!(!picked.may_write("C:/parts/bracket.step"));
  }

  #[test]
  fn save_blessing_grants_writes_and_reads() {
    let picked = PickedPaths::default();
    picked.bless_writable("C:/parts/bracket.mabucad");
    assert!(picked.may_write("C:/parts/bracket.mabucad"));
    assert!(picked.may_read("C:/parts/bracket.mabucad"));
  }

  #[test]
  fn unblessed_paths_grant_nothing() {
    let picked = PickedPaths::default();
    assert!(!picked.may_read("C:/Windows/system32/config.sam"));
    assert!(!picked.may_write("C:/Windows/system32/config.sam"));
  }
}
