# 华声分镜素材下载器

输入华声项目 URL，批量打开每个分镜的“推荐”素材，提取素材播放弹窗中的 mp4 地址，并下载到桌面 `hs-src` 文件夹。

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
分镜01_素材01.mp4
分镜01_素材02.mp4
分镜02_素材01.mp4
```

同时生成：

- `manifest.json`：所有素材的来源、输出文件和状态。
- `failures.json`：失败分镜或失败素材记录。

## 常用选项

```text
--out <目录>        输出目录，默认 /Users/liubo/Desktop/hs-src
--profile <目录>    Playwright 登录态目录，默认 .browser-profile
--count <数量>      分镜总数
--last-url <URL>    最后一个分镜 URL，用于推算分镜总数
--limit <数量>      每个分镜最多下载多少个素材
--headless          无头模式，首次登录不建议使用
--dry-run           只提取素材 URL，不下载
--slow-mo <毫秒>    浏览器操作延迟，默认 80
```
