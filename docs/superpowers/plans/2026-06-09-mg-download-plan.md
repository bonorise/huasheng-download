# MG 动画批量下载 + 统一入口 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 huasheng-download.js 提取公共模块到 shared.js，新建 mg-download.js 实现 MG 动画批量下载，新建 index.js 作为统一入口先后调用收藏和 MG 下载。

**Architecture:** shared.js 存放浏览器启动、下载、写入、登录检测等公共工具。huasheng-download.js 和 mg-download.js 各自 import shared.js，专注于各自的提取和业务逻辑。index.js 解析全局参数，共用浏览器 context，依次调用两个模块。

**Tech Stack:** Node.js (ESM), Playwright (chromium.launchPersistentContext)

---

### Task 1: 创建 shared.js — 提取公共模块

**Files:**
- Create: `src/shared.js`
- Modify: `src/huasheng-download.js` (import from shared, delete local definitions)

从 huasheng-download.js 提取以下函数到 shared.js（保持函数签名不变，从原有代码逐行复制）：

提取清单：
- `pad2` (line 112-114, 已 export)
- `materialUrlKey` (line 116-123, 已 export)
- `writeFileExclusive` (line 189-191, 已 export)
- `shortUrl` (line 817-825, 未 export)
- `ensureDir` (line 231-233, 未 export)
- `writeJson` (line 235-237, 未 export)
- `pauseForEnter` (line 222-229, 未 export)
- `isProbablyLoggedOut` (line 239-242, 未 export)
- `DEFAULT_OUT_DIR` (line 10)
- `DEFAULT_PROFILE_DIR` (line 11)
- `launchBrowser` — 新建函数，封装 `chromium.launchPersistentContext`

- [ ] **Step 1: 写出 shared.js 完整代码**

```javascript
// src/shared.js
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const DEFAULT_OUT_DIR = path.join(os.homedir(), 'Desktop', 'hs-src');
export const DEFAULT_PROFILE_DIR = path.resolve('.browser-profile');

export function pad2(number) {
  return String(number).padStart(2, '0');
}

export function materialUrlKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

export function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').pop();
    return `${parsed.origin}/.../${file}`;
  } catch {
    return url.slice(0, 96);
  }
}

export async function writeFileExclusive(filePath, body) {
  await fs.writeFile(filePath, body, { flag: 'wx' });
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeJson(file, data) {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function pauseForEnter(message) {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n完成后按回车继续...`);
  } finally {
    rl.close();
  }
}

export async function isProbablyLoggedOut(page) {
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  return /登录|验证码|手机号|微信扫码|未登录/.test(text) && !/分镜|素材|推荐/.test(text);
}

export async function launchBrowser({ profileDir, headless, slowMo }) {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    slowMo,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    locale: 'zh-CN',
  });
  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}
```

- [ ] **Step 2: 语法检查**

```bash
node --check ./src/shared.js
```

- [ ] **Step 3: 修改 huasheng-download.js — 顶部 import 替换**

将原来的 imports (lines 1-8):
```javascript
#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
```

替换为:
```javascript
#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_OUT_DIR,
  DEFAULT_PROFILE_DIR,
  ensureDir,
  isProbablyLoggedOut,
  launchBrowser,
  materialUrlKey,
  pad2,
  pauseForEnter,
  shortUrl,
  writeFileExclusive,
  writeJson,
} from './shared.js';
```

删除以下定义（按其所在行删除）：
- `const DEFAULT_OUT_DIR = ...` (line 10)
- `const DEFAULT_PROFILE_DIR = ...` (line 11)
- `export function pad2(number) { ... }` (lines 112-114)
- `export function materialUrlKey(rawUrl) { ... }` (lines 116-123)
- `export async function writeFileExclusive(filePath, body) { ... }` (lines 189-191)
- `async function pauseForEnter(message) { ... }` (lines 222-229)
- `async function ensureDir(dir) { ... }` (lines 231-233)
- `async function writeJson(file, data) { ... }` (lines 235-237)
- `async function isProbablyLoggedOut(page) { ... }` (lines 239-242)
- `function shortUrl(url) { ... }` (lines 817-825)

- [ ] **Step 4: 修改 huasheng-download.js — parseArgs 中 URL 改为可选**

修改 `parseArgs` 函数：
```javascript
// 修改 line 56-59
// 原来：
//   if (!args.url) {
//     printHelp();
//     throw new Error('请提供华声项目 URL。');
//   }

// 改为：
  if (!args.url) {
    args.url = 'https://www.huasheng.cn/video/158889664548866';
  }
```

- [ ] **Step 5: 修改 huasheng-download.js — 添加 downloadCollections 导出函数**

将 `main` 函数重命名为 `downloadCollections`，改为接受 `{page, context}` 参数：

```javascript
// 签名：
export async function downloadCollections(args) {

// 函数体开头替换浏览器启动逻辑：
// 原来：
//   const context = await chromium.launchPersistentContext(args.profileDir, {
//     headless: args.headless,
//     slowMo: args.slowMo,
//     viewport: { width: 1440, height: 1000 },
//     acceptDownloads: true,
//     locale: 'zh-CN',
//   });
//   const page = context.pages()[0] || await context.newPage();
// 改为：
//   const { context, page } = await launchBrowser(args);
```

`downloadCollections` 内部自己调用 `launchBrowser(args)` 启动浏览器，结束前 `context.close()`。这样 index.js 调用它时只需传 args，由它自己管理浏览器生命周期。但为了让 index.js 共享 context，增加可选参数：

```javascript
// 实际签名改为：
export async function downloadCollections(args, { page: existingPage, context: existingContext } = {}) {
  let context, page;
  let ownBrowser = false;
  if (existingContext) {
    context = existingContext;
    page = existingPage;
  } else {
    const launched = await launchBrowser(args);
    context = launched.context;
    page = launched.page;
    ownBrowser = true;
  }
  // ... 原有 main() 逻辑 ...

  // finally 块中：只有自己启动的才关闭
  // if (ownBrowser) await context.close();
  // (不输出 "完成" 汇总行，由 index.js 统一输出)
}
```

同时移除 `import { chromium } from 'playwright'` 的残留引用（已由 shared.js 处理）。

- [ ] **Step 6: 修改 huasheng-download.js — 更新 CLI 入口**

文件末尾替换为（`downloadCollections` 接受 args 对象，内部不再 parseArgs）：

```javascript
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  downloadCollections(args).catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 7: 语法检查**

```bash
node --check ./src/huasheng-download.js
```

- [ ] **Step 8: 运行已有测试确保重构不破坏功能**

```bash
npm test
```

预期：17 tests, 17 pass

- [ ] **Step 9: Commit**

```bash
git add src/shared.js src/huasheng-download.js
git commit -m "refactor: extract shared.js, make collection URL optional, export downloadCollections"
```

---

### Task 2: 创建 mg-download.js — MG 动画下载模块

**Files:**
- Create: `src/mg-download.js`

- [ ] **Step 1: 写出 mg-download.js 完整代码**

```javascript
// src/mg-download.js
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_OUT_DIR,
  DEFAULT_PROFILE_DIR,
  ensureDir,
  isProbablyLoggedOut,
  launchBrowser,
  materialUrlKey,
  pad2,
  pauseForEnter,
  shortUrl,
  writeFileExclusive,
  writeJson,
} from './shared.js';

const SCROLL_AREA_SELECTOR = '.flex.items-end.flex-1.gap-3';
const CLIP_CARD_SELECTOR = '[class*="video-clip-"]';
const COVER_IMG_SELECTOR = '.clip-card-box img';
const MG_BUTTON_SELECTOR = 'span.font-normal.text-\\[12px\\].whitespace-nowrap';
const VIDEO_MOV_SRC_SELECTOR = 'video[data-mov-src]';
const DEFAULT_STOP_AFTER_EMPTY_SCROLLS = 3;

function parseArgs(argv) {
  const args = {
    url: '',
    outDir: DEFAULT_OUT_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    dryRun: false,
    slowMo: 80,
    limit: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !args.url) {
      args.url = arg;
      continue;
    }
    if (arg === '--headless') args.headless = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--out') args.outDir = path.resolve(argv[++i]);
    else if (arg === '--profile') args.profileDir = path.resolve(argv[++i]);
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg === '--slow-mo') args.slowMo = Number(argv[++i]);
    else throw new Error(`未知参数: ${arg}`);
  }

  if (!args.url) {
    throw new Error('MG 动画下载需要提供项目 URL。');
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) args.slowMo = 80;
  if (args.limit && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error('--limit 必须是大于 0 的整数。');
  }
  return args;
}

function mgAnimationNumber(text) {
  const match = /MG动画\s*(\d+)/i.exec(text);
  return match ? Number(match[1]) : 0;
}

function sceneNumberFromCard(cardElement) {
  // cardElement 内的 "分镜XX" 文字
  const text = cardElement.textContent || '';
  const match = /分镜\s*(\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
}

export async function mgFilename(sceneNumber, mgNumber) {
  return `MG动画_Scene-${pad2(sceneNumber)}_${pad2(mgNumber)}.mp4`;
}

async function collectClipCards(page) {
  // 先定位分镜滚动区
  const scrollArea = page.locator(SCROLL_AREA_SELECTOR).first();
  await scrollArea.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  const seenClipIds = new Set();
  const cards = [];
  let emptyScrolls = 0;

  while (emptyScrolls < DEFAULT_STOP_AFTER_EMPTY_SCROLLS) {
    const newCards = await page.evaluate(({ cardSelector, seen }) => {
      const seenSet = new Set(seen);
      const elements = Array.from(document.querySelectorAll(cardSelector));
      const result = [];
      for (const el of elements) {
        // 从 class 中提取 video-clip-NNN 作为标识
        const match = el.className.match(/video-clip-(\d+)/);
        const clipId = match ? match[1] : '';
        if (!clipId || seenSet.has(clipId)) continue;
        seenSet.add(clipId);
        const rect = el.getBoundingClientRect();
        const text = el.textContent || '';
        const sceneMatch = text.match(/分镜\s*(\d+)/);
        result.push({
          clipId,
          sceneNumber: sceneMatch ? Number(sceneMatch[1]) : 0,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        });
      }
      return result;
    }, { cardSelector: CLIP_CARD_SELECTOR, seen: Array.from(seenClipIds) });

    for (const card of newCards) {
      seenClipIds.add(card.clipId);
      cards.push(card);
    }

    if (newCards.length === 0) {
      emptyScrolls += 1;
    } else {
      emptyScrolls = 0;
    }

    // 横向滚动到底部右侧
    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      if (container) {
        container.scrollBy({ left: 400, behavior: 'instant' });
      }
    }, SCROLL_AREA_SELECTOR);
    await page.waitForTimeout(600);
  }

  cards.sort((a, b) => a.sceneNumber - b.sceneNumber || a.x - b.x);
  return cards;
}

async function extractMGAnimations(page, args) {
  const materials = [];
  const failures = [];

  console.log('\n[MG] 收集分镜卡片...');
  const cards = await collectClipCards(page);
  console.log(`[MG] 发现 ${cards.length} 个分镜卡片`);

  let processedCount = 0;
  for (const card of cards) {
    if (!card.sceneNumber) {
      console.warn(`[MG] 卡片 ${card.clipId} 无法解析分镜序号，跳过`);
      continue;
    }

    // 滚动卡片到可见区域
    const cardLocator = page.locator(`[class*="video-clip-${card.clipId}"]`).first();
    await cardLocator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);

    // hover 封面图以显示 MG 按钮
    const coverImg = cardLocator.locator(COVER_IMG_SELECTOR).first();
    await coverImg.hover({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);

    // 查找 MG 动画按钮
    const mgButtons = cardLocator.locator(MG_BUTTON_SELECTOR);
    const mgCount = await mgButtons.count().catch(() => 0);
    if (mgCount === 0) continue;

    for (let i = 0; i < mgCount; i += 1) {
      if (args.limit && materials.length >= args.limit) break;

      const button = mgButtons.nth(i);
      const buttonText = await button.textContent().catch(() => '');
      const mgNumber = mgAnimationNumber(buttonText);
      if (!mgNumber) continue;

      try {
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(800);

        // 等待 video[data-mov-src] 出现在页面任意位置
        const videoEl = page.locator(VIDEO_MOV_SRC_SELECTOR).last();
        const movSrc = await videoEl.getAttribute('data-mov-src', { timeout: 6000 }).catch(() => '');

        if (movSrc && /^https?:\/\//.test(movSrc)) {
          const key = materialUrlKey(movSrc);
          const exists = materials.some((m) => m.key === key);
          if (!exists) {
            materials.push({
              sceneNumber: card.sceneNumber,
              mgNumber,
              url: movSrc,
              key,
            });
            console.log(`[MG] 捕获 Scene-${pad2(card.sceneNumber)} MG动画 ${pad2(mgNumber)}: ${shortUrl(movSrc)}`);
          }
        } else {
          failures.push({
            sceneNumber: card.sceneNumber,
            mgNumber,
            clipId: card.clipId,
            reason: movSrc ? `非法的 data-mov-src: ${shortUrl(movSrc)}` : '未找到 data-mov-src',
          });
        }
      } catch (error) {
        failures.push({
          sceneNumber: card.sceneNumber,
          mgNumber,
          clipId: card.clipId,
          reason: error.message,
        });
        console.warn(`[MG] Scene-${pad2(card.sceneNumber)} MG动画 ${pad2(mgNumber)} 提取失败: ${error.message}`);
      }
    }

    processedCount += 1;
    if (args.limit && materials.length >= args.limit) break;
  }

  console.log(`[MG] 已处理 ${processedCount} 个分镜，捕获 ${materials.length} 个 MG 动画`);
  return { materials, failures };
}

async function downloadMGVideo(context, url, outDir, filename, referer) {
  const response = await context.request.get(url, {
    timeout: 120000,
    headers: {
      referer,
      'user-agent': 'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36',
    },
  });

  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()} ${response.statusText()}`);
  }
  const body = await response.body();
  const filePath = path.join(outDir, filename);
  await writeFileExclusive(filePath, body);
  return { filename, filePath, bytes: body.byteLength };
}

export async function downloadMGAnimations({ page, context, args }) {
  const manifestPath = path.join(args.outDir, 'manifest.json');
  const failuresPath = path.join(args.outDir, 'failures.json');

  // 读取已有 manifest 用于追加
  let manifest = { items: [] };
  let failures = [];
  try {
    const existing = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(existing);
  } catch {
    // 文件不存在，使用空 manifest
  }
  try {
    const existing = await fs.readFile(failuresPath, 'utf8');
    failures = JSON.parse(existing);
  } catch {
    // 文件不存在
  }

  // 嵌套在 page 上操作
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if (!args.headless && await isProbablyLoggedOut(page)) {
    await pauseForEnter('页面需要登录。请在打开的浏览器窗口中确认登录状态。');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  const { materials: mgMaterials, failures: extractionFailures } = await extractMGAnimations(page, args);

  if (extractionFailures.length) {
    failures.push(...extractionFailures.map((f) => ({ ...f, type: 'mg-extraction' })));
    await writeJson(failuresPath, failures);
  }

  if (!mgMaterials.length) {
    console.log('[MG] 未发现 MG 动画素材');
    return { downloaded: 0, failed: extractionFailures.length };
  }

  let downloaded = 0;
  for (const item of mgMaterials) {
    const filename = `MG动画_Scene-${pad2(item.sceneNumber)}_${pad2(item.mgNumber)}.mp4`;
    const record = {
      type: 'mg',
      sceneNumber: item.sceneNumber,
      mgNumber: item.mgNumber,
      sourceUrl: item.url,
      sourceKey: item.key,
      status: args.dryRun ? 'dry-run' : 'pending',
      filename,
    };

    try {
      if (!args.dryRun) {
        const result = await downloadMGVideo(context, item.url, args.outDir, filename, args.url);
        Object.assign(record, {
          status: 'downloaded',
          filePath: result.filePath,
          bytes: result.bytes,
        });
        console.log(`[MG] 已下载 ${result.filename} (${result.bytes} bytes)`);
        downloaded += 1;
      }
    } catch (error) {
      record.status = 'failed';
      record.error = error.message;
      failures.push({ ...record, type: 'mg-download' });
      console.warn(`[MG] 下载失败 ${filename}: ${error.message}`);
    }

    manifest.items.push(record);
    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
  }

  return { downloaded, failed: extractionFailures.length + failures.filter((f) => f.type === 'mg-download').length };
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.outDir).then(async () => {
    const { context, page } = await launchBrowser(args);
    try {
      await downloadMGAnimations({ page, context, args });
    } finally {
      await context.close();
    }
  }).catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: 语法检查**

```bash
node --check ./src/mg-download.js
```

- [ ] **Step 3: Commit**

```bash
git add src/mg-download.js
git commit -m "feat: add MG animation download module"
```

---

### Task 3: 创建 index.js — 统一入口

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: 写出 index.js 完整代码**

```javascript
#!/usr/bin/env node
// src/index.js — 统一入口，先后调用收藏下载和 MG 动画下载
import path from 'node:path';
import { downloadCollections } from './huasheng-download.js';
import { downloadMGAnimations } from './mg-download.js';
import {
  DEFAULT_OUT_DIR,
  DEFAULT_PROFILE_DIR,
  ensureDir,
  launchBrowser,
  writeJson,
} from './shared.js';

const COLLECTION_URL = 'https://www.huasheng.cn/video/158889664548866';

function parseArgs(argv) {
  const args = {
    url: '',
    outDir: DEFAULT_OUT_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    slowMo: 80,
    mgOnly: false,
    // 收藏模式专用参数
    count: null,
    lastUrl: '',
    limitPerScene: 0,
    dryRun: false,
    tab: '收藏',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mg-only') args.mgOnly = true;
    else if (!arg.startsWith('--') && !args.url) args.url = arg;
    else if (arg === '--headless') args.headless = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--out') args.outDir = path.resolve(argv[++i]);
    else if (arg === '--profile') args.profileDir = path.resolve(argv[++i]);
    else if (arg === '--slow-mo') args.slowMo = Number(argv[++i]);
    else if (arg === '--count') args.count = Number(argv[++i]);
    else if (arg === '--last-url') args.lastUrl = argv[++i];
    else if (arg === '--limit') args.limitPerScene = Number(argv[++i]);
    else if (arg === '--tab') args.tab = argv[++i];
    else throw new Error(`未知参数: ${arg}`);
  }

  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) args.slowMo = 80;
  return args;
}

async function main() {
  const rawArgs = parseArgs(process.argv.slice(2));

  await ensureDir(rawArgs.outDir);

  const { context, page } = await launchBrowser({
    profileDir: rawArgs.profileDir,
    headless: rawArgs.headless,
    slowMo: rawArgs.slowMo,
  });

  const collectionResults = { downloaded: 0, total: 0 };
  const mgResults = { downloaded: 0, total: 0 };

  try {
    if (!rawArgs.mgOnly) {
      // 阶段 1: 收藏下载（使用固定 URL）
      console.log('========================================');
      console.log('  阶段 1: 收藏视频下载');
      console.log('========================================');

      const collectionArgs = {
        url: COLLECTION_URL,
        outDir: rawArgs.outDir,
        profileDir: rawArgs.profileDir,
        headless: rawArgs.headless,
        slowMo: rawArgs.slowMo,
        count: rawArgs.count,
        lastUrl: rawArgs.lastUrl,
        limitPerScene: rawArgs.limitPerScene,
        dryRun: rawArgs.dryRun,
        tab: rawArgs.tab,
      };

      const manifestPath = path.join(rawArgs.outDir, 'manifest.json');
      const manifest = {
        startedAt: new Date().toISOString(),
        projectUrl: COLLECTION_URL,
        outDir: rawArgs.outDir,
        profileDir: rawArgs.profileDir,
        tab: collectionArgs.tab,
        items: [],
      };
      await writeJson(manifestPath, manifest);

      await downloadCollections(collectionArgs, { page, context });
    }

    if (rawArgs.url) {
      // 阶段 2: MG 动画下载（使用传入的 URL）
      console.log('\n========================================');
      console.log('  阶段 2: MG 动画下载');
      console.log('========================================');

      const mgArgs = {
        url: rawArgs.url,
        outDir: rawArgs.outDir,
        profileDir: rawArgs.profileDir,
        headless: rawArgs.headless,
        slowMo: rawArgs.slowMo,
        dryRun: rawArgs.dryRun,
        limit: rawArgs.limitPerScene,
      };

      await downloadMGAnimations({ page, context, args: mgArgs });
    }
  } finally {
    await context.close();
    console.log('\n========================================');
    console.log('  全部完成');
    console.log(`  输出目录: ${rawArgs.outDir}`);
    console.log('========================================');
  }
}

main().catch((error) => {
  console.error(`\n错误: ${error.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: 语法检查**

```bash
node --check ./src/index.js
```

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: add unified entry point for collection and MG downloads"
```

---

### Task 4: 更新 package.json — 入口和脚本

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 修改 package.json**

将 `package.json` 中的 `bin` 和 `main` 指向新的统一入口：

```json
{
  "name": "huasheng-download",
  "version": "1.0.0",
  "description": "Download storyboard video and MG animation assets from huasheng.cn projects.",
  "type": "module",
  "bin": {
    "huasheng-download": "./src/index.js"
  },
  "main": "src/index.js",
  "scripts": {
    "download": "node ./src/index.js",
    "check": "node --check ./src/index.js && node --check ./src/shared.js && node --check ./src/huasheng-download.js && node --check ./src/mg-download.js",
    "test": "node --test"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "playwright": "^1.58.2"
  }
}
```

- [ ] **Step 2: 验证 check 脚本**

```bash
npm run check
```

预期：无错误输出（退出码 0）

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update entry point to index.js, add check for all modules"
```

---

### Task 5: 添加 mg-download 单元测试

**Files:**
- Create: `test/mg-download.test.js`

- [ ] **Step 1: 写出测试文件**

```javascript
// test/mg-download.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { materialUrlKey, pad2 } from '../src/shared.js';
import { mgFilename } from '../src/mg-download.js';

test('mgFilename produces correct naming pattern', async () => {
  assert.equal(await mgFilename(3, 1), 'MG动画_Scene-03_01.mp4');
  assert.equal(await mgFilename(11, 5), 'MG动画_Scene-11_05.mp4');
  assert.equal(await mgFilename(100, 12), 'MG动画_Scene-100_12.mp4');
});

test('materialUrlKey dedupes MG video URLs across signed params', () => {
  const url1 = 'https://jssz-boss.hdslb.com/aippt-recorder-oss/capture/prod/f3630c5e/output.mp4?token=abc';
  const url2 = 'https://jssz-boss.hdslb.com/aippt-recorder-oss/capture/prod/f3630c5e/output.mp4?token=xyz';
  assert.equal(materialUrlKey(url1), materialUrlKey(url2));
});

test('pad2 still works after refactoring', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(42), '42');
});
```

- [ ] **Step 2: 运行全部测试**

```bash
npm test
```

预期：约 20 tests, all pass

- [ ] **Step 3: Commit**

```bash
git add test/mg-download.test.js
git commit -m "test: add MG download unit tests"
```

---

### Task 6: 集成验证

- [ ] **Step 1: 语法检查全部文件**

```bash
npm run check
```

- [ ] **Step 2: 运行全部测试**

```bash
npm test
```

- [ ] **Step 3: 运行 dry-run 验证收藏模式（不改远端状态）**

```bash
npm run download -- --dry-run
```

预期：收藏列表提取输出（不实际下载），无报错退出。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final integration check"
```
