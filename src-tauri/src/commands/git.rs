use std::sync::Arc;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::sync::Semaphore;

use crate::git_engine::{self, compute_ahead_behind, compute_working_state, derive_sync_status, detect_base_branch};
use crate::models::{Project, ProjectStatus, SyncStatus, WorkingState};

const STORE_FILE: &str = "projects.json";
const STORE_KEY: &str = "projects";

/// Cache gh CLI availability for the lifetime of the process.
static GH_AVAILABLE: OnceLock<bool> = OnceLock::new();

fn gh_available_cached() -> bool {
    *GH_AVAILABLE.get_or_init(|| {
        crate::gh_integration::is_gh_installed()
            && crate::gh_integration::is_gh_authenticated()
    })
}

/// Pre-warm the gh availability cache on a background thread.
/// Call once at app startup so the result is ready before first refresh.
pub fn prewarm_gh_cache() {
    std::thread::spawn(|| {
        gh_available_cached();
    });
}

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
    /// When base_branch was auto-detected (not pre-configured), this holds
    /// the detected value so the caller can cache it back to the store.
    #[serde(skip_serializing)]
    pub detected_base_branch: Option<String>,
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

// ── Batch operation result types (matched to frontend TS types) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectBatchStatus {
    pub id: String,
    pub status: ProjectStatus,
    pub open_issues: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchPullResult {
    pub updated: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchPushResult {
    pub pushed: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<(String, String)>,
}

fn is_dirty(path: &str) -> bool {
    matches!(compute_working_state(path), WorkingState::Dirty)
}

fn fetch_internal(path: &str) -> Result<(), GitError> {
    git_engine::run_git(path, &[
        "-c", "http.lowSpeedLimit=1000",
        "-c", "http.lowSpeedTime=10",
        "fetch", "origin",
    ]).map_err(|err| {
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
    match git_engine::run_git(path, &[
        "-c", "http.lowSpeedLimit=1000",
        "-c", "http.lowSpeedTime=10",
        "pull", "--rebase", "origin", base_branch,
    ]) {
        Ok(out) => Ok((dirty, out)),
        Err(err) => {
            if err.contains("CONFLICT") || err.contains("conflict") || err.contains("Merge conflict") {
                let _ = git_engine::run_git(path, &["rebase", "--abort"]);
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
    match git_engine::run_git(path, &[
        "-c", "http.lowSpeedLimit=1000",
        "-c", "http.lowSpeedTime=10",
        "push", "origin", "HEAD",
    ]) {
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

fn refresh_internal(path: &str, base_branch: Option<String>, gh_available: bool) -> RefreshResult {
    let t = std::time::Instant::now();
    // Determine whether we need to detect base_branch (for later caching).
    let needs_detection = base_branch.as_ref().map_or(true, |b| b.trim().is_empty());

    // D4: Spawn gh issue list in parallel with fetch + local git ops.
    let gh_handle = if gh_available {
        Some(std::thread::spawn({
            let path = path.to_string();
            move || crate::gh_integration::get_open_issues_count_no_check(&path).ok()
        }))
    } else {
        None
    };

    // Fetch first — status/ahead-behind depend on up-to-date remote refs.
    let _ = fetch_internal(path);
    eprintln!("[perf]   {} fetch: {:?}", path, t.elapsed());

    let (resolved_base, detected) = if needs_detection {
        let detected = detect_base_branch(path);
        eprintln!("[perf]   {} detect_base_branch: {:?}", path, t.elapsed());
        (detected.clone(), Some(detected))
    } else {
        (base_branch.unwrap().trim().to_string(), None)
    };

    let working_state = compute_working_state(path);
    let (ahead, behind) = compute_ahead_behind(path, &resolved_base);
    let sync_status = derive_sync_status(ahead, behind);
    eprintln!("[perf]   {} local ops: {:?}", path, t.elapsed());

    let open_issues = gh_handle.and_then(|h| h.join().ok().flatten());
    eprintln!("[perf]   {} gh join: {:?}", path, t.elapsed());

    RefreshResult {
        status: ProjectStatus {
            working_state,
            ahead,
            behind,
            sync_status,
            base_branch: resolved_base,
        },
        open_issues,
        detected_base_branch: detected,
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

fn git_error_msg(err: &GitError) -> String {
    match err {
        GitError::MergeConflict => "merge conflict encountered, rebase aborted".into(),
        GitError::Dirty => "working tree is dirty, please commit or stash".into(),
        GitError::PullFailed(m) => m.clone(),
        GitError::PushFailed(m) => m.clone(),
        GitError::NetworkError(m) => m.clone(),
        GitError::FetchFailed(m) => m.clone(),
        GitError::RepositoryNotFound => "repository not found".into(),
        GitError::InvalidPath => "invalid path".into(),
        GitError::Unknown(m) => m.clone(),
    }
}

// ── Batch operations (async, concurrent) ──

#[tauri::command]
pub async fn batch_refresh(app: AppHandle) -> Vec<ProjectBatchStatus> {
    let t0 = std::time::Instant::now();
    let projects = load_projects(&app).unwrap_or_default();
    let n = projects.len();
    eprintln!("[perf] load_projects: {} projects in {:?}", n, t0.elapsed());

    // D1: Check gh CLI availability once (cached for process lifetime).
    let gh_available = gh_available_cached();
    eprintln!("[perf] gh check (cached): gh_available={}, elapsed={:?}", gh_available, t0.elapsed());

    // D5: Concurrency raised to 5 (network-I/O-bound tasks).
    let sem = Arc::new(Semaphore::new(5));
    let mut handles = Vec::new();

    for p in projects {
        let sem = sem.clone();
        let app = app.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let id = p.id.clone();
            let path = p.path.clone();
            let base = p.base_branch.clone();
            tokio::task::spawn_blocking(move || {
                let tp = std::time::Instant::now();
                emit_op_start(&app, &id, "refresh");
                let result = refresh_internal(&path, base, gh_available);
                emit_op_complete(&app, &id, "refresh", to_json(&result));
                eprintln!("[perf] project {} refresh done in {:?}", &id, tp.elapsed());
                (id, result)
            })
            .await
            .ok()
        }));
    }

    let mut items: Vec<ProjectBatchStatus> = Vec::new();
    // D6: Collect base_branch updates for batch write-back.
    let mut base_branch_updates: Vec<(String, String)> = Vec::new();

    for h in handles {
        if let Some((id, result)) = h.await.unwrap_or_default() {
            if let Some(detected) = result.detected_base_branch {
                base_branch_updates.push((id.clone(), detected));
            }
            items.push(ProjectBatchStatus { id, status: result.status, open_issues: result.open_issues });
        }
    }

    // D6: Write detected base_branch values back to store in one pass.
    if !base_branch_updates.is_empty() {
        if let Ok(mut all_projects) = load_projects(&app) {
            let update_map: std::collections::HashMap<String, String> =
                base_branch_updates.into_iter().collect();
            let mut changed = false;
            for p in &mut all_projects {
                if let Some(detected) = update_map.get(&p.id) {
                    if p.base_branch.as_ref().map_or(true, |b| b.trim().is_empty()) {
                        p.base_branch = Some(detected.clone());
                        changed = true;
                    }
                }
            }
            if changed {
                if let Ok(store) = app.store(STORE_FILE) {
                    store.set(STORE_KEY, serde_json::to_value(&all_projects).unwrap());
                    let _ = store.save();
                }
            }
        }
    }

    let failures: Vec<BatchFailure> = Vec::new();
    emit_batch_complete(&app, "refresh", items.len(), failures);
    eprintln!("[perf] batch_refresh total: {:?}", t0.elapsed());
    items
}

// D7: Single-project refresh for use after individual Pull/Push.

#[tauri::command]
pub async fn refresh_single(app: AppHandle, path: String, base_branch: Option<String>) -> ProjectBatchStatus {
    let gh_available = gh_available_cached();

    let app_clone = app.clone();
    let path_clone = path.clone();
    let base_clone = base_branch.clone();

    let (id, result) = tokio::task::spawn_blocking(move || {
        // Look up project id from store.
        let projects = load_projects(&app_clone).unwrap_or_default();
        let pid = projects.iter().find(|p| p.path == path_clone).map(|p| p.id.clone()).unwrap_or_default();
        emit_op_start(&app_clone, &pid, "refresh");
        let r = refresh_internal(&path_clone, base_clone, gh_available);
        emit_op_complete(&app_clone, &pid, "refresh", to_json(&r));
        (pid, r)
    })
    .await
    .unwrap_or_else(|_| {
        (
            String::new(),
            RefreshResult {
                status: ProjectStatus {
                    working_state: WorkingState::Clean,
                    ahead: 0,
                    behind: 0,
                    sync_status: SyncStatus::Synced,
                    base_branch: String::new(),
                },
                open_issues: None,
                detected_base_branch: None,
            },
        )
    });

    // D6: Write back detected base_branch for this single project.
    if let Some(ref detected) = result.detected_base_branch {
        if let Ok(mut all_projects) = load_projects(&app) {
            let mut changed = false;
            for p in &mut all_projects {
                if p.id == id && p.base_branch.as_ref().map_or(true, |b| b.trim().is_empty()) {
                    p.base_branch = Some(detected.clone());
                    changed = true;
                    break;
                }
            }
            if changed {
                if let Ok(store) = app.store(STORE_FILE) {
                    store.set(STORE_KEY, serde_json::to_value(&all_projects).unwrap());
                    let _ = store.save();
                }
            }
        }
    }

    ProjectBatchStatus {
        id,
        status: result.status,
        open_issues: result.open_issues,
    }
}

#[tauri::command]
pub async fn batch_pull(app: AppHandle) -> BatchPullResult {
    let projects = load_projects(&app).unwrap_or_default();
    let sem = Arc::new(Semaphore::new(3));
    let mut handles = Vec::new();

    for p in projects {
        let sem = sem.clone();
        let app = app.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let id = p.id.clone();
            let path = p.path.clone();
            let base_branch = p.base_branch.clone();
            tokio::task::spawn_blocking(move || {
                emit_op_start(&app, &id, "pull");
                let base = resolve_base(&path, base_branch);
                let (_, behind) = compute_ahead_behind(&path, &base);

                if behind == 0 {
                    emit_op_complete(&app, &id, "pull", to_json(&PullResult {
                        success: true, is_dirty: is_dirty(&path), message: "already up to date".into(),
                    }));
                    return (id, "skipped".to_string(), String::new());
                }

                match pull_internal(&path, &base) {
                    Ok((dirty, msg)) => {
                        emit_op_complete(&app, &id, "pull", to_json(&PullResult {
                            success: true, is_dirty: dirty, message: msg.clone(),
                        }));
                        (id, "updated".to_string(), String::new())
                    }
                    Err(err) => {
                        let msg = git_error_msg(&err);
                        emit_op_complete(&app, &id, "pull", to_json(&PullResult {
                            success: false, is_dirty: is_dirty(&path), message: msg.clone(),
                        }));
                        (id, "failed".to_string(), msg)
                    }
                }
            })
            .await
            .unwrap_or_default()
        }));
    }

    let mut updated: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();
    for h in handles {
        if let Ok((id, status, err)) = h.await {
            match status.as_str() {
                "updated" => updated.push(id),
                "skipped" => skipped.push(id),
                _ => failed.push((id, err)),
            }
        }
    }
    let batch_failures: Vec<BatchFailure> = failed.iter().map(|(id, e)| BatchFailure { project_id: id.clone(), error: e.clone() }).collect();
    emit_batch_complete(&app, "pull", updated.len(), batch_failures);
    BatchPullResult { updated, skipped, failed }
}

#[tauri::command]
pub async fn batch_push(app: AppHandle) -> BatchPushResult {
    let projects = load_projects(&app).unwrap_or_default();
    let sem = Arc::new(Semaphore::new(3));
    let mut handles = Vec::new();

    for p in projects {
        let sem = sem.clone();
        let app = app.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let id = p.id.clone();
            let path = p.path.clone();
            let base_branch = p.base_branch.clone();
            tokio::task::spawn_blocking(move || {
                emit_op_start(&app, &id, "push");
                let base = resolve_base(&path, base_branch);
                let (ahead, behind) = compute_ahead_behind(&path, &base);
                let status = derive_sync_status(ahead, behind);

                if status == SyncStatus::Diverged {
                    emit_op_complete(&app, &id, "push", to_json(&PushResult {
                        success: true, is_dirty: is_dirty(&path), commits_pushed: 0,
                        message: "diverged — pull first".into(),
                    }));
                    return (id, "skipped".to_string(), String::new());
                }

                if ahead == 0 {
                    emit_op_complete(&app, &id, "push", to_json(&PushResult {
                        success: true, is_dirty: is_dirty(&path), commits_pushed: 0,
                        message: "nothing to push".into(),
                    }));
                    return (id, "skipped".to_string(), String::new());
                }

                match push_internal(&path) {
                    Ok((dirty, count, msg)) => {
                        emit_op_complete(&app, &id, "push", to_json(&PushResult {
                            success: true, is_dirty: dirty, commits_pushed: count, message: msg.clone(),
                        }));
                        (id, "pushed".to_string(), String::new())
                    }
                    Err(err) => {
                        let msg = git_error_msg(&err);
                        emit_op_complete(&app, &id, "push", to_json(&PushResult {
                            success: false, is_dirty: is_dirty(&path), commits_pushed: 0, message: msg.clone(),
                        }));
                        (id, "failed".to_string(), msg)
                    }
                }
            })
            .await
            .unwrap_or_default()
        }));
    }

    let mut pushed: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();
    for h in handles {
        if let Ok((id, status, err)) = h.await {
            match status.as_str() {
                "pushed" => pushed.push(id),
                "skipped" => skipped.push(id),
                _ => failed.push((id, err)),
            }
        }
    }
    let batch_failures: Vec<BatchFailure> = failed.iter().map(|(id, e)| BatchFailure { project_id: id.clone(), error: e.clone() }).collect();
    emit_batch_complete(&app, "push", pushed.len(), batch_failures);
    BatchPushResult { pushed, skipped, failed }
}
