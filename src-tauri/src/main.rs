// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod git_engine;
mod gh_integration;
mod models;

use crate::git_engine::{
    compute_ahead_behind, compute_working_state, derive_sync_status, detect_base_branch,
};
use crate::models::ProjectStatus;
use gh_integration::GhError;
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
    let _ = crate::git_engine::run_git(&path, &[
        "-c", "http.lowSpeedLimit=1000",
        "-c", "http.lowSpeedTime=10",
        "fetch", "origin",
    ]);

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

#[tauri::command]
fn get_open_issues_count(path: String) -> Result<u32, GhError> {
    gh_integration::get_open_issues_count_impl(&path)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            bump_launch_count,
            get_project_status,
            get_open_issues_count,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::list_projects,
            commands::projects::update_project,
            commands::projects::scan_directory,
            commands::projects::import_projects,
            commands::projects::pull_project,
            commands::projects::push_project,
            commands::projects::open_in_finder,
            commands::projects::get_github_repo_url,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::batch_refresh,
            commands::git::batch_pull,
            commands::git::batch_push,
            commands::git::refresh_single,
            commands::issues::list_issues,
            commands::issues::close_issue,
        ])
        .setup(|app| {
            // Initialize proxy for Tauri GUI (doesn't inherit shell env vars).
            gh_integration::init_proxy("socks5://127.0.0.1:7891");

            // Pre-warm gh CLI availability cache in background.
            commands::git::prewarm_gh_cache();

            let store = app
                .store("settings.json")
                .map_err(|e| -> Box<dyn std::error::Error> { format!("failed to open store: {e}").into() })?;
            if !store.has("launch_count") {
                store.set("launch_count", serde_json::Value::from(0u64));
                if let Err(e) = store.save() {
                    eprintln!("[dev] warning: failed to persist store: {e}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
