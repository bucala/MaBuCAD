use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// The debug log always lives next to the running executable — "the folder where the
/// app is installed", the same thing a user without any Rust/Tauri background would mean
/// by that phrase, and stable across app versions unlike a per-version resource path.
fn log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "executable has no parent directory".to_string())?;
    let _ = app; // reserved for a future app-handle-derived path if this ever needs one
    Ok(dir.join("mabucad-debug.log"))
}

/// Resolved path only, for Settings to show the user where the file will be — called
/// once when Debug Mode is switched on, not on every log line.
#[tauri::command]
pub fn get_debug_log_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(log_path(&app)?.to_string_lossy().into_owned())
}

/// Appends `contents` (already newline-terminated, possibly several lines batched by the
/// frontend's own flush interval — see `src/debug/logger.ts`) to the log file, creating
/// it if this is the first write this run. Returns the resolved path so the caller can
/// keep it without a second round trip.
#[tauri::command]
pub fn append_debug_log(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    let path = log_path(&app)?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;

    file.write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}
