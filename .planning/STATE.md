# State: 华声分镜素材下载器

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-05)

**Core value:** 稳定、完整地把每个分镜的推荐视频素材下载到本地，并按分镜编号命名。

## Current Phase

Phase 1: CLI 与登录态基础

## Status

Initialized. Ready for implementation.

## Notes

- 用户已确认华声页面需要登录，当前已经登录。
- 下载范围为每个分镜“展开更多”后的全部推荐素材。
- 分镜优先从页面 UI 发现；最后分镜 URL 可作为备用。
- 文件命名为 `分镜01_素材01.mp4`。
- 重复素材按分镜各保存一份。
- Phase 3 补充需求：推荐素材必须从 `.ClipChoiceList_contentWrap__Ii6jf` 容器扫描，兼容两列/三列布局。
- Phase 3 补充需求：素材播放弹窗必须点击 `button[aria-label="关闭"]` 关闭；`Esc` 已测试无效。
- Phase 3/4 策略更新：默认走全局“收藏”tab，不按分镜循环，输出 `素材01.mp4`；`--tab 推荐` 才走按分镜推荐模式。

---
*Last updated: 2026-06-06 after collection-mode strategy update*
