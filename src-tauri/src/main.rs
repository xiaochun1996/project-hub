// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod git_engine;
mod models;

use crate::git_engine::{
    compute_ahead_behind, compute_working_state, derive_sync_status, detect_base_branch,
};
use crate::models::ProjectStatus;
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

#[tauri::command]
fn get_project_status(path: String, base_branch: Option<String>) -> Result<ProjectStatus, String> {
    let resolved_base = match base_branch {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => detect_base_branch(&path),
    };

    let working_state = compute_working_state(&path);
    let (ahead, behind) = compute_ahead_behind(&path, &resolved_base);
    let sync_status = derive_sync_status(ahead, behind);

    Ok(ProjectStatus {
        working_state,
        ahead,
        behind,
        sync_status,
        base_branch: resolved_base,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            bump_launch_count,
            get_project_status,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::list_projects,
            commands::projects::update_project,
            commands::projects::scan_directory,
            commands::projects::import_projects,
        ])
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
