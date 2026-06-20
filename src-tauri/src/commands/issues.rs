use crate::gh_integration;
use crate::models::IssueInfo;

#[tauri::command]
pub fn list_issues(path: String) -> Result<Vec<IssueInfo>, String> {
    if !gh_integration::is_gh_installed() {
        return Err("gh CLI is not installed. Please install it from https://cli.github.com".into());
    }

    if !gh_integration::is_gh_authenticated() {
        return Err("gh CLI is not authenticated. Please run `gh auth login` first.".into());
    }

    let (remote_url, _) = gh_integration::run_cmd(
        "git",
        &["-C", &path, "remote", "get-url", "origin"],
    )
    .map_err(|_| "Failed to get remote URL. Is this a git repository with an 'origin' remote?".to_string())?;

    if !remote_url.to_ascii_lowercase().contains("github.com") {
        return Err("This repository is not hosted on GitHub.".into());
    }

    let repo = gh_integration::parse_remote_url(&remote_url)
        .ok_or_else(|| "Failed to parse GitHub remote URL.".to_string())?;

    let (output, _) = gh_integration::run_cmd(
        "gh",
        &[
            "issue",
            "list",
            "--repo",
            &repo,
            "--json",
            "number,title,createdAt,state",
            "--limit",
            "50",
            "--state",
            "open",
        ],
    )
    .map_err(|e| format!("Failed to list issues: {e:?}"))?;

    let raw_issues: Vec<serde_json::Value> = serde_json::from_str(&output)
        .map_err(|e| format!("Failed to parse gh output: {e}"))?;

    let issues = raw_issues
        .into_iter()
        .filter_map(|v| {
            Some(IssueInfo {
                number: v.get("number")?.as_u64()? as u32,
                title: v.get("title")?.as_str()?.to_string(),
                created_at: v.get("createdAt")?.as_str()?.to_string(),
                state: v.get("state")?.as_str()?.to_string(),
            })
        })
        .collect();

    Ok(issues)
}

#[tauri::command]
pub fn close_issue(path: String, number: u32, reason: String) -> Result<(), String> {
    if reason != "completed" && reason != "not_planned" {
        return Err("reason must be 'completed' or 'not_planned'.".into());
    }

    if !gh_integration::is_gh_installed() {
        return Err("gh CLI is not installed. Please install it from https://cli.github.com".into());
    }

    if !gh_integration::is_gh_authenticated() {
        return Err("gh CLI is not authenticated. Please run `gh auth login` first.".into());
    }

    let (remote_url, _) = gh_integration::run_cmd(
        "git",
        &["-C", &path, "remote", "get-url", "origin"],
    )
    .map_err(|_| "Failed to get remote URL. Is this a git repository with an 'origin' remote?".to_string())?;

    if !remote_url.to_ascii_lowercase().contains("github.com") {
        return Err("This repository is not hosted on GitHub.".into());
    }

    let repo = gh_integration::parse_remote_url(&remote_url)
        .ok_or_else(|| "Failed to parse GitHub remote URL.".to_string())?;

    let number_str = number.to_string();
    gh_integration::run_cmd(
        "gh",
        &[
            "issue",
            "close",
            &number_str,
            "--repo",
            &repo,
            "--reason",
            &reason,
        ],
    )
    .map_err(|e| format!("Failed to close issue #{number}: {e:?}"))?;

    Ok(())
}
