# Roadmap: 华声分镜素材下载器

## Overview

4 phases | 18 v1 requirements | All v1 requirements mapped

### Phase 1: CLI 与登录态基础

**Goal:** 建立可运行的 Node.js CLI，并能打开带持久化登录态的华声页面。

**Success Criteria**:
1. 用户可以通过命令输入项目 URL。
2. 默认输出目录为 `/Users/liubo/Desktop/hs-src`，不存在时自动创建。
3. 浏览器 profile 可以保留登录态。
4. 未登录时，headed 浏览器提示用户登录后继续。

**Requirements:** INPT-01, INPT-02, AUTH-01, AUTH-02

### Phase 2: 分镜发现与遍历

**Goal:** 从项目页面发现分镜并按顺序进入每个分镜。

**Success Criteria**:
1. 工具优先从页面 UI 读取分镜入口或数量。
2. 工具可按 URL 规则构造并访问每个分镜页面。
3. 自动发现失败时支持最后分镜 URL 或总数作为备用。
4. 单个分镜失败不会中断整个任务。

**Requirements:** INPT-03, SCEN-01, SCEN-02, SCEN-03

### Phase 3: 推荐素材 URL 提取

**Goal:** 对每个分镜打开推荐素材列表，并从素材播放弹窗提取 mp4 地址。

**Success Criteria**:
1. 工具可以点击“展开更多”。
2. 工具可以定位“推荐”素材列表。
3. 工具可以逐个点击素材封面。
4. 工具可以读取弹窗 `<video src>`。
5. 工具可以关闭弹窗并继续。

**Requirements:** MATR-01, MATR-02, MATR-03, MATR-04, MATR-05

### Phase 4: 下载、清单与验证

**Goal:** 下载素材到桌面目录，并生成完整清单和失败记录。

**Success Criteria**:
1. 视频文件保存到 `/Users/liubo/Desktop/hs-src`。
2. 文件名符合 `分镜01_素材01.mp4`。
3. 重复素材按分镜分别保存。
4. `manifest.json` 记录所有成功和失败条目。
5. 脚本运行结束时输出下载统计。

**Requirements:** DOWN-01, DOWN-02, DOWN-03, DOWN-04, DOWN-05

---
*Roadmap created: 2026-06-05*
