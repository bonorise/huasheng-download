# 华声素材下载排障手册

仅在下载出现异常或需要复盘时读取本文档。正常下载无需加载。

## 当前收藏流程

收藏模式的核心调用链：

```text
main
  → extractCollectionMaterials
  → extractVisibleMaterials
  → processMaterials
  → cleanupDownloadedCollections
  → 重新进入下一轮
```

每轮会滚动收藏容器，提取当前可加载素材，下载成功后取消收藏。剩余素材上移，程序重新打开列表继续扫描，直到收藏列表没有星标素材。

不要把“单轮只发现约 12 个素材”误判为列表已处理完。华声收藏列表存在懒加载、虚拟列表或可视区域限制。

## 运行前检查

```bash
npm test
npm run check
git status --short
find /Users/liubo/Desktop/hs-src -maxdepth 1 -type f -name '素材*.mp4' | wc -l
```

同时确认：

- 登录态可用；不确定时使用可见浏览器。
- 磁盘空间足够。
- 没有另一个进程写入同一输出目录。
- 用户明确同意执行真实下载和取消收藏。

## 正常日志

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

单轮长时间没有日志不一定是卡死，可能正在等待 mp4 响应、滚动稳定判定或下载大文件。连续数分钟没有输出时，再检查浏览器页面和终端进程。

## 只下载首批素材

症状：只得到约 12 个文件，但收藏 tab 仍有素材。

检查：

- `extractVisibleMaterials` 是否滚动 `MATERIAL_CONTAINER_SELECTOR` 对应容器。
- 取消收藏后是否重新进入下一轮。
- `countCollectIconsInContainer` 是否过早返回 0。
- 不要将流程改回单轮扫描。

关键选择器：

```text
MATERIAL_CONTAINER_SELECTOR = .ClipChoiceList_contentWrap__Ii6jf
COLLECT_ICON_SELECTOR       = [class*="ClipChoiceItem_collectIconWrap__"]
MODAL_CLOSE_SELECTOR        = button[aria-label="关闭"]
```

站点升级后选择器可能变化。先在可见浏览器检查 DOM，不要把选择器失效误判为收藏已清空。

## 登录态失效

症状：浏览器停在登录、验证码、手机号或微信扫码页面。

处理：

1. 使用默认可见浏览器运行。
2. 在浏览器中完成登录。
3. 回到终端按回车继续。
4. 登录态保存在项目内 `.browser-profile/`。

## 未捕获到 mp4 URL

可能记录：

```text
未从弹窗 DOM 或网络请求捕获到 mp4 URL
```

程序同时从弹窗 DOM 和网络响应捕获 mp4。短于 4 秒或页面行为异常的卡片更容易出现该告警。

处理原则：

- 提取告警不等同于最终下载失败。
- 后续列表变化可能让卡片重新出现并成功处理。
- 最终结合收藏列表是否清空、`manifest.json` 和 `failures.json` 判断。

## 弹窗未关闭

症状：

- 后续候选无法点击。
- 记录中出现 `modalClosed: false`。
- 页面停留在播放弹窗。

优先检查 `button[aria-label="关闭"]`。推荐模式有 recovery 回调；收藏模式本轮停止后，可通过重新打开项目页面恢复。

## 下载失败和重试

- 视频 key 使用 mp4 URL 的 `origin + pathname`，忽略签名参数。
- `downloadedVideoKeys` 只能在下载成功后更新。
- 下载失败最多尝试两次。
- 下载成功但取消收藏失败的素材不能重复下载。
- 本轮成功下载或成功取消收藏都算作循环进展。
- 没有进展且没有可重试素材时退出，避免无限循环。

## 文件覆盖或编号异常

收藏模式会扫描输出目录中的 `素材NN.mp4`，从最大编号加一开始。

写入必须保持：

```js
fs.writeFile(filePath, body, { flag: 'wx' })
```

- 收藏模式遇到同名文件时自动尝试下一编号。
- 推荐模式遇到同名文件时失败并记录。
- 不要改成覆盖写入。

## 取消收藏失败

失败记录：

```json
{
  "uncollectStatus": "failed",
  "uncollectError": "..."
}
```

处理：

- 保留已下载文件。
- 后续轮次继续尝试取消收藏。
- 最终失败时在 `failures.json` 中保留 `failureType: "uncollect"`。
- 不取消下载失败或 dry-run 素材的收藏。

## 运行中断

当前 manifest 只描述本次进程，不会自动从上次 manifest 恢复 URL 去重。

重新运行时：

- 文件编号会从磁盘最大编号继续，不会覆盖。
- 已取消收藏的素材不会再出现。
- 已下载但尚未取消收藏的素材可能被重复下载为新编号。

若中断发生在下载完成、取消收藏之前，先检查上次 `manifest.json` 和远端收藏状态。

## 统计含义

`summary.failed` 包含提取告警，不只代表最终下载失败。因此要分别检查：

- `manifest.items[].status`
- `manifest.items[].uncollectStatus`
- `failures[].failureType`
- `failures[].reason`

## 完成验收

正常清空时日志应出现：

```text
[收藏] 收藏列表中已无星标素材，提取结束
[收藏] 收藏列表已清空，没有更多素材
```

检查统计：

```bash
node --input-type=module -e "
import fs from 'node:fs/promises';
const manifest = JSON.parse(await fs.readFile('/Users/liubo/Desktop/hs-src/manifest.json', 'utf8'));
const failures = JSON.parse(await fs.readFile('/Users/liubo/Desktop/hs-src/failures.json', 'utf8'));
console.log({ summary: manifest.summary, failures: failures.length });
"
```

确认：

- `summary.downloaded === summary.total`
- `summary.uncollected === summary.downloaded`
- `summary.uncollectFailed === 0`
- 新文件编号大于旧文件最大编号
- 旧文件未被覆盖

检查文件数量和目录占用：

```bash
find /Users/liubo/Desktop/hs-src -maxdepth 1 -type f -name '素材*.mp4' | wc -l
du -sh /Users/liubo/Desktop/hs-src
```

## 2026-06-06 实测记录

项目 URL：

```text
https://www.huasheng.cn/video/158889664548866
```

结果：

- 运行约 24 分钟。
- 原有 `素材01.mp4` 到 `素材12.mp4`。
- 新增 133 个视频：`素材13.mp4` 到 `素材145.mp4`。
- 前 11 轮各处理 12 个，第 12 轮处理 1 个，第 13 轮确认列表为空。
- 133 个素材全部下载并取消收藏成功。
- 最终目录共有 145 个 mp4，约 635 MB。
- 有 2 条“未捕获到 mp4 URL”的提取告警，卡片文本为“时长不足 00:04”。
- 最终 `uncollectFailed` 为 0，收藏列表为空。

这些数字只用于判断运行形态，不是固定上限。
