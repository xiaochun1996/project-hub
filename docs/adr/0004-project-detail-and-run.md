# ADR-0004: 项目详情页与运行功能

## 状态

已接受 (2026-06-22)

## 背景

Project Hub 当前只有项目列表视图，所有操作（Pull / Push / Finder / GitHub / Issues）都在卡片内完成。用户希望能在不打开外部 IDE 或手动敲命令的情况下，直接从 Project Hub 运行项目（如 `npm run dev`、`./gradlew installDebug`）。

核心诉求：**减少手动操作**，将常见的项目运行命令封装为一键触发。

## 决策

### 1. 渐进式项目详情页

- 新增独立路由页面（如 `/project/:id`），作为项目的详情视图。
- **第一版**仅包含"运行命令"功能板块。
- **架构预留**：页面结构支持后续扩展（git log、dirty files diff、依赖状态等）。
- **导航入口**：点击卡片上的**项目名**进入详情页，项目名加可点击视觉样式。

### 2. 命令来源：自动探测 + 手动配置

#### 自动探测（第一版）

| 项目类型 | 特征文件 | 探测内容 |
|----------|----------|----------|
| Node.js | `package.json` | 解析 `scripts` 字段，每个 script 生成一个命令按钮 |
| Android | `build.gradle` / `build.gradle.kts` | 预置常用命令：`installDebug`、`assembleDebug`、`assembleRelease`、`clean` |

#### 手动配置

- 用户可随时添加自定义命令（名称 + 命令）。
- 自动探测的命令允许用户**隐藏**（不显示但不删除）。
- 自定义命令持久化到 Project 记录中。

#### 空状态

- 若项目无 `package.json` 也无 `build.gradle`，且无手动配置，详情页显示空状态引导："添加命令"入口。

### 3. 自定义命令数据模型

```
CustomCommand {
  name: string          // 显示名称（如 "Dev"、"Debug APK"）
  command: string       // shell 命令（如 "npm run dev"、"./gradlew installDebug"）
  source: "auto" | "manual"
  sort_order: number    // 排序权重，数字越小越靠前
  hidden?: boolean      // 仅 auto 命令可隐藏
}
```

### 4. 终端执行方式

- **第一版**：使用 macOS 自带 **Terminal.app**，通过 AppleScript 注入命令：
  ```applescript
  tell application "Terminal"
      do script "cd /path/to/project && npm run dev"
  end tell
  ```
- **后续计划**：支持 iTerm2 作为可选终端（用户偏好 iTerm2）。
- 终端关闭则应用进程终止（外置终端的固有行为）。

## 后果

- 需要引入前端路由（当前为单页面无路由）。
- 后端需新增命令：读取 package.json scripts、读取 Gradle 特征、在系统终端执行命令、CRUD 自定义命令。
- 数据持久化扩展：Project 记录增加 `custom_commands` 字段。
- 第一版聚焦核心体验（一键运行），后续迭代扩展详情页内容。
