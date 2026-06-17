# 华声分镜素材下载器

输入华声项目 URL，默认下载“收藏”tab 里的全局收藏素材，提取素材播放弹窗中的 mp4 地址，并下载到桌面 `hs-src` 文件夹。也可以切换到“推荐”模式，按分镜下载推荐素材。

如果要下载页面中由 blob URL 加载的 MG 动画 webm，请使用独立的 MG 下载命令。

## 安装

当前机器是 Apple Silicon M1，安装依赖时固定 arm64：

```bash
npm_config_arch=arm64 npm_config_platform=darwin npm install
```

## 使用

首次运行建议使用可见浏览器。如果打开后不是已登录状态，请在浏览器里登录华声，回到终端按回车继续。登录态会保存在项目内 `.browser-profile`。

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866
```

默认会点击“收藏”tab，不按分镜循环。适合你先手动浏览素材并收藏需要下载的素材。

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

下载 MG 动画 webm：

```bash
npm run mg-download -- https://www.huasheng.cn/video/158889664548866 --count 43
```

如果自动发现分镜不完整：

```bash
npm run mg-download -- https://www.huasheng.cn/video/158889664548866 --last-url "https://www.huasheng.cn/video/158889664548866?clip=42"
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

推荐模式下命名为：

```text
分镜01_素材01.mp4
分镜01_素材02.mp4
```

MG 动画命名为：

```text
分镜01_MG.webm
分镜02_MG.webm
```

同时生成：

- `manifest.json`：所有素材的来源、输出文件和状态。
- `failures.json`：失败分镜或失败素材记录。
- `mg-manifest.json`：MG 动画下载记录。
- `mg-failures.json`：MG 动画失败记录。

## 常用选项

```text
--out <目录>        输出目录，默认 /Users/liubo/Desktop/hs-src
--profile <目录>    Playwright 登录态目录，默认 .browser-profile
--count <数量>      分镜总数
--last-url <URL>    最后一个分镜 URL，用于推算分镜总数
--tab <收藏|推荐>   素材来源，默认 收藏
--limit <数量>      最多下载多少个素材；推荐模式下表示每个分镜最多数量
--headless          无头模式，首次登录不建议使用
--dry-run           只提取素材 URL，不下载
--slow-mo <毫秒>    浏览器操作延迟，默认 80
```

MG 下载命令同样支持 `--out`、`--profile`、`--count`、`--last-url`、`--limit`、`--headless`、`--dry-run`、`--slow-mo`。
