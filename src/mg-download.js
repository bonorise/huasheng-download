#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_OUT_DIR = path.join(os.homedir(), 'Desktop', 'hs-src');
const DEFAULT_PROFILE_DIR = path.resolve('.browser-profile');
const SCROLL_AREA_SELECTOR = '.flex.items-end.flex-1.gap-3';
const CLIP_CARD_SELECTOR = '[class*="video-clip-"]';
const COVER_IMG_SELECTOR = '.clip-card-box img';
const MG_BUTTON_SELECTOR = 'span.font-normal.text-\\[12px\\].whitespace-nowrap';
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
    startCard: 0,
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
    else if (arg === '--start-card') args.startCard = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!args.url) {
    printHelp();
    throw new Error('MG 动画下载需要提供项目 URL。');
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) args.slowMo = 80;
  if (args.limit && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error('--limit 必须是大于 0 的整数。');
  }
  if (args.startCard && (!Number.isInteger(args.startCard) || args.startCard < 1)) {
    throw new Error('--start-card 必须是大于 0 的整数。');
  }
  return args;
}

function printHelp() {
  console.log(`用法:
  npm run mg-download -- <项目URL> [选项]

示例:
  npm run mg-download -- https://www.huasheng.cn/video/158889664548866
  npm run mg-download -- https://www.huasheng.cn/video/158889664548866 --limit 5

选项:
  --out <目录>        输出目录，默认 ${DEFAULT_OUT_DIR}
  --profile <目录>    Playwright 登录态目录，默认 ${DEFAULT_PROFILE_DIR}
  --limit <数量>      最多下载多少个 MG 动画
  --start-card <编号>  从指定分镜卡片编号开始处理，跳过之前的卡片
  --headless          无头模式。首次登录不建议使用
  --dry-run           只提取 blob URL，不下载
  --slow-mo <毫秒>    浏览器操作延迟，默认 80
`);
}

export function pad2(number) {
  return String(number).padStart(2, '0');
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}${parsed.origin ? `//${parsed.host}` : ''}/.../${parsed.pathname.split('/').pop()}`;
  } catch {
    return url.slice(0, 96);
  }
}

function mgAnimationNumber(text) {
  const match = /MG动画\s*(\d+)/i.exec(text);
  return match ? Number(match[1]) : 0;
}

export function mgFilename(mgNumber) {
  return `MG动画_${pad2(mgNumber)}.webm`;
}

async function pauseForEnter(message) {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n完成后按回车继续...`);
  } finally {
    rl.close();
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(file, data) {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function isProbablyLoggedOut(page) {
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  return /登录|验证码|手机号|微信扫码|未登录/.test(text) && !/分镜|素材|推荐|MG动画/.test(text);
}

async function launchBrowser(args) {
  const context = await chromium.launchPersistentContext(args.profileDir, {
    headless: args.headless,
    slowMo: args.slowMo,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    locale: 'zh-CN',
  });
  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}

async function collectClipCards(page) {
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
        const match = String(el.className).match(/video-clip-(\d+)/);
        const clipId = match ? match[1] : '';
        if (!clipId || seenSet.has(clipId)) continue;
        seenSet.add(clipId);
        const rect = el.getBoundingClientRect();
        result.push({ clipId, x: Math.round(rect.left), y: Math.round(rect.top) });
      }
      return result;
    }, { cardSelector: CLIP_CARD_SELECTOR, seen: Array.from(seenClipIds) });

    for (const card of newCards) {
      seenClipIds.add(card.clipId);
      cards.push(card);
    }

    emptyScrolls = newCards.length === 0 ? emptyScrolls + 1 : 0;

    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      if (container) container.scrollBy({ left: 400, behavior: 'instant' });
    }, SCROLL_AREA_SELECTOR);
    await page.waitForTimeout(600);
  }

  cards.sort((a, b) => Number(a.clipId) - Number(b.clipId));
  return cards;
}

async function waitForWebmBlobVideo(page, seenBlobUrls, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const candidates = await page.evaluate(async (seen) => {
      const seenSet = new Set(seen);
      const videos = Array.from(document.querySelectorAll('video'));
      const items = [];

      function visibleScore(video, rect) {
        let score = 0;
        let el = video;
        while (el && el !== document.body) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return -1;
          if (Number(style.opacity) >= 0.5) score += 1;
          el = el.parentElement;
        }
        if (rect.width > 80 && rect.height > 80 && rect.bottom > 0 && rect.right > 0) score += 10;
        if (rect.width >= 320 && rect.height >= 180) score += 5;
        return score;
      }

      for (const video of videos) {
        const src = video.currentSrc || video.src || '';
        if (!src.startsWith('blob:') || seenSet.has(src)) continue;

        const rect = video.getBoundingClientRect();
        const score = visibleScore(video, rect);
        if (score < 0) continue;

        let mimeType = '';
        let size = 0;
        let header = '';
        try {
          // 使用 XHR 替代 fetch，绕过页面 JS 对 fetch 的拦截
          const xhrBlob = await new Promise((res, rej) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', src);
            xhr.responseType = 'blob';
            xhr.onload = () => {
              if (xhr.status === 200 || xhr.status === 0) res(xhr.response);
              else rej(new Error(`XHR failed: ${xhr.status}`));
            };
            xhr.onerror = () => rej(new Error('XHR network error'));
            xhr.send();
          });
          const blob = xhrBlob;
          const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
          mimeType = blob.type || '';
          size = blob.size;
          header = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
        } catch (error) {
          items.push({ src, error: error.message, score });
          continue;
        }

        const isWebm = /^video\/webm\b/i.test(mimeType) || header.startsWith('1a 45 df a3');
        if (!isWebm) continue;

        items.push({
          src,
          mimeType,
          size,
          header,
          score,
          area: rect.width * rect.height,
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }

      return items.sort((a, b) => (b.score - a.score) || (b.area - a.area));
    }, Array.from(seenBlobUrls));

    if (candidates.length) return candidates[0];
    await page.waitForTimeout(250);
  }
  return null;
}

async function currentBlobVideoUrls(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('video'))
      .map((video) => video.currentSrc || video.src || '')
      .filter((src) => src.startsWith('blob:'));
  });
}

async function waitForBlobVideoUrl(page, previousBlobUrls, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const blobUrl = await page.evaluate((seen) => {
      const seenSet = new Set(seen);
      const videos = Array.from(document.querySelectorAll('video'));
      const candidates = videos
        .map((video) => {
          const src = video.currentSrc || video.src || '';
          const rect = video.getBoundingClientRect();
          const style = window.getComputedStyle(video);
          return {
            src,
            area: rect.width * rect.height,
            visible: rect.width > 80 &&
              rect.height > 80 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0,
          };
        })
        .filter((item) => item.visible && item.src.startsWith('blob:') && !seenSet.has(item.src))
        .sort((a, b) => b.area - a.area);
      return candidates[0]?.src || '';
    }, Array.from(previousBlobUrls));

    if (blobUrl) return blobUrl;
    await page.waitForTimeout(250);
  }
  return '';
}

async function readBlobVideo(page, blobUrl) {
  const result = await page.evaluate(async (url) => {
    // 使用 XHR 替代 fetch，绕过页面 JS 对 fetch 的拦截
    const xhrBlob = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'blob';
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) {
          resolve({ blob: xhr.response, contentType: xhr.getResponseHeader('Content-Type') || '' });
        } else {
          reject(new Error(`XHR blob failed: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('XHR network error'));
      xhr.send();
    });

    const blob = xhrBlob.blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      let binary = '';
      for (let i = 0; i < chunk.length; i += 1) {
        binary += String.fromCharCode(chunk[i]);
      }
      chunks.push(btoa(binary));
    }

    return {
      mimeType: blob.type || xhrBlob.contentType || 'video/webm',
      size: bytes.byteLength,
      chunks,
    };
  }, blobUrl);

  return {
    body: Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk, 'base64'))),
    mimeType: result.mimeType,
    reportedBytes: result.size,
  };
}

async function captureMGBlob(page, button, seenBlobUrls) {
  const beforeClickBlobUrls = await currentBlobVideoUrls(page);
  await button.click({ timeout: 3000 });
  const candidate = await waitForWebmBlobVideo(page, seenBlobUrls);
  if (!candidate) {
    const newBlobUrl = await waitForBlobVideoUrl(page, new Set([...seenBlobUrls, ...beforeClickBlobUrls]), 1000);
    throw new Error(newBlobUrl ? '找到新的 blob video，但不是 webm MG 动画' : '未找到 webm blob video 元素');
  }
  const blobVideo = await readBlobVideo(page, candidate.src);
  return { ...blobVideo, blobUrl: candidate.src, candidate };
}

async function extractMGAnimations(page, args) {
  const materials = [];
  const failures = [];
  const seenBlobUrls = new Set();

  console.log('\n[MG] 收集分镜卡片...');
  const cards = await collectClipCards(page);
  console.log(`[MG] 发现 ${cards.length} 个分镜卡片`);

  let processedCount = 0;
  let skippedCards = 0;
  for (const card of cards) {
    if (args.startCard && Number(card.clipId) < args.startCard) {
      skippedCards += 1;
      continue;
    }
    if (args.limit && materials.length >= args.limit) break;

    const cardLocator = page.locator(`[class*="video-clip-${card.clipId}"]`).first();
    await cardLocator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);

    const coverImg = cardLocator.locator(COVER_IMG_SELECTOR).first();
    await coverImg.hover({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);

    const mgButtons = cardLocator.locator(MG_BUTTON_SELECTOR);
    const mgCount = await mgButtons.count().catch(() => 0);
    if (mgCount === 0) continue;

    processedCount += 1;

    for (let i = 0; i < mgCount; i += 1) {
      if (args.limit && materials.length >= args.limit) break;

      const button = mgButtons.nth(i);
      const buttonText = await button.textContent().catch(() => '');
      const mgNumber = mgAnimationNumber(buttonText);
      if (!mgNumber) continue;

      const filename = mgFilename(mgNumber);
      const filePath = path.join(args.outDir, filename);
      try {
        await fs.access(filePath);
        console.log(`[MG] 跳过 MG动画 ${pad2(mgNumber)} (已存在)`);
        continue;
      } catch {
        // 不存在，继续下载。
      }

      try {
        const result = await captureMGBlob(page, button, seenBlobUrls);
        seenBlobUrls.add(result.blobUrl);

        console.log(`[MG] 捕获 MG动画 ${pad2(mgNumber)}: ${shortUrl(result.blobUrl)} (${(result.body.byteLength / 1024 / 1024).toFixed(1)} MB)`);

        materials.push({
          mgNumber,
          filename,
          filePath,
          blobUrl: result.blobUrl,
          body: result.body,
          bytes: result.body.byteLength,
          mimeType: result.mimeType,
          reportedBytes: result.reportedBytes,
        });
      } catch (error) {
        failures.push({ mgNumber, clipId: card.clipId, reason: error.message });
        console.warn(`[MG] MG动画 ${pad2(mgNumber)} 提取失败: ${error.message}`);
      }
    }
  }

  if (skippedCards > 0) {
    console.log(`[MG] 已跳过 ${skippedCards} 个分镜卡片 (clipId < ${args.startCard})`);
  }
  console.log(`[MG] 已处理 ${processedCount} 个分镜，捕获 ${materials.length} 个 MG 动画`);
  return { materials, failures };
}

export async function downloadMGAnimations({ page, args }) {
  const manifestPath = path.join(args.outDir, 'manifest.json');
  const failuresPath = path.join(args.outDir, 'failures.json');

  const manifest = {
    startedAt: new Date().toISOString(),
    projectUrl: args.url,
    outDir: args.outDir,
    profileDir: args.profileDir,
    type: 'mg',
    items: [],
  };
  const failures = [];

  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if (!args.headless && await isProbablyLoggedOut(page)) {
    await pauseForEnter('页面需要登录。请在打开的浏览器窗口中确认登录状态。');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  const { materials: mgMaterials, failures: extractionFailures } = await extractMGAnimations(page, args);
  failures.push(...extractionFailures.map((failure) => ({ ...failure, type: 'mg-extraction' })));

  let downloaded = 0;
  for (const item of mgMaterials) {
    const record = {
      type: 'mg',
      mgNumber: item.mgNumber,
      sourceBlobUrl: item.blobUrl,
      status: args.dryRun ? 'dry-run' : 'pending',
      filename: item.filename,
      mimeType: item.mimeType,
      bytes: item.bytes,
      reportedBytes: item.reportedBytes,
    };

    try {
      if (!args.dryRun) {
        await fs.writeFile(item.filePath, item.body, { flag: 'wx' });
        record.status = 'downloaded';
        record.filePath = item.filePath;
        downloaded += 1;
        console.log(`[MG] 已下载 ${item.filename} (${item.bytes} bytes)`);
      }
    } catch (error) {
      record.status = 'failed';
      record.error = error.message;
      failures.push({ ...record, type: 'mg-download' });
      console.warn(`[MG] 下载失败 ${item.filename}: ${error.message}`);
    }

    manifest.items.push(record);
    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.summary = {
    total: manifest.items.length,
    downloaded,
    failed: failures.length,
    dryRun: args.dryRun,
  };
  await writeJson(manifestPath, manifest);
  await writeJson(failuresPath, failures);

  return { downloaded, failed: failures.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.outDir).then(async () => {
    const { context, page } = await launchBrowser(args);
    try {
      await downloadMGAnimations({ page, args });
    } finally {
      await context.close();
    }
  }).catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
