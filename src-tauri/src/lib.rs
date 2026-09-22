mod app_info;
mod debug_log;
mod fileio;

/// Entry point shared by the desktop binary (`main.rs`) and the mobile runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(fileio::PickedPaths::default())
    // A file dropped onto the window never travels through the webview on its way in:
    // the OS reports it to Rust here, which blesses the path (a drop is a user
    // file-choosing gesture exactly like a dialog pick — see `PickedPaths`) and forwards
    // name + path to the frontend's import flow. With `dragDropEnabled` on and no
    // handler, a drop used to do nothing at all — silently, since Tauri swallows the
    // webview's default "navigate to the file" behaviour by design.
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
        if let Some(path) = paths.first() {
          fileio::announce_dropped_file(window, path);
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      app_info::get_app_info,
      fileio::pick_open_path,
      fileio::pick_save_path,
      fileio::write_binary_file,
      fileio::read_binary_file,
      fileio::stat_file,
      debug_log::get_debug_log_path,
      debug_log::append_debug_log
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
