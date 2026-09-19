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

从任意目录供 Claude Code、Hermes 或其他 Agent 调用：

```bash
npm --prefix /Users/liubo/Desktop/PROJECT/00tools/huasheng-download run download -- '<华声项目URL>' --out '<绝对输出目录>'
```

Agent 必须调用现有 CLI，不得为单次任务临时改写下载流程。

如果自动发现分镜不完整：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --last-url "https://www.huasheng.cn/video/158889664548866?clip=42"
```

## 项目经验

### MG 动画素材窗口 WebM 直链下载

- 现象：选中时间轴分镜后，素材窗口的 `MG动画NN` 区块已直接暴露 HTTPS `video[src=".../output.webm"]`；旧的 hover、点击 MG 按钮、等待 blob 和页面内 base64 传输既慢又不稳定。
- 解决：`src/mg-download.js` 直接收集时间轴上全部 `MG动画NN` 条带，逐个点击条带；从打开的对应素材窗口读取 HTTP(S) `.webm`，保存为 `MG动画_NN.webm`。不再保留 blob 回退流程。
- 易踩坑：MG 条带可能跨越两个或更多视频片段，禁止以分镜卡片为遍历单位，否则会漏项；编号以时间轴条带为准，不能按发现顺序猜测。只接受 HTTP(S) `.webm`，写入前校验 WebM 魔数 `1a 45 df a3`。
- 验证：`npm run check`、`npm test`、`npm run mg-download -- https://www.huasheng.cn/video/167569113927795 --limit 1 --headless`，输出文件用 `file <path>` 应显示 `WebM`。

### MG 下载顺序

- 剪辑素材项目中应先下载全部视频素材，确认完毕后再下载 MG 动画；不要两个流程同时跑或先跑 MG。

### 收藏页取消收藏必须走接口，禁止点击星标

- 现象：旧流程的坐标点击有时没有发出网络请求，但虚拟列表会回收或重排卡片，导致脚本误以为已经取消；下一项目仍会下载上次遗留收藏。
- 根因：星标受 hover、透明度、`pointer-events` 和虚拟 DOM 生命周期影响，DOM 消失不能证明服务端状态已改变。
- 解决：捕获收藏列表 `/api/innovideo/clip/video/favorite` 请求后，读取全部 `videos[].id`；使用同一请求的 `_ra`、`_bs`、`_fv` 参数及 `bili_jct` CSRF，向 `/api/innovideo/clip/video/fav` 发送 JSON：`{"clip_uuid":"<id>","fav":0,"is_revoke":false}`。并发数保持克制，单条失败自动重试。
- 成功标准：取消后重新分页读取收藏接口；仅当目标记录全部消失，`--uncollect-only` 模式下还必须 `total=0`，才算完成。不得再以卡片 DOM 或星标数量作为成功依据。
- 只清空收藏、不下载素材：`npm run download -- --uncollect-only --headless --slow-mo 0`。
- 验证：连续运行两次 `--uncollect-only`，第二次日志必须显示“服务端现有 0 条”；再运行 `npm test`、`npm run check`。

### 收藏下载与取消收藏必须严格分阶段

- 现象：收藏模式每下载约 10–12 个素材就取消收藏，再重新打开列表继续下载，速度慢且容易因懒加载卡片上浮、重排而定位失败。
- 根因：取消收藏调用被放进收藏下载的多轮循环；每轮都修改远端列表状态，破坏下一轮的滚动位置和卡片稳定性。
- 解决：下载循环期间严禁取消收藏；确认全部下载扫描结束或达到 `--limit` 后，再对本次成功下载记录执行一次统一取消收藏阶段。取消收藏结果不得作为下载循环继续条件。
- 验证：`npm run check`、`npm test`；真实运行日志中所有“已下载”必须出现在“全部下载阶段已结束，现在开始统一取消收藏”之前。

### 收藏下载必须保留跨运行永久台账

- `manifest.json` 仅表示本次运行，允许被下一次检查覆盖，禁止用它作为历史下载和取消收藏的唯一依据。
- 收藏模式成功下载后必须追加写入 `<out>/collection-ledger.json`，至少保留 `sourceKey`、收藏卡片特征、下载状态和取消收藏状态；每次取消结果也必须立即回写该台账。
- 后续运行应从台账读取未取消项补清理，并跳过已下载 URL，避免“本地已下载但因 manifest 被覆盖而漏取消”或重复下载。

### 收藏页直接分页接口下载流程

- 收藏页是虚拟列表，DOM 滚动可能只得到首批约 24 条；收藏下载不得再依赖滚动或逐卡点击。
- 捕获 `/api/innovideo/clip/video/favorite` 后设置 `ps=200`，按响应 `total` 和 `pn` 分页；`videos[].url` 直接用于下载，去除签名查询参数后的 URL 作为永久台账键。
- 正常流程固定为：一次分页取得完整收藏快照 → 全部下载 → 仅对已下载成功项调用取消接口 → 服务端复查；禁止边下载边取消。
- 验证：接口日志中的“提取数量/total”必须相等；运行 `node --test test/huasheng-download.test.js`、`npm run check`、`npm test`。

### 创建项目 A/B 方案 — 纯定时操作（不依赖 DOM 检测）

- 现象：华声创建视频项目时，提交文案后会先跳转到 `/video/<id>?clip=-1` 项目页，再继续在项目页输入框里接收 A/B 方案指令；页面 DOM 结构不透明，检测 A/B 按钮或内容生成停止都不可靠。
- 根因：华声 AI 对话区 DOM 选择器无法盲猜，`detectABButtons`、`waitForContentGenerationToStop` 等检测逻辑全部失效。
- 解决：项目页后用输入区按钮状态推进，不检测 AI 内容：
  1. 填写文案 → 点击”创建”
  2. 等待 URL 跳转到 `/video/<id>?clip=-1`（URL 检测可靠）
  3. 项目页最少等 10 秒，然后等 `停止` 按钮消失且 `发送` 按钮出现 → 输入 `方案 A` 或 `方案 B，确定只生成2 个 MG动画`
  4. 每次输入后等 `发送` 按钮 enabled，再点击发送；下一轮同样等 `停止` 消失 / `发送` 出现后输入 `确认`
  5. 第二次 `确认` 同上
- 易踩坑：不要试图检测 AI 回复内容；不要在首页提交后、项目页跳转前输入 A/B 指令；进入项目页后失败只能保留项目 URL 并提示下一步，不能重新创建项目。
- 项目页输入框当前占位符是 `输入自定义回答`；旧的 `输入你的任何想法` 只适用于部分页面，项目页继续输入 A/B 和确认时必须兼容两者。
- 验证：`npm test`、`npm run check`。

### 时间轴分镜下载

- 使用 `npm run download -- "<项目URL>" --storyboard --out "<目标目录>"`，顺序保存 `分镜01.mp4` 至最后一镜，保留源格式。
- 时间轴横向懒加载，必须滚动到底并与页面“分镜总数”校验；使用 `.clip-card-box` 内编号，不写死动态 `:r17:`。
- 卡片 `img[alt]` 是 clip ID，必须匹配 `video[data-loaded-clip-id]`，避免误取预加载的相邻视频。
- 收藏、推荐和分镜模式独立；分镜模式不清收藏。通过 `storyboard-manifest.json` 校验已有文件来源和大小，不覆盖冲突文件。
- 验证：`npm run check`、`npm test`；实跑后检查编号连续、失败清单为空、ffprobe 可读取全部视频。
