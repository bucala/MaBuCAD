use serde::Serialize;

/// Build and runtime identity of the running application, surfaced in the status bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
}

#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle) -> AppInfo {
    let package_info = app.package_info();

    AppInfo {
        name: package_info.name.clone(),
        version: package_info.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}
