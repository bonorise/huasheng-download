# MG 动画批量下载 + 统一入口 设计文档

## 目标

在现有收藏视频下载基础上，新增 MG 动画批量下载功能，并通过统一入口先后调用两个模块。

## 文件结构

```
src/
  shared.js               # 新增：共享模块
  huasheng-download.js    # 重构：收藏下载（import shared.js，URL 改为默认值）
  mg-download.js          # 新增：MG 动画下载
  index.js                # 新增：统一入口
```

### shared.js — 从 huasheng-download.js 提取

| 导出项 | 说明 |
|--------|------|
| `DEFAULT_OUT_DIR` | `~/Desktop/hs-src` |
| `ensureDir(dir)` | 创建目录 |
| `writeFileExclusive(filePath, body)` | 排他写入（wx flag） |
| `downloadMaterial(context, item, outDir, referer)` | 通过 Playwright request API 下载 mp4 |
| `materialUrlKey(rawUrl)` | 从 URL 提取 origin+pathname 作为去重 key |
| `isProbablyLoggedOut(page)` | 检查页面是否未登录 |
| `pauseForEnter(message)` | 等待用户按回车 |
| `launchBrowser(args)` | 启动 Playwright 持久化浏览器 context，返回 `{ context, page }` |
| `pad2(number)` | 两位数补零 |
| `shortUrl(url)` | 缩短 URL 用于日志 |
| `writeJson(file, data)` | 写 JSON 文件 |

### huasheng-download.js 改动

- 从 `shared.js` 导入公共模块，删除本地定义
- `parseArgs` 中 URL 改为可选，不传则默认 `https://www.huasheng.cn/video/158889664548866`
- 导出 `downloadCollections(args)` 函数供 index.js 调用
- 原有 CLI 入口逻辑移入 `downloadCollections`

### mg-download.js 新增

- 从 `shared.js` 导入公共模块
- 导出 `downloadMGAnimations(args)` 函数供 index.js 调用
- 内部实现：`parseArgs`、`extractMGAnimations`、`processMGAnimations`

### index.js 统一入口

```
npm run download                                → 收藏下载（默认 URL）
npm run download -- <项目URL>                     → 收藏下载 + MG 下载
npm run download -- --mg-only <项目URL>           → 仅 MG 下载
```

逻辑：
```
if 无参数                  → downloadCollections({默认URL})
if 有URL + 无--mg-only    → downloadCollections({默认URL}) + downloadMGAnimations({传入URL})
if --mg-only + URL        → downloadMGAnimations({传入URL})
```

共用同一个浏览器 context，登录一次。

## MG 动画提取流程

```
1. goto 项目 URL，等待加载
2. 登录检查（复用 isProbablyLoggedOut + pauseForEnter）
3. 定位分镜滚动区: .flex.items-end.flex-1.gap-3
4. 横向滚动收集所有分镜卡片: [class*="video-clip-"]
5. 对每个卡片：
   a. 从卡片内的 "分镜XX" 文字提取 sceneNumber
   b. hover 封面图 (img.block.w-full.h-full.object-cover)
   c. 检查是否出现 MG 动画按钮 (span:has-text("MG动画"))
   d. 收集所有 <span>MG动画 YY</span> 按钮
   e. 遍历每个按钮：
      - click 按钮
      - 等待 video[data-mov-src] 出现
      - 提取 data-mov-src 属性值
      - 记录 { sceneNumber, mgNumber, url }
6. 按 sceneNumber、mgNumber 排序去重
7. 依次下载，保存为: MG动画_Scene-XX_YY.mp4
```

- 点击 MG 按钮后无需关闭播放器，下一个点击会自动切换
- 没有 MG 按钮的分镜直接跳过
- 相同 URL 去重防止重复下载

## 关键选择器

| 用途 | 选择器 |
|------|--------|
| 分镜滚动区 | `.flex.items-end.flex-1.gap-3`（需要更精确的定位，结合容器层级） |
| 分镜卡片 | `[class*="video-clip-"]` |
| 分镜序号 | 卡片内包含"分镜"文字的元素 |
| 封面图片 | `img.block.w-full.h-full.object-cover` |
| MG 动画按钮 | `span:has-text("MG动画")` |
| 视频 mov-src | `video[data-mov-src]` |

## 文件命名

格式：`MG动画_Scene-XX_YY.mp4`

- `XX` = 分镜序号，pad2（来自卡片 "分镜11"）
- `YY` = MG 动画序号，pad2（来自按钮 "MG动画 03"）

存入 `~/Desktop/hs-src/`，与收藏视频同一目录。

## 命令行选项

| 参数 | 说明 |
|------|------|
| `<URL>` | 项目 URL（MG 模式必填，收藏模式可选） |
| `--mg-only` | 仅下载 MG 动画，跳过收藏 |
| `--out <目录>` | 输出目录，默认 `~/Desktop/hs-src` |
| `--profile <目录>` | 浏览器 profile 目录 |
| `--headless` | 无头模式 |
| `--dry-run` | 只提取不下载 |
| `--slow-mo <毫秒>` | 操作延迟，默认 80 |
| `--limit <数量>` | 最多下载多少个 MG 动画 |
| `--count` `--last-url` | 收藏模式保留（MG 模式不需要） |
| `--tab` | 收藏模式保留（MG 模式固定处理分镜浏览区） |

## 错误处理

- 分镜卡片 hover 后未出现 MG 按钮 → 跳过该卡片
- 点击 MG 按钮后 video[data-mov-src] 未出现 → 超时 6s，记录失败，继续下一个
- 下载失败 → 记录到 failures.json，继续下一个
- 登录过期 → 复用 isProbablyLoggedOut 检测，暂停等待用户登录

## 输出

- `~/Desktop/hs-src/manifest.json` — 含 mg 字段标识来源
- `~/Desktop/hs-src/failures.json` — 失败记录
- MG 视频文件：`~/Desktop/hs-src/MG动画_Scene-XX_YY.mp4`

## 测试

- 单元测试：`test/mg-download.test.js` — 测试 `materialUrlKey` 去重、命名逻辑等纯函数
- 集成测试：实际运行 `npm run download -- <URL>` 验证端到端流程
