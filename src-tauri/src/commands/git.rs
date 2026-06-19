use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

use crate::git_engine::{
    compute_ahead_behind, compute_working_state, derive_sync_status, detect_base_branch,
};
use crate::models::{Project, ProjectStatus, SyncStatus, WorkingState};

const STORE_FILE: &str = "projects.json";
const STORE_KEY: &str = "projects";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResult {
    pub success: bool,
    pub is_dirty: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResult {
    pub success: bool,
    pub is_dirty: bool,
    pub commits_pushed: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshResult {
    pub status: ProjectStatus,
    pub open_issues: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum GitError {
    InvalidPath,
    FetchFailed(String),
    PullFailed(String),
    PushFailed(String),
    Dirty,
    MergeConflict,
    RepositoryNotFound,
    NetworkError(String),
    Unknown(String),
}

#[derive(Debug, Clone, Serialize)]
struct OpStartEvent {
    project_id: String,
    operation: String,
}

#[derive(Debug, Clone, Serialize)]
struct OpCompleteEvent {
    project_id: String,
    operation: String,
    result: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
struct BatchFailure {
    project_id: String,
    error: String,
}

#[derive(Debug, Clone, Serialize)]
struct BatchCompleteEvent {
    operation: String,
    success_count: usize,
    failure_count: usize,
    failures: Vec<BatchFailure>,
}

fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
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

fn is_dirty(path: &str) -> bool {
    matches!(compute_working_state(path), WorkingState::Dirty)
}

fn fetch_internal(path: &str) -> Result<(), GitError> {
    run_git(path, &["fetch", "origin"]).map_err(|err| {
        if err.contains("resolve") || err.contains("unable to access") || err.contains("network") {
            GitError::NetworkError(err)
        } else if err.contains("not a git repository") {
            GitError::RepositoryNotFound
        } else {
            GitError::FetchFailed(err)
        }
    })?;
    Ok(())
}

fn pull_internal(path: &str, base_branch: &str) -> Result<(bool, String), GitError> {
    let dirty = is_dirty(path);
    match run_git(path, &["pull", "--rebase", "origin", base_branch]) {
        Ok(out) => Ok((dirty, out)),
        Err(err) => {
            if err.contains("CONFLICT") || err.contains("conflict") || err.contains("Merge conflict") {
                let _ = run_git(path, &["rebase", "--abort"]);
                Err(GitError::MergeConflict)
            } else if err.contains("dirty") || err.contains("Your local changes") {
                Err(GitError::Dirty)
            } else {
                Err(GitError::PullFailed(err))
            }
        }
    }
}

fn push_internal(path: &str) -> Result<(bool, u32, String), GitError> {
    let dirty = is_dirty(path);
    let base = detect_base_branch(path);
    let (ahead_before, _) = compute_ahead_behind(path, &base);
    match run_git(path, &["push", "origin", "HEAD"]) {
        Ok(out) => {
            let (ahead_after, _) = compute_ahead_behind(path, &base);
            let pushed = ahead_before.saturating_sub(ahead_after);
            Ok((dirty, pushed.max(if ahead_before > 0 { 1 } else { 0 }), out))
        }
        Err(err) => {
            if err.contains("resolve") || err.contains("unable to access") {
                Err(GitError::NetworkError(err))
            } else if err.contains("not a git repository") {
                Err(GitError::RepositoryNotFound)
            } else {
                Err(GitError::PushFailed(err))
            }
        }
    }
}

fn refresh_internal(path: &str, base_branch: Option<String>) -> RefreshResult {
    let _ = fetch_internal(path);
    let resolved_base = match base_branch {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => detect_base_branch(path),
    };

    let working_state = compute_working_state(path);
    let (ahead, behind) = compute_ahead_behind(path, &resolved_base);
    let sync_status = derive_sync_status(ahead, behind);

    let open_issues = crate::gh_integration::get_open_issues_count_impl(path).ok();

    RefreshResult {
        status: ProjectStatus {
            working_state,
            ahead,
            behind,
            sync_status,
            base_branch: resolved_base,
        },
        open_issues,
    }
}

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

fn find_project(app: &AppHandle, id: &str) -> Result<Project, GitError> {
    let projects = load_projects(app).map_err(|_| GitError::Unknown("project store error".into()))?;
    projects
        .into_iter()
        .find(|p| p.id == id)
        .ok_or(GitError::InvalidPath)
}

fn resolve_base(path: &str, base_branch: Option<String>) -> String {
    match base_branch {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => detect_base_branch(path),
    }
}

fn to_json<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or_else(|_| serde_json::Value::Null)
}

fn emit_op_start(app: &AppHandle, project_id: &str, operation: &str) {
    let _ = app.emit(
        "operation-start",
        OpStartEvent {
            project_id: project_id.to_string(),
            operation: operation.to_string(),
        },
    );
}

fn emit_op_complete(app: &AppHandle, project_id: &str, operation: &str, result: serde_json::Value) {
    let _ = app.emit(
        "operation-complete",
        OpCompleteEvent {
            project_id: project_id.to_string(),
            operation: operation.to_string(),
            result,
        },
    );
}

fn emit_batch_complete(
    app: &AppHandle,
    operation: &str,
    success_count: usize,
    failures: Vec<BatchFailure>,
) {
    let _ = app.emit(
        "batch-complete",
        BatchCompleteEvent {
            operation: operation.to_string(),
            success_count,
            failure_count: failures.len(),
            failures,
        },
    );
}

#[tauri::command]
pub fn git_fetch(path: String) -> Result<(), GitError> {
    fetch_internal(&path)
}

#[tauri::command]
pub fn git_pull(path: String, base_branch: Option<String>) -> Result<PullResult, GitError> {
    let resolved = resolve_base(&path, base_branch);
    let (dirty, msg) = pull_internal(&path, &resolved)?;
    Ok(PullResult {
        success: true,
        is_dirty: dirty,
        message: msg,
    })
}

#[tauri::command]
pub fn git_push(path: String) -> Result<PushResult, GitError> {
    let (dirty, pushed, msg) = push_internal(&path)?;
    Ok(PushResult {
        success: true,
        is_dirty: dirty,
        commits_pushed: pushed,
        message: msg,
    })
}

#[tauri::command]
pub fn batch_refresh(app: AppHandle, project_ids: Vec<String>) -> Vec<(String, RefreshResult)> {
    let operation = "refresh";
    let mut results: Vec<(String, RefreshResult)> = Vec::new();
    let mut failures: Vec<BatchFailure> = Vec::new();

    for project_id in project_ids.iter() {
        emit_op_start(&app, project_id, operation);
        match find_project(&app, project_id) {
            Ok(project) => {
                let result = refresh_internal(&project.path, project.base_branch.clone());
                emit_op_complete(&app, project_id, operation, to_json(&result));
                results.push((project_id.clone(), result));
            }
            Err(err) => {
                let msg = format!("{:?}", err);
                emit_op_complete(
                    &app,
                    project_id,
                    operation,
                    to_json(&serde_json::json!({ "success": false, "error": msg })),
                );
                failures.push(BatchFailure {
                    project_id: project_id.clone(),
                    error: msg,
                });
            }
        }
    }

    emit_batch_complete(&app, operation, results.len(), failures);
    results
}

#[tauri::command]
pub fn batch_pull(app: AppHandle, project_ids: Vec<String>) -> Vec<(String, PullResult)> {
    let operation = "pull";
    let mut results: Vec<(String, PullResult)> = Vec::new();
    let mut failures: Vec<BatchFailure> = Vec::new();

    for project_id in project_ids.iter() {
        emit_op_start(&app, project_id, operation);
        match find_project(&app, project_id) {
            Ok(project) => {
                let base = resolve_base(&project.path, project.base_branch.clone());
                let (_, behind_before) = compute_ahead_behind(&project.path, &base);

                if behind_before > 0 {
                    match pull_internal(&project.path, &base) {
                        Ok((dirty, msg)) => {
                            let result = PullResult {
                                success: true,
                                is_dirty: dirty,
                                message: msg,
                            };
                            emit_op_complete(&app, project_id, operation, to_json(&result));
                            results.push((project_id.clone(), result));
                        }
                        Err(err) => {
                            let msg = match err {
                                GitError::MergeConflict => {
                                    "merge conflict encountered, rebase aborted".into()
                                }
                                GitError::Dirty => {
                                    "working tree is dirty, please commit or stash".into()
                                }
                                GitError::PullFailed(m) => m,
                                GitError::NetworkError(m) => m,
                                GitError::RepositoryNotFound => "repository not found".into(),
                                GitError::InvalidPath => "invalid path".into(),
                                GitError::Unknown(m) => m,
                                GitError::FetchFailed(m) => m,
                                GitError::PushFailed(m) => m,
                            };
                            let dirty = is_dirty(&project.path);
                            let result = PullResult {
                                success: false,
                                is_dirty: dirty,
                                message: msg.clone(),
                            };
                            emit_op_complete(&app, project_id, operation, to_json(&result));
                            results.push((project_id.clone(), result));
                            failures.push(BatchFailure {
                                project_id: project_id.clone(),
                                error: msg,
                            });
                        }
                    }
                } else {
                    let dirty = is_dirty(&project.path);
                    let result = PullResult {
                        success: true,
                        is_dirty: dirty,
                        message: "already up to date".into(),
                    };
                    emit_op_complete(&app, project_id, operation, to_json(&result));
                    results.push((project_id.clone(), result));
                }
            }
            Err(err) => {
                let msg = format!("{:?}", err);
                let result = PullResult {
                    success: false,
                    is_dirty: false,
                    message: msg.clone(),
                };
                emit_op_complete(&app, project_id, operation, to_json(&result));
                results.push((project_id.clone(), result));
                failures.push(BatchFailure {
                    project_id: project_id.clone(),
                    error: msg,
                });
            }
        }
    }

    let success_count = results.iter().filter(|(_, r)| r.success).count();
    emit_batch_complete(&app, operation, success_count, failures);
    results
}

#[tauri::command]
pub fn batch_push(app: AppHandle, project_ids: Vec<String>) -> Vec<(String, PushResult)> {
    let operation = "push";
    let mut results: Vec<(String, PushResult)> = Vec::new();
    let mut failures: Vec<BatchFailure> = Vec::new();

    for project_id in project_ids.iter() {
        emit_op_start(&app, project_id, operation);
        match find_project(&app, project_id) {
            Ok(project) => {
                let base = resolve_base(&project.path, project.base_branch.clone());
                let (ahead_before, behind_before) = compute_ahead_behind(&project.path, &base);
                let status_before = derive_sync_status(ahead_before, behind_before);

                if status_before == SyncStatus::Diverged {
                    let msg = "diverged project skipped (pull first)".to_string();
                    let dirty = is_dirty(&project.path);
                    let result = PushResult {
                        success: false,
                        is_dirty: dirty,
                        commits_pushed: 0,
                        message: msg.clone(),
                    };
                    emit_op_complete(&app, project_id, operation, to_json(&result));
                    results.push((project_id.clone(), result));
                    failures.push(BatchFailure {
                        project_id: project_id.clone(),
                        error: msg,
                    });
                    continue;
                }

                if ahead_before > 0 {
                    match push_internal(&project.path) {
                        Ok((dirty, pushed, msg)) => {
                            let result = PushResult {
                                success: true,
                                is_dirty: dirty,
                                commits_pushed: pushed,
                                message: msg,
                            };
                            emit_op_complete(&app, project_id, operation, to_json(&result));
                            results.push((project_id.clone(), result));
                        }
                        Err(err) => {
                            let msg = match err {
                                GitError::PushFailed(m) => m,
                                GitError::NetworkError(m) => m,
                                GitError::RepositoryNotFound => "repository not found".into(),
                                GitError::InvalidPath => "invalid path".into(),
                                GitError::Unknown(m) => m,
                                GitError::FetchFailed(m) => m,
                                GitError::PullFailed(m) => m,
                                GitError::MergeConflict => "merge conflict".into(),
                                GitError::Dirty => "dirty".into(),
                            };
                            let dirty = is_dirty(&project.path);
                            let result = PushResult {
                                success: false,
                                is_dirty: dirty,
                                commits_pushed: 0,
                                message: msg.clone(),
                            };
                            emit_op_complete(&app, project_id, operation, to_json(&result));
                            results.push((project_id.clone(), result));
                            failures.push(BatchFailure {
                                project_id: project_id.clone(),
                                error: msg,
                            });
                        }
                    }
                } else {
                    let _ = behind_before;
                    let dirty = is_dirty(&project.path);
                    let result = PushResult {
                        success: true,
                        is_dirty: dirty,
                        commits_pushed: 0,
                        message: "nothing to push".into(),
                    };
                    emit_op_complete(&app, project_id, operation, to_json(&result));
                    results.push((project_id.clone(), result));
                }
            }
            Err(err) => {
                let msg = format!("{:?}", err);
                let result = PushResult {
                    success: false,
                    is_dirty: false,
                    commits_pushed: 0,
                    message: msg.clone(),
                };
                emit_op_complete(&app, project_id, operation, to_json(&result));
                results.push((project_id.clone(), result));
                failures.push(BatchFailure {
                    project_id: project_id.clone(),
                    error: msg,
                });
            }
        }
    }

    let success_count = results.iter().filter(|(_, r)| r.success).count();
    emit_batch_complete(&app, operation, success_count, failures);
    results
}
