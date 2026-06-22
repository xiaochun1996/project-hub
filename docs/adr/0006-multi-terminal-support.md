# ADR-0006: 多终端支持（Terminal.app 与 iTerm2）

## 状态

Proposed

## 背景

项目当前的运行功能（`run_in_terminal`）仅支持 macOS 系统自带的 Terminal.app，通过 AppleScript 注入命令。用户偏好使用 iTerm2，需要在保留 Terminal.app 支持的同时增加 iTerm2 支持。

### 当前实现

- 位置：`src-tauri/src/commands/project_run.rs` 的 `run_in_terminal` 函数
- 方式：硬编码使用 Terminal.app 的 AppleScript 接口
- 行为：每次点击运行按钮打开新的 Terminal 窗口

## 决策

### 1. 终端配置策略

**全局设置**：在 `projects.json` store 中新增全局配置字段 `terminal_preference`，可选值：
- `"terminal_app"` - macOS 系统 Terminal.app（默认）
- `"iterm2"` - iTerm2 终端

**理由**：
- 终端偏好是用户级别的全局设置，不应该与项目配置耦合
- 使用现有的 Tauri Store 机制保持一致性
- 默认值保证向后兼容

### 2. 数据模型扩展

#### 后端 (Rust)

在 `projects.json` store 中新增顶层配置对象：

```json
{
  "global_settings": {
    "terminal_preference": "terminal_app"
  },
  "projects": [...]
}
```

新增 Rust 结构体：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSettings {
    pub terminal_preference: Option<TerminalType>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalType {
    TerminalApp,
    Iterm2,
}
```

#### 前端 (TypeScript)

```typescript
export interface GlobalSettings {
  terminal_preference?: "terminal_app" | "iterm2";
}
```

### 3. 命令执行重构

修改 `run_in_terminal` 函数签名，接受终端类型参数：

```rust
#[tauri::command]
pub fn run_in_terminal(
    project_path: String, 
    command: String,
    terminal_type: Option<String> // "terminal_app" | "iterm2"
) -> Result<(), String>
```

**实现逻辑**：
1. 如果未指定 `terminal_type`，从全局设置读取默认值
2. 根据终端类型选择对应的 AppleScript 执行方式
3. Terminal.app：保持现有实现不变
4. iTerm2：使用 iTerm2 的 AppleScript 接口

### 4. iTerm2 AppleScript 实现

iTerm2 支持通过 AppleScript 打开新 tab 并执行命令：

```applescript
tell application "iTerm"
    activate
    tell current window
        create tab with default profile
        tell current session
            write text "cd /path/to/project && npm run dev"
        end tell
    end tell
end tell
```

**注意**：iTerm2 3.3+ 版本使用新的 AppleScript 语法，需要兼容性处理。

### 5. API 扩展

新增 Tauri commands：

```rust
// 获取全局设置
#[tauri::command]
pub fn get_global_settings(app: AppHandle) -> Result<GlobalSettings, String>

// 更新全局设置
#[tauri::command]
pub fn update_global_settings(
    app: AppHandle, 
    settings: GlobalSettings
) -> Result<GlobalSettings, String>
```

前端 API：

```typescript
export async function getGlobalSettings(): Promise<GlobalSettings>
export async function updateGlobalSettings(
  settings: GlobalSettings
): Promise<GlobalSettings>
```

### 6. 前端 UI

**主界面全局设置入口**：
- 在主界面（项目列表页）添加设置按钮/菜单
- 管理全局设置（终端偏好等）
- 提供下拉菜单选择 Terminal.app 或 iTerm2

**终端检测与错误处理**：
- 调用 iTerm2 前通过 `osascript` 检测应用是否已安装
- 未安装时显示友好提示："iTerm2 未安装，请先安装或切换到 Terminal.app"
- 项目详情页运行区域显示当前使用的终端类型

## 后果

### 正面影响
- 用户可以根据偏好选择终端
- 保持向后兼容（默认使用 Terminal.app）
- 架构清晰，终端逻辑集中管理

### 负面影响
- 需要维护两套 AppleScript 实现
- iTerm2 版本兼容性需要测试
- 增加全局设置复杂度

### 风险
- iTerm2 未安装时调用会失败（需要错误提示）
- AppleScript 权限问题（macOS 安全性限制）

## 实施计划

1. 扩展数据模型（`GlobalSettings` + `TerminalType`）
2. 实现全局设置的 CRUD commands（`get_global_settings` / `update_global_settings`）
3. 重构 `run_in_terminal` 支持多终端，增加终端类型参数
4. 实现 iTerm2 AppleScript 执行逻辑与安装检测
5. 主界面添加全局设置入口与 UI
6. 前端集成设置 API 与终端选择器
7. 完整测试：Terminal.app / iTerm2 / 未安装场景 / 错误提示

## 参考

- ADR-0004: 项目详情与运行功能设计
- iTerm2 AppleScript 文档：https://iterm2.com/documentation-scripting.html
