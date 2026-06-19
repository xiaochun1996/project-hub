use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
pub enum GhError {
    GhNotInstalled,
    GhNotAuthenticated,
    NotGitHubRepo,
    CommandFailed(String),
}

pub fn run_cmd(cmd: &str, args: &[&str]) -> Result<(String, String), GhError> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| GhError::CommandFailed(e.to_string()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok((stdout, stderr))
    } else {
        Err(GhError::CommandFailed(if stderr.is_empty() {
            stdout
        } else {
            stderr
        }))
    }
}

pub fn is_gh_installed() -> bool {
    Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn is_gh_authenticated() -> bool {
    Command::new("gh")
        .args(["auth", "status"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn parse_remote_url(url: &str) -> Option<String> {
    let trimmed = url.trim();

    if let Some(rest) = trimmed.strip_prefix("https://") {
        let rest = rest.strip_prefix("www.").unwrap_or(rest);
        if let Some(path) = rest.strip_prefix("github.com/") {
            let path = path.strip_suffix(".git").unwrap_or(path);
            let parts: Vec<&str> = path.splitn(3, '/').collect();
            if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
                return Some(format!("{}/{}", parts[0], parts[1]));
            }
        }
    }

    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        let path = rest.strip_suffix(".git").unwrap_or(rest);
        let parts: Vec<&str> = path.splitn(3, '/').collect();
        if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Some(format!("{}/{}", parts[0], parts[1]));
        }
        if !path.is_empty() {
            return Some(path.to_string());
        }
    }

    None
}

pub fn get_open_issues_count_impl(path: &str) -> Result<u32, GhError> {
    if !is_gh_installed() {
        return Err(GhError::GhNotInstalled);
    }

    if !is_gh_authenticated() {
        return Err(GhError::GhNotAuthenticated);
    }

    let (remote_url, _) =
        run_cmd("git", &["-C", path, "remote", "get-url", "origin"]).map_err(|_| GhError::NotGitHubRepo)?;

    if !remote_url.to_ascii_lowercase().contains("github.com") {
        return Err(GhError::NotGitHubRepo);
    }

    let repo = parse_remote_url(&remote_url).ok_or(GhError::NotGitHubRepo)?;

    let (count_str, _) = run_cmd(
        "gh",
        &[
            "issue",
            "list",
            "--repo",
            &repo,
            "--state",
            "open",
            "--json",
            "number",
            "--jq",
            "length",
        ],
    )?;

    count_str
        .parse::<u32>()
        .map_err(|e| GhError::CommandFailed(format!("parse count failed: {e}")))
}
