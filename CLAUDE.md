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
npm run download -- <URL>   # 下载收藏/推荐视频素材 (mp4)
npm run mg-download -- <URL> # 下载 MG 动画 (webm)
```

## 项目架构

两个独立 CLI，各自包含完整的 Playwright 浏览器自动化：

### `src/huasheng-download.js` — 分镜视频素材下载

按分镜访问华声项目页，在"收藏"或"推荐"tab 中提取素材播放弹窗里的 mp4 URL。

收藏模式流程：

```text
滚动提取 → 下载 → 取消收藏 → 重开列表 → 循环至收藏为空
```

核心流程：
1. `discoverScenes()` — 从页面 `<a href>` 和文本中推断分镜总数
1. 逐分镜 `openMaterialPanel()` → `selectMaterialTab()` → 滚动 `materialContainer()` → 提取 `visibleVideoSources()`
1. 下载后写 `manifest.json` 和 `failures.json`

关键约束：
- `wx` flag 排他写入，**永不覆盖**已有文件
- 收藏模式 `--limit` 是整次运行总量；推荐模式是每个分镜数量
- `materialUrlKey()` 签名参数去重，通过 `seenKeys` Set 避免重复下载
- 收藏文件从输出目录现有最大编号加一开始
- 只有下载成功的素材才能取消收藏

### `src/mg-download.js` — MG 动画下载

打开项目视频页，在底部分镜卡片横滚区域收集卡片，hover 触发 MG 按钮，通过 blob 差分检测提取 MG 动画视频数据。

核心流程：
1. `collectClipCards()` — 横向滚动画廊收集 `video-clip-*` 卡片
1. 逐卡片 hover → 找到 MG 按钮（`span.font-normal.text-[12px].whitespace-nowrap`）
1. `captureMGBlob()` — 点击前记录 `currentBlobVideoUrls()`，点击后双层检测新 blob：
   - `waitForWebmBlobVideo()` — 按面积排序可见 video，检查 `blob.type === 'video/webm'` 或文件头 `1a 45 df a3`（WebM magic bytes）
   - `waitForBlobVideoUrl()` — 短超时（1s）回退：任何新 blob 都接受，然后报"不是 webm"供调试
1. `readBlobVideo()` — 页面内 fetch blob，0x8000 分块转 base64
1. `seenBlobUrls` Set 去重，写 `manifest.json` 和 `failures.json`

关键细节：
- **点击前/后 blob URL 差分**是核心创新：记录点击前的所有 blob URL，只提取点击后新出现的，避免误抓分镜预览 mp4
- 双层检测确保优先捕获 WebM MG 动画；回退层提供可调试的错误信息
- 输出格式 `MG动画_01.webm`，`--limit` 控制最多下载数量
- headless 模式可能导致 blob fetch 全部失败，改用可见浏览器模式

### 共享模式

两个 CLI 共用以下模式但各自独立实现（没有共享文件）：
- `launchPersistentContext` 登录态持久化到 `.browser-profile`
- `isProbablyLoggedOut()` 关键词检测，未登录时 `pauseForEnter` 等用户手动登录
- `writeJson()` / `ensureDir()` / `pad2()` 工具函数
- 输出目录默认 `~/Desktop/hs-src`

## 测试

`node:test` 内置框架，纯函数单元测试：
- `test/huasheng-download.test.js` — `pad2`, `sceneUrl`, `sceneNumberFromUrl`, `materialUrlKey`
- `test/mg-download.test.js` — `pad2`, `mgFilename`

无浏览器集成测试。

## 排障文档

仅在下载异常（报错、卡住、编号跳跃、统计不一致）时读取 `docs/download-troubleshooting.md`。

## 关键约束

- 任何情况下不能覆盖已有视频（`wx` flag）
- 只有下载成功的素材才能取消收藏（huasheng-download）
- 真实下载会修改远端收藏状态，必须在用户明确要求后执行
- 启动下载后持续观察直到进程结束
