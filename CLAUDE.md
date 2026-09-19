# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

默认使用简体中文回复。

## 环境

- Apple Silicon M1 (ARM64)，原生模块必须 `darwin-arm64`。
- 安装：`npm_config_arch=arm64 npm_config_platform=darwin npm install`

## 常用命令

```bash
npm test                    # node:test 运行所有测试
npm run check               # 语法检查（node --check）
npm run create -- <txt> --mode A|B   # 创建华声视频项目（失败自动取证到 debug/）
npm run resume -- <URL> --mode A|B --start 1|2|3  # create 失败后在已有项目页续传，勿重跑 create
npm run download -- <URL>   # 下载收藏/推荐视频素材 (mp4)
npm run mg-download -- <URL> # 下载 MG 动画 (webm)
```

## 项目架构

两个独立 CLI，各自包含完整的 Playwright 浏览器自动化：

### `src/huasheng-download.js` — 分镜视频素材下载

推荐模式按分镜访问华声项目页并从播放弹窗提取 mp4；收藏模式直接读取华声分页接口，不滚动虚拟列表、不点击素材卡片。

收藏模式流程：

```text
分页接口一次性提取全部 → 统一下载 → 接口取消已下载成功项 → 服务端复查
```

收藏列表通过 `/api/innovideo/clip/video/favorite` 设置 `ps=200` 并按 `total` 分页。取消收藏通过 `/api/innovideo/clip/video/fav`，不得以卡片 DOM 消失或星标数量判断成功；全量清空必须复查 `total=0`。

核心流程：
1. 推荐模式：`discoverScenes()` 推断分镜，逐分镜打开素材弹窗提取视频
1. 收藏模式：捕获 favorite 列表 URL，直接分页生成完整下载队列
1. 全部下载结束后有限并发调用 fav 接口，失败重试并复查服务端剩余数
1. 写 `manifest.json`、`failures.json` 和跨运行 `collection-ledger.json`

关键约束：
- `wx` flag 排他写入，**永不覆盖**已有文件
- 收藏模式 `--limit` 是整次运行总量；推荐模式是每个分镜数量
- `materialUrlKey()` 签名参数去重，通过 `seenKeys` Set 避免重复下载
- 收藏文件从输出目录现有最大编号加一开始
- 只有下载成功的素材才能取消收藏；`--uncollect-only` 仅用于确认素材已下载后的补清理

### `src/mg-download.js` — MG 动画下载

打开项目视频页，直接收集时间轴上的全部 MG 条带，逐个点击条带并读取对应素材窗口中的 WebM 视频链接。

核心流程：
1. 从时间轴条带标题收集完整的 `MG动画NN` 编号（包括跨多个视频片段的条带）
1. 逐个点击 MG 条带，等待对应素材窗口更新
1. 查找与当前编号一致的 HTTP(S) `video[src$=".webm"]`
1. 按标题编号去重，直接请求 WebM URL，校验文件头并写 `manifest.json` 和 `failures.json`

关键细节：
- 编号只取素材窗口 `MG动画NN` 标题，不按 DOM 发现顺序猜测
- 禁止按分镜卡片遍历；跨片段 MG 不属于任意单一卡片，会被漏掉
- 只接受 HTTPS/HTTP `.webm` 直链，写入前校验 WebM magic bytes
- 直链来自页面 DOM，下载前必须经 `assertSafeDownloadUrl()` 校验：仅放行 http(s)，且主机名与其**全部 DNS 解析结果**都不得落在内网/环回/链路本地/CGNAT；请求同时设 `maxRedirects: 0`，避免 302 把带登录态的请求带进内网
- 输出格式 `MG动画_01.webm`，`--limit` 控制最多下载数量

### 共享模式

两个 CLI 共用以下模式但各自独立实现（没有共享文件）：
- `launchPersistentContext` 登录态持久化到 `.browser-profile`
- `isProbablyLoggedOut()` 关键词检测，未登录时 `pauseForEnter` 等用户手动登录
- `writeJson()` / `ensureDir()` / `pad2()` 工具函数
- 输出目录默认 `~/Desktop/hs-src`

## 测试

`node:test` 内置框架，纯函数单元测试：
- `test/huasheng-download.test.js` — URL、接口分页、取消请求、永久台账和排他写入
- `test/mg-download.test.js` — `pad2`, `mgFilename`

无浏览器集成测试。

## 排障文档

仅在下载异常（报错、卡住、编号跳跃、统计不一致）时读取 `docs/download-troubleshooting.md`。

## 关键约束

- 任何情况下不能覆盖已有视频（`wx` flag）
- 只有下载成功的素材才能取消收藏；清空结果必须以服务端接口复查为准
- 真实下载会修改远端收藏状态，必须在用户明确要求后执行
- 启动下载后持续观察直到进程结束

## Agent 统一调用

Claude Code、Hermes 或其他 Agent 都应调用现有 CLI，不得临时改写流程。不在项目目录时使用：

```bash
npm --prefix /Users/liubo/Desktop/PROJECT/00tools/huasheng-download run download -- '<华声项目URL>' --out '<绝对输出目录>'
```

调用前确认用户已授权真实下载及取消收藏；只检查时加 `--dry-run`，仅下载不取消收藏时加 `--no-uncollect`。
