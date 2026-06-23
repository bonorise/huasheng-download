# 华声分镜素材下载器

输入华声项目 URL，默认下载“收藏”tab 里的全局收藏素材，提取素材播放弹窗中的 mp4 地址，并下载到桌面 `hs-src` 文件夹。也可以切换到“推荐”模式，按分镜下载推荐素材。

## 安装

当前机器是 Apple Silicon M1，安装依赖时固定 arm64：

```bash
npm_config_arch=arm64 npm_config_platform=darwin npm install
```

## 使用

首次运行建议使用可见浏览器。如果打开后不是已登录状态，请在浏览器里登录华声，回到终端按回车继续。登录态会保存在项目内 `.browser-profile`。

### 根据 TXT 文案创建项目

传入 UTF-8 TXT 文件。脚本会复用 `.browser-profile` 登录态，创建项目，默认在对话输入框提交 `A` 方案，并自动提交“确认”：

```bash
npm run create -- /绝对路径/文案.txt
```

如果明确要使用 B 方案：

```bash
npm run create -- /绝对路径/文案.txt --mode B
```

可选参数：

```text
--profile <目录>    Playwright 登录态目录，默认 .browser-profile
--headless          无头模式；登录失效时无法人工恢复
--slow-mo <毫秒>    浏览器操作延迟，默认 80
--mode <A|B>        制作方案，默认 A；B 为素材混合 MG 动画
```

每一步最长等待 60 秒，目标出现后立即继续。成功后终端会输出新项目 URL；成功或失败时浏览器都会保持打开，使用 `Ctrl+C` 结束脚本。

### 下载项目素材

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866
```

默认会点击“收藏”tab，不按分镜循环。脚本会多轮提取、下载并取消成功下载素材的收藏，直到收藏列表清空或达到 `--limit`。下载失败的素材最多尝试两次；取消收藏失败的素材不会重复下载，但会在下一轮继续尝试取消收藏。

如果要按分镜下载“推荐”素材：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --tab 推荐 --count 1 --limit 10
```

如果页面内分镜发现不完整，可以提供最后一个分镜 URL：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --last-url "https://www.huasheng.cn/video/158889664548866?clip=42"
```

也可以直接提供分镜总数：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --count 43
```


## 输出

默认输出目录：

```text
/Users/liubo/Desktop/hs-src
```

文件命名：

```text
素材01.mp4
素材02.mp4
```

收藏模式会扫描输出目录中的现有文件，从最大编号的下一位继续。例如目录中已有 `素材01.mp4` 到 `素材12.mp4`，新素材从 `素材13.mp4` 开始。写入使用排他模式，即使运行期间出现同名文件也会自动使用下一编号，绝不会覆盖已有视频。

推荐模式下命名为：

```text
分镜01_素材01.mp4
分镜01_素材02.mp4
```

同时生成：

- `manifest.json`：所有素材的来源、输出文件和状态。
- `failures.json`：失败分镜或失败素材记录。

收藏模式的每条记录还包含 `uncollectStatus`：

- `uncollected`：下载成功，并已取消收藏。
- `failed`：下载成功，但取消收藏失败。
- `skipped`：下载失败或使用了 `--dry-run`，未执行取消收藏。

## 常用选项

```text
--out <目录>        输出目录，默认 /Users/liubo/Desktop/hs-src
--profile <目录>    Playwright 登录态目录，默认 .browser-profile
--count <数量>      分镜总数
--last-url <URL>    最后一个分镜 URL，用于推算分镜总数
--tab <收藏|推荐>   素材来源，默认 收藏
--limit <数量>      收藏模式表示本次运行总量；推荐模式表示每个分镜最多数量
--headless          无头模式，首次登录不建议使用
--dry-run           只提取素材 URL，不下载
--slow-mo <毫秒>    浏览器操作延迟，默认 80
```
