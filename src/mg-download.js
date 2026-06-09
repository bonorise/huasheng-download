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

export async function mgFilename(mgNumber) {
  return `MG动画_${pad2(mgNumber)}.mp4`;
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
        const match = el.className.match(/video-clip-(\d+)/);
        const clipId = match ? match[1] : '';
        if (!clipId || seenSet.has(clipId)) continue;
        seenSet.add(clipId);
        const rect = el.getBoundingClientRect();
        result.push({
          clipId,
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

    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      if (container) {
        container.scrollBy({ left: 400, behavior: 'instant' });
      }
    }, SCROLL_AREA_SELECTOR);
    await page.waitForTimeout(600);
  }

  cards.sort((a, b) => a.x - b.x);
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
    const cardLocator = page.locator(`[class*="video-clip-${card.clipId}"]`).first();
    await cardLocator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);

    const coverImg = cardLocator.locator(COVER_IMG_SELECTOR).first();
    await coverImg.hover({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);

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

        const videoEl = page.locator(VIDEO_MOV_SRC_SELECTOR).last();
        const movSrc = await videoEl.getAttribute('data-mov-src', { timeout: 6000 }).catch(() => '');

        if (movSrc && /^https?:\/\//.test(movSrc)) {
          const key = materialUrlKey(movSrc);
          const exists = materials.some((m) => m.key === key);
          if (!exists) {
            materials.push({
              mgNumber,
              url: movSrc,
              key,
            });
            console.log(`[MG] 捕获 MG动画 ${pad2(mgNumber)}: ${shortUrl(movSrc)}`);
          }
        } else {
          failures.push({
            mgNumber,
            clipId: card.clipId,
            reason: movSrc ? `非法的 data-mov-src: ${shortUrl(movSrc)}` : '未找到 data-mov-src',
          });
        }
      } catch (error) {
        failures.push({
          mgNumber,
          clipId: card.clipId,
          reason: error.message,
        });
        console.warn(`[MG] MG动画 ${pad2(mgNumber)} 提取失败: ${error.message}`);
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

  let manifest = { items: [] };
  let failures = [];
  try {
    const existing = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(existing);
  } catch {
    // file doesn't exist, use empty manifest
  }
  try {
    const existing = await fs.readFile(failuresPath, 'utf8');
    failures = JSON.parse(existing);
  } catch {
    // file doesn't exist
  }

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
    const filename = await mgFilename(item.mgNumber);
    const record = {
      type: 'mg',
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
      await writeJson(failuresPath, failures);
      console.warn(`[MG] 下载失败 ${filename}: ${error.message}`);
    }

    manifest.items.push(record);
    await writeJson(manifestPath, manifest);
  }

  return { downloaded, failed: extractionFailures.length + failures.filter((f) => f.type === 'mg-download').length };
}

// CLI entry
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
