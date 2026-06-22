use std::fs;
use std::path::Path;

use crate::models::CustomCommand;

/// 检测项目类型并返回自动探测的命令列表
#[tauri::command]
pub fn detect_project_commands(project_path: String) -> Result<Vec<CustomCommand>, String> {
    let path = Path::new(&project_path);
    if !path.exists() {
        return Err(format!("path does not exist: {}", project_path));
    }

    let mut commands: Vec<CustomCommand> = Vec::new();

    // 检测 Node.js 项目 (package.json)
    let package_json_path = path.join("package.json");
    if package_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&package_json_path) {
            if let Ok(package) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(scripts) = package.get("scripts").and_then(|v| v.as_object()) {
                    let mut sort_order = 0;
                    for (name, _command) in scripts {
                        // 跳过 npm 生命周期脚本（pre/post 开头或特殊生命周期事件）
                        let is_lifecycle = name.starts_with("pre") || name.starts_with("post")
                            || matches!(name.as_str(), "prepare" | "prepublishOnly" | "prepack" | "postpack" | "preversion" | "version" | "postversion");
                        if is_lifecycle {
                            continue;
                        }
                        commands.push(CustomCommand {
                            name: name.clone(),
                            // 使用 npm run <name> 确保 node_modules/.bin 在 PATH 中
                            command: format!("npm run {}", name),
                            source: "auto".to_string(),
                            sort_order,
                            hidden: None,
                        });
                        sort_order += 1;
                    }
                }
            }
        }
    }

    // 检测 Android 项目 (build.gradle 或 build.gradle.kts)
    let has_gradle = path.join("build.gradle").exists()
        || path.join("build.gradle.kts").exists();

    if has_gradle {
        let gradle_wrapper = if path.join("gradlew").exists() {
            "./gradlew"
        } else {
            "gradlew"
        };

        let android_commands = vec![
            ("installDebug", format!("{} installDebug", gradle_wrapper)),
            ("assembleDebug", format!("{} assembleDebug", gradle_wrapper)),
            ("assembleRelease", format!("{} assembleRelease", gradle_wrapper)),
            ("clean", format!("{} clean", gradle_wrapper)),
        ];

        let mut sort_order = if commands.is_empty() { 0 } else { commands.len() as i32 };
        for (name, cmd) in android_commands {
            commands.push(CustomCommand {
                name: name.to_string(),
                command: cmd,
                source: "auto".to_string(),
                sort_order,
                hidden: None,
            });
            sort_order += 1;
        }
    }

    commands.sort_by_key(|c| c.sort_order);
    Ok(commands)
}

/// 执行命令，支持多终端
/// terminal_type: "terminal_app" | "iterm2"，如果为 None 则默认使用 Terminal.app
#[tauri::command]
pub fn run_in_terminal(
    project_path: String,
    command: String,
    terminal_type: Option<String>,
) -> Result<(), String> {
    // 将 cd 和命令合并为一条 shell 命令
    let full_command = format!(
        "cd {} && {}",
        shell_escape(&project_path),
        command
    );

    let use_iterm2 = terminal_type
        .as_deref()
        .map(|t| t == "iterm2")
        .unwrap_or(false);

    if use_iterm2 {
        run_in_iterm2(&full_command)
    } else {
        run_in_terminal_app(&full_command)
    }
}

/// 在 Terminal.app 中执行命令（通过 AppleScript）
fn run_in_terminal_app(full_command: &str) -> Result<(), String> {
    let script = format!(
        r#"tell application "Terminal"
    do script "{}"
    activate
end tell"#,
        escape_applescript_string(full_command)
    );

    run_osascript(&script)
}

/// 在 iTerm2 中执行命令（通过 AppleScript）
fn run_in_iterm2(full_command: &str) -> Result<(), String> {
    // 先检测 iTerm2 是否已安装
    if !is_iterm2_installed() {
        return Err(
            "iTerm2 未安装，请先安装或切换到 Terminal.app".to_string()
        );
    }

    let script = format!(
        r#"tell application "iTerm"
    activate
    try
        tell current window to create tab with default profile
    on error
        create window with default profile
    end try
    tell current session of current window
        write text "{}"
    end tell
end tell"#,
        escape_applescript_string(full_command)
    );

    run_osascript(&script)
}

/// 检测 iTerm2 是否已安装
fn is_iterm2_installed() -> bool {
    use std::process::Command;
    Command::new("osascript")
        .args(&["-e", r#"id of application "iTerm""#])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 执行 AppleScript
fn run_osascript(script: &str) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("failed to execute osascript: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript failed: {}", stderr));
    }

    Ok(())
}

/// 转义 shell 特殊字符
fn shell_escape(s: &str) -> String {
    // 用单引号包裹，并转义内部的单引号
    format!("'{}'", s.replace("'", "'\\''"))
}

/// 转义 AppleScript 字符串中的特殊字符
fn escape_applescript_string(s: &str) -> String {
    s.replace("\\", "\\\\")
     .replace("\"", "\\\"")
     .replace("\n", "\\n")
     .replace("\r", "\\r")
}
