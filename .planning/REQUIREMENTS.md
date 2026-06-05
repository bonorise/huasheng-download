# Requirements: 华声分镜素材下载器

**Defined:** 2026-06-05
**Core Value:** 稳定、完整地把每个分镜的推荐视频素材下载到本地，并按分镜编号命名。

## v1 Requirements

### 输入与配置

- [ ] **INPT-01**: 用户可以通过 CLI 输入华声项目 URL。
- [ ] **INPT-02**: 用户可以指定输出目录，默认使用 `/Users/liubo/Desktop/hs-src`。
- [ ] **INPT-03**: 用户可以在自动发现分镜失败时提供最后一个分镜 URL 或总数作为备用。

### 登录与浏览器

- [ ] **AUTH-01**: 工具可以使用持久化浏览器 profile 保留华声登录态。
- [ ] **AUTH-02**: 当页面未登录时，工具可以打开 headed 浏览器并提示用户手动登录后继续。

### 分镜遍历

- [ ] **SCEN-01**: 工具可以优先从项目页面 UI 发现分镜入口或分镜数量。
- [ ] **SCEN-02**: 工具可以按华声 URL 规则访问每个分镜页面。
- [ ] **SCEN-03**: 工具可以记录当前处理的分镜编号，并在失败时继续处理后续分镜。

### 素材提取

- [ ] **MATR-01**: 工具可以打开右下角分镜头素材窗口并点击“展开更多”。
- [ ] **MATR-02**: 工具可以定位“推荐”素材列表并加载可见素材封面。
- [ ] **MATR-03**: 工具可以逐个点击素材封面，打开素材播放弹窗。
- [ ] **MATR-04**: 工具可以从素材播放弹窗中读取真实 `<video src>` mp4 地址。
- [ ] **MATR-05**: 工具可以关闭弹窗并继续处理下一个素材。
- [ ] **MATR-06**: 工具必须以 `.ClipChoiceList_contentWrap__Ii6jf` 推荐素材容器为扫描范围，不依赖页面是两列或三列布局。
- [ ] **MATR-07**: 工具必须按素材卡片实际坐标排序，先上后下，同一行从左到右处理。
- [ ] **MATR-08**: 工具必须通过 `button[aria-label="关闭"]` 关闭素材播放弹窗，并确认弹窗消失后才继续点击下一个封面。

### 下载与输出

- [ ] **DOWN-01**: 工具可以把每个素材下载到 `/Users/liubo/Desktop/hs-src`。
- [ ] **DOWN-02**: 工具可以按 `分镜01_素材01.mp4` 格式命名文件。
- [ ] **DOWN-03**: 同一素材出现在多个分镜时，工具仍按分镜分别保存。
- [ ] **DOWN-04**: 工具可以生成 `manifest.json`，记录源 URL、分镜编号、素材序号、输出文件和状态。
- [ ] **DOWN-05**: 工具可以生成失败记录，便于后续重试。

## v2 Requirements

### 增强能力

- **ENHC-01**: 支持断点重试失败素材。
- **ENHC-02**: 支持限制每个分镜下载前 N 个素材。
- **ENHC-03**: 支持导出 CSV 清单。

## Out of Scope

| Feature | Reason |
|---------|--------|
| 素材去重 | 用户要求重复素材按分镜各保存一份。 |
| 视频转码/压缩 | 当前目标是下载原始素材。 |
| Web UI | 本地 CLI 足够完成当前工作流。 |
| 绕过登录或权限 | 只复用用户已有合法登录态。 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INPT-01 | Phase 1 | Pending |
| INPT-02 | Phase 1 | Pending |
| INPT-03 | Phase 2 | Pending |
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| SCEN-01 | Phase 2 | Pending |
| SCEN-02 | Phase 2 | Pending |
| SCEN-03 | Phase 2 | Pending |
| MATR-01 | Phase 3 | Pending |
| MATR-02 | Phase 3 | Pending |
| MATR-03 | Phase 3 | Pending |
| MATR-04 | Phase 3 | Pending |
| MATR-05 | Phase 3 | Pending |
| MATR-06 | Phase 3 | Pending |
| MATR-07 | Phase 3 | Pending |
| MATR-08 | Phase 3 | Pending |
| DOWN-01 | Phase 4 | Pending |
| DOWN-02 | Phase 4 | Pending |
| DOWN-03 | Phase 4 | Pending |
| DOWN-04 | Phase 4 | Pending |
| DOWN-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-06-05*
*Last updated: 2026-06-06 after Phase 3 supplemental requirements*
