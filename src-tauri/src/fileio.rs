use std::fs;
use std::path::PathBuf;

/// Writes bytes to a path the user chose in a save dialog.
///
/// A dedicated command rather than the filesystem plugin: exports go to arbitrary
/// locations, which would need a permissive plugin scope, whereas this pair of commands
/// grants exactly the access the interchange feature needs and nothing else.
#[tauri::command]
pub fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(path);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, contents).map_err(|error| error.to_string())
}

/// Reads a file the user chose in an open dialog.
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(PathBuf::from(path)).map_err(|error| error.to_string())
}
