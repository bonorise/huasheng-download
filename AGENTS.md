# AGENTS.md

默认用简体中文回答；只有在用户要求时才用英文。生成的文档、计划、解释说明等文本文档内容，默认使用中文。

## 环境信息

- 这台电脑是 Apple Silicon M1 (ARM64) 芯片。
- 所有二进制/原生模块必须使用 arm64 版本。
- 严禁安装下载 darwin-x64/x86_64 的任何包。
- npm/pnpm 安装原生模块时确保平台为 darwin-arm64。
- 常见易出问题的包：esbuild、sharp、better-sqlite3、@next/swc、rollup、lightningcss、@remotion/compositor 等。

## 项目说明

这是一个华声视频制作 agent 的分镜素材下载工具。目标是输入华声项目 URL，复用登录态，批量下载每个分镜“推荐”列表中的视频素材到 `/Users/liubo/Desktop/hs-src`。

## 运行

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866
```

如果自动发现分镜不完整：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --last-url "https://www.huasheng.cn/video/158889664548866?clip=42"
```

## 项目经验

### MG 动画 blob webm 下载

- 现象：华声改版后 MG 动画 `video` 不再暴露 `data-mov-src` / http mp4，而是 `<video src="blob:https://www.huasheng.cn/...">`，原脚本按 mp4 URL 下载会失效。
- 根因：blob URL 只在浏览器页面上下文有效，Node 侧 `context.request.get(blob:...)` 不能直接下载；需要在 Playwright 页面内 `fetch(blobUrl)` 读取 `ArrayBuffer`。
- 解决：保持 `src/mg-download.js` 的横向分镜卡片扫描、hover 封面、点击“MG动画 N”按钮流程；点击后枚举播放器内 blob video，只接受 MIME 为 `video/webm` 或文件头 `1a 45 df a3` 的 WebM blob，在页面上下文分块 base64 传回 Node，写为 `MG动画_XX.webm`。
- 易踩坑：页面可能同时挂载分镜 mp4 blob 与 MG webm blob，必须用 `blob.type === "video/webm"` 或 WebM 魔数过滤；大文件转 base64 要分块；不要误改成分镜素材 mp4 下载流程。
- 验证：`npm run check`、`npm test`、`npm run mg-download -- https://www.huasheng.cn/video/167569113927795 --limit 1 --headless`，输出文件用 `file <path>` 应显示 `WebM`。

### MG 下载顺序和 headless 限制

- headless 模式下全部 MG blob 可能 `Failed to fetch`，疑似 blob 生命周期/渲染时序差异；如果 headless 全部失败，改用可见浏览器模式，不加 `--headless`，可加 `--slow-mo 80`。
- 剪辑素材项目中应先下载全部视频素材，确认完毕后再下载 MG 动画；不要两个流程同时跑或先跑 MG。

### 创建项目 A/B 方案 — 纯定时操作（不依赖 DOM 检测）

- 现象：华声创建视频项目时，提交文案后 AI 会回复并提示选择 A/B 方案；页面 DOM 结构不透明，检测 A/B 按钮或内容生成停止都不可靠。
- 根因：华声 AI 对话区 DOM 选择器无法盲猜，`detectABButtons`、`waitForContentGenerationToStop` 等检测逻辑全部失效。
- 解决：**纯定时操作**，不做任何 DOM 检测：
  1. 填写文案 → 点击”创建”
  2. 等 60 秒 → 在聊天输入框输入 `”确认 A 方案”` 或 `”确认 B 方案”`
  3. 等 60 秒 → 输入 `”确认”`
  4. 等待 URL 跳转到 `/video/<id>?clip=-1`（URL 检测可靠）
  5. 等 60 秒 → 输入 `”确认”`
- 易踩坑：不要试图检测按钮、DOM 状态、内容生成进度；`--mode B` 方案定时器是全局的，每个等待 60 秒固定不变。
- 验证：`npm test`、`npm run check`。
