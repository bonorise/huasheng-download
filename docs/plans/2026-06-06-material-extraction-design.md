# 素材提取稳定性设计

## 背景

测试发现华声“推荐”素材列表在不同浏览器尺寸下不一定是两列，也可能是三列或更多列。当前脚本按右侧可见图片近似扫描，容易受布局变化影响。

另一个关键问题是素材播放弹窗会遮挡后续素材封面。点击素材封面并获取到 `video[src]` 后，必须点击弹窗右上角的关闭按钮，确认弹窗关闭后，才能继续点击下一个素材封面。实际测试中 `Esc` 无法关闭该弹窗，因此不能作为正常关闭路径。

## 目标

这是 **Phase 3: 推荐素材 URL 提取** 的补充需求设计，修正测试中发现的素材容器布局和播放弹窗关闭问题。

- 不依赖素材列表是两列还是三列。
- 只在推荐素材列表容器内采集素材封面，降低误点概率。
- 每个素材形成完整处理闭环：点击封面、获取 URL、关闭弹窗、确认弹窗消失、继续下一个。
- 单个素材失败不影响同一分镜后续素材。

## 推荐方案

采用“容器内卡片队列 + DOM 优先/网络兜底 + 弹窗生命周期控制”。

### 素材容器

使用推荐素材列表容器作为唯一采集范围：

```css
.ClipChoiceList_contentWrap__Ii6jf
```

已知页面路径：

```text
#video-editor-right-bar-xk7m > div > div > div > div > div > div.jsx-eab2a758f8de6bd0.absolute.bottom-0.left-0.right-0.z-\[6\].flex.justify-center.px-\[16px\].pb-\[16px\] > div > div.flex-1.overflow-hidden.relative > div
```

```text
/html/body/main/div/div[3]/div/div/div[2]/div/div/div/div/div/div[3]/div/div[2]/div
```

脚本应优先使用 class 选择器，复杂 CSS 路径和 XPath 只作为诊断或备用线索。

### 卡片排序

每轮只扫描容器内当前可见素材卡片，按元素实际坐标排序：

1. `top` 从小到大
2. 同一行内 `left` 从小到大

这样不关心页面实际显示为两列、三列或更多列。

### URL 获取

点击素材卡片后，URL 获取采用双通道：

1. 主路径：等待弹窗中的 `video[src]` 出现，并读取 `.mp4` 地址。
2. 兜底：监听点击后短时间内出现的 `.mp4` 网络请求或响应。

DOM 路径优先，因为用户观察到真实素材地址明确出现在弹窗 `video` 标签中；网络监听用于处理 DOM 挂载慢或短暂闪现的情况。

### 弹窗关闭

正常关闭路径只使用右上角关闭按钮：

```css
button[aria-label="关闭"]
```

按钮示例：

```html
<button aria-label="关闭" class="absolute right-[15px] top-[15px] z-20 flex h-8 w-8 items-center justify-center rounded-[8px] border-none p-0 text-white/80 hover:bg-white/10 hover:text-white">...</button>
```

`Esc` 已测试无效，不作为正常关闭策略。

关闭后必须等待以下任一条件成立，才能继续下一个素材：

- 弹窗内 `video[src]` 消失。
- `button[aria-label="关闭"]` 消失。
- 弹窗遮罩/播放容器不再可见。

如果关闭按钮点击失败或弹窗未消失，记录当前素材失败并尝试恢复页面状态；不要直接点击下一个封面。

### 滚动与停止

处理完当前可见卡片后，只滚动 `.ClipChoiceList_contentWrap__Ii6jf` 容器，不滚动整个页面。

停止条件：

- 连续多次滚动后没有发现新卡片。
- 容器滚动位置不再变化。
- 达到用户设置的 `--limit`。

### 错误处理

单个素材失败时记录：

- 分镜编号
- 素材序号或卡片坐标
- 失败原因
- 是否成功关闭弹窗

然后继续处理当前分镜的后续素材。单个分镜失败时继续处理后续分镜。

## 验收标准

- 在两列和三列布局下都能按视觉顺序处理素材。
- 每次获取素材 URL 后都会点击 `button[aria-label="关闭"]`。
- 弹窗未关闭时不会继续点击下一个素材封面。
- `manifest.json` 中记录成功素材，`failures.json` 中记录失败素材。
- 不再依赖右侧区域的宽泛图片猜测作为主采集方式。

## 后续计划

下一步进入实现计划，更新 Phase 3 的素材提取逻辑。
