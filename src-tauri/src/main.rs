#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export;

// MacMovieMaker — Milestone 6.
// The webview owns playback, thumbnails, and the export plan (filter graph);
// the backend spawns ffmpeg (bundled sidecar or system PATH fallback) with
// std::process only — no shell plugin, so no shell capabilities are needed.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(export::ExportState::new())
        .invoke_handler(tauri::generate_handler![
            export::export_movie,
            export::export_cancel,
            export::probe_media,
            export::open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running MacMovieMaker");
}
