use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

/// Global proxy URL for network operations. Initialized at app startup.
static PROXY_URL: OnceLock<String> = OnceLock::new();

pub fn init_proxy(url: &str) {
    let _ = PROXY_URL.set(url.to_string());
}

pub fn proxy_env() -> Option<&'static str> {
    PROXY_URL.get().map(|s| s.as_str())
}

#[derive(Debug, Serialize)]
pub enum GhError {
    GhNotInstalled,
    GhNotAuthenticated,
    NotGitHubRepo,
    CommandFailed(String),
}

/// Build a PATH that includes common locations for CLI tools like `gh` and `git`.
/// macOS GUI apps launched via Launchpad/Dock only get `/usr/bin:/bin:/usr/sbin:/sbin`,
/// which misses Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) and user-level installs.
pub fn extended_path() -> String {
    let mut parts: Vec<String> = vec![
        "/opt/homebrew/bin".into(),
        "/opt/homebrew/sbin".into(),
        "/usr/local/bin".into(),
        "/usr/local/sbin".into(),
    ];
    if let Ok(path_var) = std::env::var("PATH") {
        for p in path_var.split(':') {
            if !parts.iter().any(|x| x == p) {
                parts.push(p.to_string());
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let local_bin = format!("{}/.local/bin", home);
        if !parts.iter().any(|x| *x == local_bin) {
            parts.push(local_bin);
        }
    }
    parts.join(":")
}

/// Resolve the absolute path of a CLI binary, checking common locations.
fn resolve_binary(name: &str) -> Option<PathBuf> {
    let candidates = [
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/local/bin/{}", name),
    ];
    // Also check ~/.local/bin
    if let Ok(home) = std::env::var("HOME") {
        let mut c = candidates.to_vec();
        c.push(format!("{}/.local/bin/{}", home, name));
        for path in c {
            let p = PathBuf::from(&path);
            if p.exists() {
                return Some(p);
            }
        }
    } else {
        for path in &candidates {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    // Fall back to PATH lookup (works in terminal-launched dev mode)
    which_in_path(name)
}

fn which_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in path_var.split(':') {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub fn run_cmd(cmd: &str, args: &[&str]) -> Result<(String, String), GhError> {
    let binary = resolve_binary(cmd).unwrap_or_else(|| PathBuf::from(cmd));
    let mut command = Command::new(&binary);
    command
        .args(args)
        .env("PATH", extended_path())
        .env("GH_PAGER", "cat");  // Disable pager for gh CLI
    if let Some(proxy) = proxy_env() {
        command
            .env("http_proxy", proxy)
            .env("https_proxy", proxy)
            .env("all_proxy", proxy);
    }
    let output = command
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
    resolve_binary("gh")
        .map(|bin| {
            let mut cmd = Command::new(&bin);
            cmd.arg("--version").env("PATH", extended_path());
            if let Some(proxy) = proxy_env() {
                cmd.env("http_proxy", proxy)
                    .env("https_proxy", proxy)
                    .env("all_proxy", proxy);
            }
            cmd.output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

pub fn is_gh_authenticated() -> bool {
    resolve_binary("gh")
        .map(|bin| {
            let mut cmd = Command::new(&bin);
            cmd.args(["auth", "status"]).env("PATH", extended_path());
            if let Some(proxy) = proxy_env() {
                cmd.env("http_proxy", proxy)
                    .env("https_proxy", proxy)
                    .env("all_proxy", proxy);
            }
            cmd.output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
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

    get_open_issues_count_no_check(path)
}

/// Skip gh availability checks (caller has already verified).
pub fn get_open_issues_count_no_check(path: &str) -> Result<u32, GhError> {
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
