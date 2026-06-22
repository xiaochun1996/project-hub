# Project Hub — 领域语言

## 术语表

### Project（项目）
一个本地 Git 仓库，是 Project Hub 管理的基本单元。每个 Project 对应一个本地目录路径。用户可通过手动选择文件夹或扫描父目录批量导入来添加项目。项目列表持久化存储，启动时自动加载。

### Sync Status（同步状态）
Project 与远程仓库之间的关系状态。取值：
- **Synced** — 本地与远程完全一致（Ahead = 0, Behind = 0）
- **Need Push** — 本地有未推送的 Commit（Ahead > 0, Behind = 0）
- **Need Pull** — 远程有本地未拉取的 Commit（Ahead = 0, Behind > 0）
- **Diverged** — 本地和远程都有对方没有的 Commit（Ahead > 0, Behind > 0）。高风险状态，批量操作中仅归入 Pull 组。

### Working State（工作状态）
Project 的工作区状态：
- **Clean** — 工作区无未提交变更
- **Dirty** — 工作区有未提交变更。Dirty 状态下允许 Push（Push 只推送已有 commit），但会显示警告提示。

### Open Issues（待解决议题）
通过 `gh issue list` 获取的 GitHub 上处于 Open 状态的 Issue 数量。仓库地址通过 `git remote get-url origin` 自动推断。若 `gh` CLI 未安装或未认证，显示为不可用。

### Issue 管理（议题管理）
在项目卡片中点击 Issues 按钮可弹出 Issue 列表 Dialog，展示编号、标题、状态、创建时间。支持逐个 Issue 执行关闭操作：
- **Close** — `gh issue close --reason completed`（标记为已解决）
- **Skip** — `gh issue close --reason not_planned`（标记为不处理）
操作后立即刷新列表。

### Base Branch（主分支）
用于计算 Ahead/Behind 的基准远程分支。默认自动检测（`git symbolic-ref refs/remotes/origin/HEAD`），支持每个项目手动覆盖。

### Refresh（刷新）
对一个或所有项目执行的操作，包含两步：
1. `git fetch` — 拉取远程最新信息
2. 重新计算 Sync Status、Working State、Open Issues

Refresh 隐含 Fetch，不需要独立的 Fetch 操作。

### Project Detail（项目详情页）
点击项目卡片上的项目名称进入的独立页面。采用渐进式架构：第一版包含运行命令功能，后续可扩展 git log、dirty files diff、依赖状态等内容。通过前端路由（如 `/project/:id`）实现。

### Anomalous Project（异常项目）
项目满足以下任意条件时被视为「异常」，在主页项目列表中优先显示（按严重程度排序）：
- Sync Status 为 Diverged（最严重）
- Sync Status 为 Need Pull
- Working State 为 Dirty
- Open Issues > 0
- Sync Status 为 Need Push（最轻微）
处于 Synced 且 Clean 状态且无 Open Issues 的项目为「正常」，保持原有添加顺序排在列表末尾。

### Custom Command（自定义命令）
与 Project 绑定的可执行命令，持久化存储在 Project 记录中。命令来源分两类：
- **Auto（自动探测）** — 根据项目特征文件自动识别：
  - `package.json` → 解析 `scripts` 字段生成命令
  - `build.gradle` / `build.gradle.kts` → 预置常用 Gradle 任务（installDebug、assembleDebug 等）
- **Manual（手动配置）** — 用户自行添加的名称 + 命令对

Auto 命令支持隐藏（`hidden: true`）而不删除。所有命令通过外置系统终端（首版 Terminal.app）执行，终端关闭则进程终止。
