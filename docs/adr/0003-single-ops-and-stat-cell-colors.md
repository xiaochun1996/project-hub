# ADR-0003: 单项目操作与统计格颜色标识

## 状态

已接受 (2026-06-20)

## 背景

Project Hub 主视图以卡片形式展示多个 Git 项目。当前存在两个可用性问题：

1. **缺少单项目 Refresh 入口** — 用户只能执行"Refresh All"，无法单独刷新某个项目的状态和 Issues。后端 `refresh_single` 命令已实现，但前端卡片上没有对应的操作入口。
2. **状态辨识度低** — 卡片内 4 个统计格（Open Issues / Working / Ahead / Behind）全部使用相同的灰底样式（`bg-muted/30`），无法快速识别哪些项目存在 Dirty、未推送、落后远程或有 Open Issues 等需关注的状态。

## 决策

### 1. 单项目操作

- 在每个 ProjectCard 的操作按钮区新增一个 **Refresh 图标按钮**（↻），点击后调用 `refresh_single` 仅刷新当前项目的 Git 状态和 Open Issues。
- Pull / Push 按钮维持现有的**条件显示**逻辑（仅在 need_pull / need_push / diverged 时出现）。

### 2. 统计格颜色标识

4 个统计格根据各自代表的状态**独立变色**，采用固定淡色背景：

| 统计格 | 变色条件 | 背景色 |
|---------|----------|--------|
| Working | `working_state === "dirty"` | 琥珀/橙色淡底 |
| Open Issues | `count > 0` | 琥珀淡底 |
| Ahead | `ahead > 0` | 蓝色淡底 |
| Behind | `behind > 0` | 琥珀淡底 |

规则：
- **固定淡色** — 只要满足条件就着色，不随数值大小变化深浅。
- **各格独立** — Diverged 状态下 Ahead 和 Behind 两格同时亮色，自然表达"两端都有差异"。
- **无异常则灰底** — Synced + Clean 状态下所有格子保持默认灰底，传达"无需关注"。

## 后果

- 用户可以在不触发全量刷新的情况下单独更新某个项目，减少不必要的网络请求。
- 通过颜色信号快速扫描项目列表，Dirty / 有 Issues / 需 Push / 需 Pull 的项目一目了然。
- 实现范围限于 `ProjectCard.tsx` 前端组件，无需修改后端逻辑。
