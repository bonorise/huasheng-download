// src/mg-download.js
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_OUT_DIR,
  DEFAULT_PROFILE_DIR,
  ensureDir,
  isProbablyLoggedOut,
  launchBrowser,
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
        result.push({ clipId, x: Math.round(rect.left), y: Math.round(rect.top) });
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
      if (container) container.scrollBy({ left: 400, behavior: 'instant' });
    }, SCROLL_AREA_SELECTOR);
    await page.waitForTimeout(600);
  }

  cards.sort((a, b) => a.x - b.x);
  return cards;
}

/**
 * 在浏览器上下文中 fetch blob URL，转 base64 返回。
 * 这是获取 MG 动画数据的正确方式——直接读取 video 元素的 blob src。
 */
async function downloadBlobAsBase64(page, blobUrl) {
  return page.evaluate(async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch blob failed: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    // 分块转 base64，避免 String.fromCharCode.apply 调用栈溢出
    let binary = '';
    const CHUNK = 8192;
    for (let i = 0; i < uint8.length; i += CHUNK) {
      const chunk = uint8.subarray(i, i + CHUNK);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }, blobUrl);
}

/**
 * 点击 MG 动画按钮 → 等待 video blob 出现 → 提取 blob 数据
 * @returns {{ base64: string, blobUrl: string } | null}
 */
async function captureMGBlob(page, button, mgNumber) {
  await button.click({ timeout: 3000 });

  // 等待 video 元素 src 变为 blob: URL
  let blobUrl = '';
  try {
    blobUrl = await page.evaluate(
      () => {
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
          if (v.src && v.src.startsWith('blob:')) return v.src;
        }
        return '';
      },
      { timeout: 10000 },
    );
  } catch {
    // 超时
  }

  if (!blobUrl) throw new Error('未找到 blob video 元素');

  const base64 = await downloadBlobAsBase64(page, blobUrl);
  return { base64, blobUrl };
}

async function extractMGAnimations(page, args) {
  const materials = [];
  const failures = [];
  const seenBlobUrls = new Set(); // 去重：同一 blob URL 不重复捕获

  console.log('\n[MG] 收集分镜卡片...');
  const cards = await collectClipCards(page);
  console.log(`[MG] 发现 ${cards.length} 个分镜卡片`);

  let processedCount = 0;
  for (const card of cards) {
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

      // 跳过已存在的文件
      const filename = await mgFilename(mgNumber);
      const filePath = path.join(args.outDir, filename);
      try {
        await fs.access(filePath);
        console.log(`[MG] 跳过 MG动画 ${pad2(mgNumber)} (已存在)`);
        continue;
      } catch { /* 不存在，继续 */ }

      try {
        const result = await captureMGBlob(page, button, mgNumber);

        // 去重：同一 blob URL 说明是同一段视频
        if (seenBlobUrls.has(result.blobUrl)) {
          console.log(`[MG] 跳过 MG动画 ${pad2(mgNumber)} (blob URL 重复)`);
          continue;
        }
        seenBlobUrls.add(result.blobUrl);

        const estimatedBytes = Math.round((result.base64.length * 3) / 4);
        console.log(`[MG] 捕获 MG动画 ${pad2(mgNumber)}: ${shortUrl(result.blobUrl)} (≈${(estimatedBytes / 1024 / 1024).toFixed(1)} MB)`);

        materials.push({
          mgNumber,
          base64: result.base64,
          blobUrl: result.blobUrl,
        });
      } catch (error) {
        failures.push({ mgNumber, clipId: card.clipId, reason: error.message });
        console.warn(`[MG] MG动画 ${pad2(mgNumber)} 提取失败: ${error.message}`);
      }
    }
  }

  console.log(`[MG] 已处理 ${processedCount} 个分镜，捕获 ${materials.length} 个 MG 动画`);
  return { materials, failures };
}

export async function downloadMGAnimations({ page, context, args }) {
  const manifestPath = path.join(args.outDir, 'manifest.json');
  const failuresPath = path.join(args.outDir, 'failures.json');

  let manifest = { items: [] };
  let failures = [];
  try {
    const existing = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(existing);
  } catch { /* file doesn't exist */ }
  try {
    const existing = await fs.readFile(failuresPath, 'utf8');
    failures = JSON.parse(existing);
  } catch { /* file doesn't exist */ }

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

  // 下载阶段：base64 解码 → 写入文件
  let downloaded = 0;
  for (const item of mgMaterials) {
    const filename = await mgFilename(item.mgNumber);
    const record = {
      type: 'mg',
      mgNumber: item.mgNumber,
      sourceBlobUrl: item.blobUrl,
      status: args.dryRun ? 'dry-run' : 'pending',
      filename,
    };

    try {
      if (!args.dryRun) {
        const filePath = path.join(args.outDir, filename);
        const buffer = Buffer.from(item.base64, 'base64');
        // 使用排他写入（保持与其他下载逻辑一致）
        await fs.writeFile(filePath, buffer, { flag: 'wx' });
        record.status = 'downloaded';
        record.filePath = filePath;
        record.bytes = buffer.byteLength;
        console.log(`[MG] 已下载 ${filename} (${buffer.byteLength} bytes)`);
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
