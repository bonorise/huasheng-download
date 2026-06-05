# 华声分镜素材下载器

## What This Is

这是一个本地自动化下载工具，用于从华声视频制作 agent 的项目页面批量下载每个分镜里的推荐视频素材。用户输入一个项目 URL，工具复用已登录状态，逐个进入分镜页面，展开右下角的分镜头素材窗口，打开推荐素材并提取弹窗中的视频地址，保存到桌面 `hs-src` 文件夹。

## Core Value

稳定、完整地把每个分镜的推荐视频素材下载到本地，并按分镜编号命名。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 用户可以输入华声项目 URL 启动下载任务。
- [ ] 工具可以复用已登录状态访问需要登录的项目页面。
- [ ] 工具可以从页面 UI 发现分镜列表，或在必要时接受最后一个分镜 URL 推算范围。
- [ ] 工具可以对每个分镜点击“展开更多”，加载“推荐”素材列表。
- [ ] 工具可以逐个打开素材封面弹窗，提取 `<video>` 的 `src` 地址。
- [ ] 工具可以把每个分镜的所有推荐视频素材下载到 `/Users/liubo/Desktop/hs-src`。
- [ ] 文件命名使用 `分镜01_素材01.mp4` 格式。
- [ ] 重复素材在不同分镜中也各保存一份，便于按分镜管理。
- [ ] 工具需要输出下载清单和失败记录，方便重试和排查。

### Out of Scope

- 不做云端服务或网页后台 — 当前只需要本机批量下载。
- 不做视频剪辑或二次处理 — 目标是原始素材落盘。
- 不做跨站素材搜索 — 只处理华声项目页面中展示的推荐素材。
- 不做素材去重 — 用户明确要求重复素材也按分镜各保存一份。

## Context

华声项目页示例为 `https://www.huasheng.cn/video/158889664548866`。同一项目的分镜页面可以通过 query 参数访问，例如 `?clip=1` 是第二个分镜，后续依次类推。页面右下角有“分镜头素材”的选择窗口，点击“展开更多”后展示“推荐”的视频素材窗口，窗口里有两列图片列表。点击素材封面会打开素材播放弹窗，弹窗中真实视频地址在 `<video class="relative z-[1] block h-full w-full object-contain" ... src="...mp4?...">` 的 `src` 属性中。

用户当前已经在浏览器中登录华声，因此实现应优先支持复用登录态或使用持久化浏览器 profile。运行环境是 Apple Silicon M1，所有二进制和原生模块必须使用 arm64/darwin-arm64 版本，严禁下载 x64/x86_64 包。

## Constraints

- **登录态**: 页面需要登录访问 — 自动化必须支持复用或创建持久化浏览器登录态。
- **输出路径**: 保存到 `/Users/liubo/Desktop/hs-src` — 用户明确指定。
- **命名规则**: `分镜01_素材01.mp4` — 便于按分镜查看。
- **重复素材**: 每个分镜都保存一份 — 避免去重破坏分镜归档。
- **平台架构**: Apple Silicon M1 arm64 — 安装和下载依赖时必须避免 darwin-x64/x86_64。
- **站点交互**: 素材 URL 可能是临时签名地址 — 需要即时打开弹窗并下载，不能长期依赖旧链接。

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 使用浏览器自动化而不是静态 HTTP 抓取 | 页面需要登录且素材地址在交互弹窗中出现 | — Pending |
| 默认下载每个分镜的全部推荐素材 | 用户选择“全部推荐” | — Pending |
| 按分镜重复保存同一素材 | 用户希望每个分镜独立管理 | — Pending |
| 命名格式为 `分镜01_素材01.mp4` | 用户选择最简编号命名 | — Pending |
| 优先从页面 UI 读取分镜列表 | 用户选择页面内发现，最后分镜 URL 可作为备用 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-05 after initialization*
