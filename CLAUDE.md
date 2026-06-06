# CLAUDE.md

本文件为 Claude Code 在本项目中开发、运行和排查下载任务提供项目级指导。默认使用简体中文沟通和编写文档。

## 环境约束

- 机器为 Apple Silicon M1（ARM64）。
- 所有二进制和原生模块必须使用 `darwin-arm64`。
- 严禁安装或下载 `darwin-x64`、`x86_64` 版本。
- 安装依赖时固定架构：

```bash
npm_config_arch=arm64 npm_config_platform=darwin npm install
```

## 项目概述

这是一个基于 Playwright Chromium 的华声视频素材下载 CLI。它复用持久化登录态，打开华声项目素材面板，从视频播放弹窗的 DOM 或网络响应中提取 mp4 URL，并将视频下载到本地。

默认模式处理全局“收藏”列表，目标是：

1. 滚动收藏容器，提取当前可加载素材。
2. 下载成功的素材。
3. 取消这些素材的收藏。
4. 重新打开收藏列表，让剩余素材上移并继续扫描。
5. 重复上述流程，直到收藏列表没有星标素材，或达到 `--limit`。

不要把“单轮只发现约 12 个素材”误判为列表已处理完。华声收藏列表存在懒加载、虚拟列表或可视区域限制，必须依靠多轮“提取 → 下载 → 取消收藏 → 重开列表”才能真正清空。

## 常用命令

```bash
# 语法检查
npm run check

# 单元测试
npm test

# 默认收藏模式
npm run download -- https://www.huasheng.cn/video/158889664548866

# 推荐模式
npm run download -- <项目URL> --tab 推荐 --count 1 --limit 10

# 收藏模式限制本次运行成功下载总数
npm run download -- <项目URL> --limit 10
```

## 当前架构

主程序位于 `src/huasheng-download.js`，入口为 `main()`。

### 收藏模式

收藏模式的核心调用链：

```text
main
  → extractCollectionMaterials
  → extractVisibleMaterials
  → processMaterials
  → cleanupDownloadedCollections
  → 重新进入下一轮
```

每轮提取时，`extractVisibleMaterials` 会：

1. 检查收藏容器内是否还有星标图标。
2. 调用 `markVisibleMaterialCandidates` 标记当前可见候选。
3. 点击候选并通过两个通道捕获 mp4：
   - `waitForModalVideoUrl`：读取弹窗中的 `<video>` 或 `<source>`。
   - `waitForMp4Response`：监听网络中的 mp4 响应。
4. 关闭播放弹窗。
5. 调用 `scrollMaterialList` 滚动素材容器。
6. 连续多次没有新素材且无法继续下滚后结束本轮。

每轮下载完成后，`cleanupDownloadedCollections` 只取消 `status === "downloaded"` 且尚未标记为 `uncollected` 的记录。

### 推荐模式

显式传入 `--tab 推荐` 时：

1. `discoverScenes` 发现分镜数量。
2. `extractSceneMaterials` 逐分镜打开页面并扫描推荐素材。
3. `--limit` 表示每个分镜最多下载数量。

推荐模式文件名为 `分镜NN_素材NN.mp4`。

## 文件安全约束

任何情况下都不能覆盖已有视频。

收藏模式启动时会扫描输出目录中的 `素材NN.mp4`，从最大编号加一开始。例如已有 `素材01.mp4` 到 `素材12.mp4`，新文件从 `素材13.mp4` 开始。

实际写入使用排他模式 `wx`：

- 如果目标文件已存在，收藏模式自动尝试下一编号。
- 推荐模式发现同名文件时应失败并记录，不能覆盖。
- 不要把排他写入改回普通 `fs.writeFile`。

默认输出目录：

```text
/Users/liubo/Desktop/hs-src
```

## 去重、重试与循环终止

- 视频 key 使用 mp4 URL 的 `origin + pathname`，忽略临时签名参数。
- `downloadedVideoKeys` 只能在下载成功后更新。
- 下载失败的素材最多尝试两次，不能在首次尝试前永久加入去重集合。
- 下载成功但取消收藏失败的素材不能重复下载，但后续轮次应继续尝试取消收藏。
- 本轮成功下载或成功取消收藏都属于“有进展”，应继续下一轮。
- 没有新下载、没有成功取消收藏、也没有可重试素材时退出，避免无限循环。
- 收藏列表星标数量为 0 时直接退出，不再做无意义滚动。
- 收藏模式的 `--limit` 是整次运行的成功下载总量，不是每轮数量。

## 运行前检查

真实下载会修改远端收藏状态。启动前依次检查：

1. 确认用户明确要求开始真实下载，而不是仅测试代码。
2. 运行：

```bash
npm test
npm run check
```

3. 检查工作树，避免误提交无关文件：

```bash
git status --short
```

4. 检查输出目录和下一编号：

```bash
find /Users/liubo/Desktop/hs-src -maxdepth 1 -type f -name '素材*.mp4' | wc -l
```

5. 确认磁盘空间足够。一次完整收藏下载可能持续二十分钟以上，并占用数百 MB。
6. 首次或登录态不确定时使用可见浏览器，不要优先使用 `--headless`。
7. 不要同时启动两个写入同一输出目录的下载进程。排他写入虽能防覆盖，但并发会造成编号交错和重复远端操作。

## 运行中观察

运行下载时使用长驻终端会话并持续读取输出，不要启动后立刻结束任务。

正常日志应呈现以下顺序：

```text
[收藏] 新素材将从 素材NN.mp4 开始编号
[收藏] === 第 1 轮提取 ===
[收藏] 捕获素材 ...
[收藏] 第 1 轮处理 ...
[收藏] 已下载 素材NN.mp4
[收藏] 下载阶段已完成，开始取消 ...
[收藏] 已取消收藏 ...
[收藏] === 第 2 轮提取 ===
```

重点观察：

- 初始编号是否大于已有最大编号。
- 每轮是否真正执行容器滚动，而不是只处理首屏。
- 文件编号是否连续增长且没有回到 01。
- 下载成功后是否进入取消收藏阶段。
- 取消收藏后是否重新打开列表进入下一轮。
- 单轮长时间没有日志不一定是卡死，可能正在等待 mp4 响应、滚动稳定判定或下载大文件。
- 若连续数分钟没有输出，再检查浏览器是否停在登录页、弹窗是否未关闭、页面选择器是否失效。

不要仅因为某轮固定捕获 12 个就停止进程。本次实测前 11 轮均捕获约 12 个，最后一轮才只剩 1 个。

## 已知风险与处理

### 1. 收藏列表只下载首批素材

症状：只得到约 12 个文件，但收藏 tab 明显还能向下滚动或取消收藏后仍有素材。

处理：

- 确认 `extractVisibleMaterials` 正在滚动 `MATERIAL_CONTAINER_SELECTOR` 对应的容器。
- 确认主流程在取消收藏后继续下一轮。
- 不要改成单轮扫描。

### 2. 页面选择器失效

关键选择器：

```text
MATERIAL_CONTAINER_SELECTOR = .ClipChoiceList_contentWrap__Ii6jf
COLLECT_ICON_SELECTOR       = [class*="ClipChoiceItem_collectIconWrap__"]
MODAL_CLOSE_SELECTOR        = button[aria-label="关闭"]
```

症状可能包括：

- “未找到推荐素材容器”
- “未找到素材 tab”
- 星标数量错误地显示为 0
- 无法关闭播放弹窗

站点升级后优先在可见浏览器中检查 DOM，再更新选择器和测试。不要在未确认页面状态时把“选择器失效”当作“收藏已清空”。

### 3. 登录态失效

症状：浏览器停在登录、验证码、手机号或微信扫码页面。

处理：

- 使用默认可见浏览器运行。
- 在打开的浏览器中完成登录。
- 回到终端按回车继续。
- 登录态保存在项目内 `.browser-profile/`。

### 4. 未捕获到 mp4 URL

可能记录：

```text
未从弹窗 DOM 或网络请求捕获到 mp4 URL
```

短于 4 秒或页面行为异常的卡片更容易出现。本次实测两条记录的卡片文本均为“时长不足 00:04”。

处理原则：

- 这是提取告警，不等同于最终下载失败。
- 后续列表变化可能使相关卡片重新出现并被成功处理。
- 运行结束后结合 `manifest.json`、`failures.json` 和收藏列表是否清空判断。
- 如果收藏列表已清空、所有下载记录成功、取消收藏失败为 0，可保留该告警作为诊断信息。

### 5. 弹窗未关闭

症状：

- 后续候选无法点击。
- 日志记录 `modalClosed: false`。
- 页面长时间停留在播放弹窗。

推荐模式有 recovery 回调，会重新加载当前素材列表。收藏模式下若无法关闭弹窗，本轮会停止，下一轮重新打开项目页面。不要盲目点击页面其他区域，优先使用 `button[aria-label="关闭"]`。

### 6. 取消收藏失败

取消收藏失败的记录会标记：

```json
{
  "uncollectStatus": "failed",
  "uncollectError": "..."
}
```

处理原则：

- 已下载文件保留，绝不重复覆盖。
- 后续轮次继续把该记录加入清理队列。
- 如果最终仍失败，在 `failures.json` 中保留 `failureType: "uncollect"`。
- 不要为了清空列表而取消下载失败或 dry-run 素材的收藏。

### 7. 下载中断

当前 manifest 只描述本次进程，不会从上次 manifest 自动恢复 URL 去重。中断后重新运行时：

- 文件编号会从磁盘现有最大编号继续，因此不会覆盖。
- 已经取消收藏的素材不会再次出现。
- 已下载但尚未取消收藏的素材可能重新下载为新编号。

若中断发生在“下载完成、取消收藏之前”，重新运行前先查看上次 `manifest.json`，必要时人工确认收藏状态，避免重复下载。

### 8. `failures.json` 数量与 summary.failed

`summary.failed` 当前统计的是所有失败/告警记录数量，包括提取告警，不只统计最终下载失败。因此：

- `summary.failed > 0` 不一定代表有视频下载失败。
- 需要分别检查 `manifest.items[].status`、`uncollectStatus` 和 `failures[].failureType/reason`。

## 完成验收

命令正常退出后，必须完成以下检查：

1. 日志明确出现：

```text
[收藏] 收藏列表中已无星标素材，提取结束
[收藏] 收藏列表已清空，没有更多素材
```

2. 检查 manifest 和 failures：

```bash
node --input-type=module -e "
import fs from 'node:fs/promises';
const manifest = JSON.parse(await fs.readFile('/Users/liubo/Desktop/hs-src/manifest.json', 'utf8'));
const failures = JSON.parse(await fs.readFile('/Users/liubo/Desktop/hs-src/failures.json', 'utf8'));
console.log({ summary: manifest.summary, failures: failures.length });
"
```

3. 确认：

- `summary.downloaded === summary.total`
- `summary.uncollected === summary.downloaded`
- `summary.uncollectFailed === 0`
- 文件名从本次起始编号连续增长
- 旧文件仍然存在且未被覆盖

4. 检查最终文件数量和目录占用：

```bash
find /Users/liubo/Desktop/hs-src -maxdepth 1 -type f -name '素材*.mp4' | wc -l
du -sh /Users/liubo/Desktop/hs-src
```

## 2026-06-06 实测基线

项目 URL：

```text
https://www.huasheng.cn/video/158889664548866
```

运行结果：

- 运行时间约 24 分钟。
- 输出目录原有 `素材01.mp4` 到 `素材12.mp4`。
- 本次从 `素材13.mp4` 开始，新增 133 个视频，最后为 `素材145.mp4`。
- 前 11 轮每轮处理 12 个素材，第 12 轮处理 1 个，第 13 轮确认列表为空。
- 133 个素材全部下载成功。
- 133 个素材全部取消收藏成功。
- 最终目录共有 145 个 mp4，约 635 MB。
- `failures.json` 有 2 条“未捕获到 mp4 URL”的提取告警，卡片文本均为“时长不足 00:04”。
- 最终收藏列表为空，`uncollectFailed` 为 0。

这组数据用于判断运行形态，不是固定业务上限。后续收藏数量、每轮加载数量和耗时都可能变化。

## 开发与测试

`test/huasheng-download.test.js` 使用 `node:test` 和 `node:assert/strict`，当前覆盖：

- URL 与分镜映射。
- 素材 URL 和封面 key 归一化。
- 取消收藏队列过滤。
- 收藏文件下一编号计算。
- 全局连续编号分配。
- 收藏模式总量限制。
- 成功下载 key 筛选。
- 排他写入防覆盖。
- 文件冲突时自动跳到下一编号。
- 下载失败重试筛选。
- 下载或取消收藏是否构成循环进展。

浏览器 DOM、真实登录态和华声站点行为仍依赖人工实测。修改收藏流程后至少运行：

```bash
npm test
npm run check
git diff --check
```

涉及真实下载时，应先使用较小 `--limit` 验证，再在用户明确同意后执行完整下载。
