# ADR-0005: 返回主页不自动刷新 + 异常项目置顶排序

## 状态

已接受 (2026-06-22)

## 背景

从详情页返回主页时，`ProjectListHome` 组件卸载重装、重新挂载时触发 `batchRefresh()`，导致所有项目刷一遍（git fetch + 状态重算），既慢又没必要。同时，带有 open issues、dirty 工作区、need_pull/diverged 等异常状态的项目淹没在列表中不易发现。

## 决策

### 1. 模块级状态缓存
用模块级变量（不在 React 状态树内）缓存 `statusMap` 和 `issuesMap`，组件卸载时数据保留，重新挂载时直接读取缓存。配合一个模块级 `initialLoadDone` 标记：

- 首次加载 → `listProjects()` + `batchRefresh()` → 写入缓存
- 后续加载（包括从详情页返回）→ 仅 `listProjects()` + 读取缓存
- 手动 "Refresh All" → 始终全量刷新并更新缓存

### 2. 按异常严重程度排序
渲染前按以下优先级对项目重排（同一等级内保持原有添加顺序）：

| 条件 | 优先级 |
|------|--------|
| sync_status 为 `diverged` | 最高 |
| sync_status 为 `need_pull` | 较高 |
| working_state 为 `dirty` | 中高 |
| open_issues > 0 | 中 |
| sync_status 为 `need_push` | 低 |
| 其他（synced + clean） | 最低 |

## 后果

- 从详情页返回主页不再触发全量刷新，提升导航响应速度。
