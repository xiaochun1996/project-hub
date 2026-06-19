use std::fs;
use std::path::Path;

use chrono::Utc;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::git_engine::{
    compute_ahead_behind, compute_working_state, derive_sync_status, detect_base_branch,
};
use crate::models::{Project, ProjectConfig, ProjectStatus, SyncStatus, WorkingState};

const STORE_FILE: &str = "projects.json";
const STORE_KEY: &str = "projects";

fn load_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("failed to open store: {e}"))?;

    if let Some(value) = store.get(STORE_KEY) {
        let projects: Vec<Project> =
            serde_json::from_value(value).map_err(|e| format!("failed to parse projects: {e}"))?;
        Ok(projects)
    } else {
        Ok(Vec::new())
    }
}

fn save_projects(app: &AppHandle, projects: &[Project]) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("failed to open store: {e}"))?;

    let value = serde_json::to_value(projects).map_err(|e| format!("failed to serialize: {e}"))?;
    store.set(STORE_KEY, value);

    store
        .save()
        .map_err(|e| format!("failed to save store: {e}"))?;

    Ok(())
}

fn is_valid_git_repo(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let git_path = path.join(".git");
    git_path.exists()
}

fn infer_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string()
}

fn build_project_from_path(path_str: &str) -> Result<Project, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(format!("path does not exist: {}", path_str));
    }
    if !is_valid_git_repo(path) {
        return Err(format!("not a valid git repository: {}", path_str));
    }

    let absolute = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve path: {e}"))?;
    let absolute_str = absolute
        .to_str()
        .ok_or_else(|| "invalid utf-8 path".to_string())?
        .to_string();

    Ok(Project {
        id: Uuid::new_v4().to_string(),
        name: infer_name_from_path(&absolute),
        path: absolute_str,
        base_branch: None,
        added_at: Utc::now().to_rfc3339(),
    })
}

fn compute_project_status(path: &str, base_branch: &Option<String>) -> ProjectStatus {
    let resolved_base = match base_branch {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => detect_base_branch(path),
    };
    let working_state = compute_working_state(path);
    let (ahead, behind) = compute_ahead_behind(path, &resolved_base);
    let sync_status = derive_sync_status(ahead, behind);
    ProjectStatus {
        working_state,
        ahead,
        behind,
        sync_status,
        base_branch: resolved_base,
    }
}

#[tauri::command]
pub fn add_project(app: AppHandle, path: String) -> Result<Project, String> {
    let mut projects = load_projects(&app)?;

    if projects.iter().any(|p| p.path == path) {
        return Err(format!("project already exists: {}", path));
    }

    let project = build_project_from_path(&path)?;
    projects.push(project.clone());
    save_projects(&app, &projects)?;
    Ok(project)
}

#[tauri::command]
pub fn remove_project(app: AppHandle, id: String) -> Result<(), String> {
    let mut projects = load_projects(&app)?;
    let len_before = projects.len();
    projects.retain(|p| p.id != id);
    if projects.len() == len_before {
        return Err(format!("project not found: {}", id));
    }
    save_projects(&app, &projects)
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    load_projects(&app)
}

#[tauri::command]
pub fn update_project(
    app: AppHandle,
    id: String,
    config: ProjectConfig,
) -> Result<Project, String> {
    let mut projects = load_projects(&app)?;
    let project = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("project not found: {}", id))?;

    if let Some(base_branch) = config.base_branch {
        project.base_branch = if base_branch.trim().is_empty() {
            None
        } else {
            Some(base_branch)
        };
    }
    if let Some(name) = config.name {
        if !name.trim().is_empty() {
            project.name = name;
        }
    }

    let updated = project.clone();
    save_projects(&app, &projects)?;
    Ok(updated)
}

#[tauri::command]
pub fn scan_directory(path: String) -> Result<Vec<String>, String> {
    let base = Path::new(&path);
    if !base.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    if !base.is_dir() {
        return Err(format!("not a directory: {}", path));
    }

    let mut results: Vec<String> = Vec::new();
    let entries = fs::read_dir(base).map_err(|e| format!("failed to read dir: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }
        if is_valid_git_repo(&entry_path) {
            let abs = entry_path
                .canonicalize()
                .unwrap_or(entry_path.clone())
                .to_str()
                .map(|s| s.to_string())
                .unwrap_or_default();
            if !abs.is_empty() {
                results.push(abs);
            }
        }
    }

    results.sort();
    Ok(results)
}

#[tauri::command]
pub fn import_projects(app: AppHandle, paths: Vec<String>) -> Result<Vec<Project>, String> {
    let mut projects = load_projects(&app)?;
    let mut imported: Vec<Project> = Vec::new();

    for path in paths {
        if projects.iter().any(|p| p.path == path) {
            continue;
        }
        match build_project_from_path(&path) {
            Ok(project) => {
                imported.push(project.clone());
                projects.push(project);
            }
            Err(_) => continue,
        }
    }

    save_projects(&app, &projects)?;
    Ok(imported)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProjectBatchStatus {
    pub id: String,
    pub status: ProjectStatus,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BatchPullResult {
    pub updated: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<(String, String)>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BatchPushResult {
    pub pushed: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<(String, String)>,
}

#[tauri::command]
pub fn batch_refresh(app: AppHandle) -> Result<Vec<ProjectBatchStatus>, String> {
    let projects = load_projects(&app)?;
    let mut out: Vec<ProjectBatchStatus> = Vec::with_capacity(projects.len());
    for p in projects {
        let status = compute_project_status(&p.path, &p.base_branch);
        out.push(ProjectBatchStatus { id: p.id, status });
    }
    Ok(out)
}

fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .map_err(|e| format!("failed to execute git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("git {:?} failed with status {}", args, output.status)
        } else {
            stderr
        })
    }
}

#[tauri::command]
pub fn batch_pull(app: AppHandle) -> Result<BatchPullResult, String> {
    let projects = load_projects(&app)?;
    let mut updated: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();

    for p in projects {
        let status = compute_project_status(&p.path, &p.base_branch);
        let needs_pull = matches!(status.sync_status, SyncStatus::NeedPull | SyncStatus::Diverged);
        if !needs_pull {
            skipped.push(p.id);
            continue;
        }
        match run_git(&p.path, &["pull"]) {
            Ok(_) => updated.push(p.id),
            Err(e) => failed.push((p.id, e)),
        }
    }

    Ok(BatchPullResult {
        updated,
        skipped,
        failed,
    })
}

#[tauri::command]
pub fn batch_push(app: AppHandle) -> Result<BatchPushResult, String> {
    let projects = load_projects(&app)?;
    let mut pushed: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();

    for p in projects {
        let status = compute_project_status(&p.path, &p.base_branch);
        let needs_push = matches!(status.sync_status, SyncStatus::NeedPush | SyncStatus::Diverged);
        if !needs_push {
            skipped.push(p.id);
            continue;
        }
        match run_git(&p.path, &["push"]) {
            Ok(_) => pushed.push(p.id),
            Err(e) => failed.push((p.id, e)),
        }
    }

    Ok(BatchPushResult {
        pushed,
        skipped,
        failed,
    })
}

#[tauri::command]
pub fn pull_project(path: String) -> Result<String, String> {
    run_git(&path, &["pull"])
}

#[tauri::command]
pub fn push_project(path: String) -> Result<String, String> {
    run_git(&path, &["push"])
}

#[tauri::command]
pub fn open_in_finder(path: String) -> Result<(), String> {
    use std::process::Command;

    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("path does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .status()
            .map_err(|e| format!("failed to open: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .status()
            .map_err(|e| format!("failed to open: {e}"))?;
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .status()
            .map_err(|e| format!("failed to open: {e}"))?;
    }

    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GitHubRepoInfo {
    pub url: Option<String>,
    pub owner_repo: Option<String>,
}

#[tauri::command]
pub fn get_github_repo_url(path: String) -> Result<GitHubRepoInfo, String> {
    let output = run_git(&path, &["remote", "get-url", "origin"]).unwrap_or_default();
    let owner_repo = crate::gh_integration::parse_remote_url(&output);
    let url = owner_repo.as_ref().map(|r| format!("https://github.com/{}", r));
    Ok(GitHubRepoInfo { url, owner_repo })
}

#[allow(dead_code)]
fn _working_state_alias(_: WorkingState) -> bool {
    true
}
