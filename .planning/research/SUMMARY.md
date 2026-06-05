# Research Summary: 华声分镜素材下载器

## Stack

- Node.js CLI + Playwright：适合需要登录态、点击 UI、读取动态 DOM 和处理弹窗的页面自动化。
- 原生 `fetch`/stream 下载：Node 22 已可用，避免额外下载器依赖。
- 持久化 Playwright profile：让用户在 headed 浏览器中登录一次，后续复用。
- JSON manifest：记录分镜、素材序号、源 URL、输出文件和失败原因。

## Table Stakes

- 可输入项目 URL。
- 可复用登录态。
- 可遍历分镜。
- 可点击“展开更多”和素材封面。
- 可读取弹窗 `<video src>`。
- 可下载 mp4 到固定目录。
- 可生成下载清单和失败记录。
- 可重跑且不误删已有文件。

## Watch Out For

- 签名视频 URL 有过期时间，需要边抓边下载。
- 页面文案、class 和布局可能变化，选择器需要多策略回退。
- 推荐列表可能懒加载，需要滚动素材窗口。
- 登录态未复用时，脚本应清楚提示用户在打开的浏览器中完成登录。
- Playwright 浏览器下载必须符合 Apple Silicon arm64 环境约束。

---
*Research synthesized inline because GSD subagents are not installed in this runtime.*
