# ADR-0002: 批量刷新性能优化

## 状态

已接受

## 背景

`batch_refresh` 对每个项目串行执行 5-6 个操作（含多次网络 I/O 和进程启动），
6 个项目在 3 并发下耗时 10 秒以上。

主要瓶颈：

1. `is_gh_installed()` + `is_gh_authenticated()` 每个项目各启动一个进程（共 12 次），结果全局相同
2. `detect_base_branch()` 在未配置 base_branch 时调用 `git ls-remote`（网络请求），每次都跑
3. `refresh_internal` 内部操作全部串行

## 决策

### D1: gh CLI 可用性全局检查一次

在 `batch_refresh` 入口处调用一次 `is_gh_installed()` + `is_gh_authenticated()`，
将布尔结果传入 `refresh_internal`。非 GitHub 仓库的项目直接跳过 issues 计数。

**预期收益**：减少 2×N 次进程启动（N = 项目数）。

### D2: base_branch 探测结果缓存到 store

首次 `detect_base_branch` 成功后，将结果写回 store 中对应项目的 `base_branch` 字段。
后续 refresh 直接使用缓存值，不再执行 `git ls-remote` 等网络调用。

用户仍可在设置中手动清空或覆盖。

**预期收益**：消除重复的 `git ls-remote` 网络请求（~1s/项目）。

### D3: UI 保持同步加载模式

首次打开时不引入乐观缓存 UI。用户接受等待加载完成后一次性展示。

**理由**：MVP 阶段，避免引入 stale-while-revalidate 的复杂性。

### D4: refresh_internal 内部 fetch 与 gh issue list 并行

`git fetch origin` 和 `gh issue list` 是两个独立的网络请求，互不依赖。
在单个项目的 refresh 内部，将两者拆为并行执行，等两者都完成后再组装结果。

`git status` 和 `git rev-list` 仍依赖 fetch 完成后的 remote refs，保持 fetch 之后串行。

```
fetch ──────────→ status + ahead/behind ─→ 组装结果
gh issue list ──→ ──────────────────────→ ↗
```

**预期收益**：单项目耗时从串行 ~3s 降至 ~2s（取两者中较慢的一个）。

### D5: 并发数从 3 提升到 5

refresh 任务以网络 I/O 等待为主，CPU 占用极低。将 Semaphore 从 3 提升到 5，
使 6 个项目可在一轮内全部完成，避免两轮等待。

**预期收益**：6 个项目从 2 轮降至 1 轮。

### D6: base_branch 写回采用收集后统一写入

`spawn_blocking` 内不直接写 store。各 task 将探测到的 base_branch 作为结果返回，
`batch_refresh` 在 join 所有 handle 后，统一一次性写回 store。

**理由**：避免并发写 store 的竞态问题。

### D7: 单项目 Pull/Push 后仅 refresh 该项目

当前 `ProjectCard` 的 Pull/Push 完成后触发 `onRefresh` → `loadProjects` → 全量 `batchRefresh`。
这意味着对 1 个项目操作后会 refresh 所有 6 个项目，造成不必要的等待。

改为：Pull/Push 完成后仅 refresh 该项目（新增 `refresh_single` 命令），
直接更新 `statusMap` 和 `issuesMap` 中该项目的条目。

**预期收益**：单项目操作后的刷新从 ~2-3s 降至 ~0.5s（仅 1 个项目，无并发开销）。

### D8: batch_pull / batch_push 并发数保持 3

与 refresh 不同，pull 和 push 涉及实际的写操作（修改本地文件 / 推送远端），
保持 Semaphore(3) 的保守策略。

## 后果

- 优化后预计单项目 refresh 时间从 ~4-6s 降至 ~2s
- 6 个项目 5 并发：1 轮完成，总计 ~2-3s
- 相比优化前 10s+，提速约 4-5 倍
- 代码改动集中在 `src-tauri/src/commands/git.rs`
- `refresh_internal` 需要拆分为 fetch 分支和 gh 分支并行
- `batch_refresh` 结尾新增统一写回 store 逻辑
