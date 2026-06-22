use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::models::{GlobalSettings, TerminalType};

const STORE_FILE: &str = "projects.json";
const SETTINGS_KEY: &str = "global_settings";

fn default_global_settings() -> GlobalSettings {
    GlobalSettings {
        terminal_preference: Some(TerminalType::TerminalApp),
    }
}

/// 获取全局设置（终端偏好等）
#[tauri::command]
pub fn get_global_settings(app: AppHandle) -> Result<GlobalSettings, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("failed to open store: {e}"))?;

    if let Some(value) = store.get(SETTINGS_KEY) {
        serde_json::from_value(value)
            .map_err(|e| format!("failed to parse global settings: {e}"))
    } else {
        Ok(default_global_settings())
    }
}

/// 更新全局设置
#[tauri::command]
pub fn update_global_settings(
    app: AppHandle,
    settings: GlobalSettings,
) -> Result<GlobalSettings, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("failed to open store: {e}"))?;

    let value =
        serde_json::to_value(&settings).map_err(|e| format!("failed to serialize settings: {e}"))?;
    store.set(SETTINGS_KEY, value);

    store
        .save()
        .map_err(|e| format!("failed to save store: {e}"))?;

    Ok(settings)
}
