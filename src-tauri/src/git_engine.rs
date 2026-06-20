use std::process::Command;

use crate::models::{SyncStatus, WorkingState};

pub fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .env("PATH", crate::gh_integration::extended_path())
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

pub fn detect_base_branch(path: &str) -> String {
    if let Ok(sym_ref) = run_git(
        path,
        &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    ) {
        if let Some(short) = sym_ref.strip_prefix("refs/remotes/origin/") {
            if !short.is_empty() {
                return short.to_string();
            }
        }
        if !sym_ref.is_empty() {
            return sym_ref;
        }
    }

    if let Ok(branches) = run_git(path, &["ls-remote", "--heads", "origin", "main", "master"]) {
        let lines: Vec<&str> = branches.lines().collect();
        for line in &lines {
            if line.ends_with("refs/heads/main") {
                return "main".to_string();
            }
        }
        for line in &lines {
            if line.ends_with("refs/heads/master") {
                return "master".to_string();
            }
        }
    }

    if run_git(path, &["show-ref", "--verify", "refs/remotes/origin/main"]).is_ok() {
        return "main".to_string();
    }
    if run_git(path, &["show-ref", "--verify", "refs/remotes/origin/master"]).is_ok() {
        return "master".to_string();
    }

    "main".to_string()
}

pub fn compute_working_state(path: &str) -> WorkingState {
    match run_git(path, &["status", "--porcelain"]) {
        Ok(output) if output.trim().is_empty() => WorkingState::Clean,
        Ok(_) => WorkingState::Dirty,
        Err(_) => WorkingState::Dirty,
    }
}

pub fn compute_ahead_behind(path: &str, base_branch: &str) -> (u32, u32) {
    let remote_ref = format!("origin/{}", base_branch);
    let arg = format!("{}...HEAD", remote_ref);
    match run_git(path, &["rev-list", "--left-right", "--count", &arg]) {
        Ok(output) => {
            let parts: Vec<&str> = output.split_whitespace().collect();
            if parts.len() >= 2 {
                let behind: u32 = parts[0].parse().unwrap_or(0);
                let ahead: u32 = parts[1].parse().unwrap_or(0);
                (ahead, behind)
            } else {
                (0, 0)
            }
        }
        Err(_) => (0, 0),
    }
}

pub fn derive_sync_status(ahead: u32, behind: u32) -> SyncStatus {
    match (ahead, behind) {
        (0, 0) => SyncStatus::Synced,
        (a, 0) if a > 0 => SyncStatus::NeedPush,
        (0, b) if b > 0 => SyncStatus::NeedPull,
        _ => SyncStatus::Diverged,
    }
}
