# CLAUDE.md

默认使用简体中文回答和编写文档。

## 环境

- 机器是 Apple Silicon M1（ARM64）。
- 原生模块必须使用 `darwin-arm64`，严禁安装 `darwin-x64` 或 `x86_64` 包。

```bash
npm_config_arch=arm64 npm_config_platform=darwin npm install
```

## 项目

这是一个使用 Playwright 下载华声视频素材的 CLI。默认处理“收藏”列表，流程为：

```text
滚动提取 → 下载 → 取消收藏 → 重开列表 → 循环至收藏为空
```

常用命令：

```bash
npm test
npm run check
npm run download -- <华声项目URL>
```

## 关键约束

- 任何情况下都不能覆盖已有视频。
- 收藏文件从输出目录现有最大编号加一开始。
- 文件必须使用排他写入；不要把 `wx` 改回普通覆盖写入。
- 只有下载成功的素材才能取消收藏。
- 收藏模式的 `--limit` 是整次运行总量；推荐模式是每个分镜数量。
- 真实下载会修改远端收藏状态，必须在用户明确要求后执行。
- 启动真实下载后持续观察到进程结束，不要把后台进程留着。

## 按需排障

正常开发和正常下载不要加载详细排障文档。

仅当出现下载报错、长时间无输出、只下载首批素材、编号异常、取消收藏失败、运行中断或最终统计不一致时，再读取：

```text
docs/download-troubleshooting.md
```
