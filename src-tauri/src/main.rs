// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_store::StoreExt;

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<(String, u64), String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("failed to open store: {e}"))?;

    let theme: String = store
        .get("theme")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_else(|| "light".to_string());

    let launch_count: u64 = store
        .get("launch_count")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or(0);

    Ok((theme, launch_count))
}

#[tauri::command]
fn bump_launch_count(app: tauri::AppHandle) -> Result<u64, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("failed to open store: {e}"))?;

    let current: u64 = store
        .get("launch_count")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or(0);
    let next = current + 1;

    store.set("launch_count", serde_json::Value::from(next));

    store
        .save()
        .map_err(|e| format!("failed to save store: {e}"))?;

    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![get_settings, bump_launch_count])
        .setup(|app| {
            let store = app
                .store("settings.json")
                .map_err(|e| -> Box<dyn std::error::Error> { format!("failed to open store: {e}").into() })?;
            if !store.has("launch_count") {
                store.set("launch_count", serde_json::Value::from(0u64));
                store
                    .save()
                    .map_err(|e| -> Box<dyn std::error::Error> { format!("failed to save store: {e}").into() })?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
