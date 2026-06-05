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
