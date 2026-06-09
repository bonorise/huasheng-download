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

export { materialUrlKey, pad2, writeFileExclusive };

const DEFAULT_STOP_AFTER_EMPTY_SCROLLS = 3;
const MAX_COLLECTION_DOWNLOAD_ATTEMPTS = 2;
const MATERIAL_CONTAINER_SELECTOR = '.ClipChoiceList_contentWrap__Ii6jf';
const MODAL_CLOSE_SELECTOR = 'button[aria-label="关闭"]';
const COLLECT_ICON_SELECTOR = '[class*="ClipChoiceItem_collectIconWrap__"]';
const SUPPORTED_TABS = new Set(['收藏', '推荐']);

function parseArgs(argv) {
  const args = {
    url: '',
    outDir: DEFAULT_OUT_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    count: null,
    lastUrl: '',
    limitPerScene: 0,
    dryRun: false,
    slowMo: 80,
    tab: '收藏',
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
    else if (arg === '--count') args.count = Number(argv[++i]);
    else if (arg === '--last-url') args.lastUrl = argv[++i];
    else if (arg === '--limit') args.limitPerScene = Number(argv[++i]);
    else if (arg === '--slow-mo') args.slowMo = Number(argv[++i]);
    else if (arg === '--tab') args.tab = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!args.url) {
    args.url = 'https://www.huasheng.cn/video/158889664548866';
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) args.slowMo = 80;
  if (args.count !== null && (!Number.isInteger(args.count) || args.count < 1)) {
    throw new Error('--count 必须是大于 0 的整数。');
  }
  if (args.limitPerScene && (!Number.isInteger(args.limitPerScene) || args.limitPerScene < 1)) {
    throw new Error('--limit 必须是大于 0 的整数。');
  }
  if (!SUPPORTED_TABS.has(args.tab)) {
    throw new Error('--tab 只支持 收藏 或 推荐。');
  }
  return args;
}

function printHelp() {
  console.log(`用法:
  npm run download -- <项目URL> [选项]

示例:
  npm run download -- https://www.huasheng.cn/video/158889664548866
  npm run download -- https://www.huasheng.cn/video/158889664548866 --last-url "https://www.huasheng.cn/video/158889664548866?clip=42"

选项:
  --out <目录>        输出目录，默认 ${DEFAULT_OUT_DIR}
  --profile <目录>    Playwright 登录态目录，默认 ${DEFAULT_PROFILE_DIR}
  --count <数量>      分镜总数，自动发现失败时可用
  --last-url <URL>    最后一个分镜 URL，用于推算分镜总数
  --tab <收藏|推荐>   素材来源，默认 收藏
  --limit <数量>      最多下载多少个素材；推荐模式下表示每个分镜最多数量
  --headless          无头模式。首次登录不建议使用
  --dry-run           只提取素材 URL，不下载
  --slow-mo <毫秒>    浏览器操作延迟，默认 80
`);
}

export function sceneUrl(baseUrl, sceneNumber) {
  const url = new URL(baseUrl);
  if (sceneNumber <= 1) {
    url.searchParams.delete('clip');
  } else {
    url.searchParams.set('clip', String(sceneNumber - 1));
  }
  return url.toString();
}

export function sceneNumberFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const clip = url.searchParams.get('clip');
  if (clip === null) return 1;
  const clipNumber = Number(clip);
  return Number.isInteger(clipNumber) && clipNumber >= 0 ? clipNumber + 1 : 1;
}


export function materialSourceKey(rawSource) {
  const source = String(rawSource || '')
    .trim()
    .replace(/^url\((['"]?)(.*?)\1\)$/i, '$2');
  return materialUrlKey(source);
}

export function collectionCardSignature({ src, cardText = '' }) {
  return {
    coverKey: materialSourceKey(src),
    cardText: String(cardText).replace(/\s+/g, ' ').trim(),
  };
}

export function nextCollectionMaterialNumber(fileNames) {
  let maxNumber = 0;
  for (const fileName of fileNames) {
    const match = /^素材(\d+)\.mp4$/i.exec(fileName);
    if (!match) continue;
    maxNumber = Math.max(maxNumber, Number(match[1]));
  }
  return maxNumber + 1;
}

export function assignCollectionMaterialNumbers(materials, startNumber) {
  return materials.map((material, index) => ({
    ...material,
    materialNumber: startNumber + index,
  }));
}

export function remainingCollectionLimit(limit, downloadedCount) {
  return limit ? Math.max(0, limit - downloadedCount) : 0;
}

export function successfulMaterialKeys(records) {
  return new Set(records
    .filter((record) => record.status === 'downloaded' && record.sourceKey)
    .map((record) => record.sourceKey));
}

export function collectionMaterialsForPass(materials, {
  downloadedVideoKeys,
  downloadAttempts,
  maxAttempts = MAX_COLLECTION_DOWNLOAD_ATTEMPTS,
  limit = 0,
}) {
  const retryable = materials.filter((material) => (
    !downloadedVideoKeys.has(material.key)
    && (downloadAttempts.get(material.key) || 0) < maxAttempts
  ));
  return limit ? retryable.slice(0, limit) : retryable;
}

export function shouldContinueCollectionLoop({
  successfulDownloadCount,
  uncollectedCount,
  hasRetryableVisibleMaterial,
}) {
  return successfulDownloadCount > 0
    || uncollectedCount > 0
    || hasRetryableVisibleMaterial;
}

export async function writeCollectionVideo(outDir, body, startNumber) {
  let materialNumber = startNumber;
  while (true) {
    const filename = `素材${pad2(materialNumber)}.mp4`;
    const filePath = path.join(outDir, filename);
    try {
      await writeFileExclusive(filePath, body);
      return { materialNumber, filename, filePath };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      materialNumber += 1;
    }
  }
}

export function shouldUncollectMaterial({ tab, status, dryRun, uncollectStatus }) {
  return tab === '收藏' && status === 'downloaded' && !dryRun && uncollectStatus !== 'uncollected';
}

export function collectionCleanupQueue(items, { tab, dryRun }) {
  if (tab !== '收藏' || dryRun) return [];
  return items.filter((item) => shouldUncollectMaterial({
    tab,
    status: item.status,
    dryRun,
    uncollectStatus: item.uncollectStatus,
  }));
}

async function clickFirstVisibleText(page, labels, timeout = 2500) {
  for (const label of labels) {
    const candidates = [
      page.getByText(label, { exact: true }),
      page.getByText(label),
      page.locator(`button:has-text("${label}")`),
      page.locator(`[role="button"]:has-text("${label}")`),
    ];
    for (const locator of candidates) {
      const first = locator.first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;
      const visible = await first.isVisible({ timeout: 300 }).catch(() => false);
      if (!visible) continue;
      await first.click({ timeout });
      return true;
    }
  }
  return false;
}

async function discoverScenes(page, args) {
  console.log('正在从页面发现分镜...');
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if (!args.headless && await isProbablyLoggedOut(page)) {
    await pauseForEnter('看起来当前 Playwright profile 还没有登录华声。请在打开的浏览器窗口中完成登录。');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  const discovered = await page.evaluate(() => {
    const hrefs = Array.from(document.querySelectorAll('a[href]'), (a) => a.href);
    const clips = new Set([1]);
    for (const href of hrefs) {
      try {
        const url = new URL(href);
        if (!/\/video\/\d+/.test(url.pathname)) continue;
        const clip = url.searchParams.get('clip');
        if (clip === null) {
          clips.add(1);
        } else {
          const n = Number(clip);
          if (Number.isInteger(n) && n >= 0) clips.add(n + 1);
        }
      } catch {
        // Ignore non-standard hrefs.
      }
    }

    const bodyText = document.body?.innerText || '';
    for (const match of bodyText.matchAll(/分镜\s*(\d{1,3})/g)) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n > 0) clips.add(n);
    }

    return Array.from(clips).sort((a, b) => a - b);
  });

  let count = discovered.length ? Math.max(...discovered) : 1;
  if (args.lastUrl) count = Math.max(count, sceneNumberFromUrl(args.lastUrl));
  if (args.count) count = args.count;

  if (count <= 1 && !args.count && !args.lastUrl) {
    console.warn('只发现到 1 个分镜。如果实际有更多分镜，请使用 --last-url 或 --count。');
  }

  return Array.from({ length: count }, (_, index) => index + 1);
}

async function openMaterialPanel(page) {
  await page.waitForTimeout(800);

  await clickFirstVisibleText(page, ['分镜头素材', '素材']);
  await page.waitForTimeout(500);

  const expanded = await clickFirstVisibleText(page, ['展开更多', '展开', '更多']);
  await page.waitForTimeout(900);

  return expanded;
}

async function selectMaterialTab(page, tab) {
  const selected = await clickFirstVisibleText(page, [tab]);
  await page.waitForTimeout(900);
  if (!selected) {
    throw new Error(`未找到素材 tab: ${tab}`);
  }
}

async function materialContainer(page) {
  const container = page.locator(MATERIAL_CONTAINER_SELECTOR).first();
  const visible = await container.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    throw new Error(`未找到推荐素材容器: ${MATERIAL_CONTAINER_SELECTOR}`);
  }
  return container;
}

async function markVisibleMaterialCandidates(page, seenKeys) {
  return page.evaluate(({ selector, collectIconSelector, seen }) => {
    const container = document.querySelector(selector);
    if (!container) return [];

    const seenSet = new Set(seen);
    const containerRect = container.getBoundingClientRect();
    const elements = Array.from(container.querySelectorAll('img, [style*="background-image"], video, canvas'));
    const candidates = [];

    function visibleRect(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
      if (rect.width < 48 || rect.height < 48) return null;
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) return null;
      if (rect.right <= containerRect.left || rect.left >= containerRect.right) return null;
      return rect;
    }

    function collectionCardFor(el) {
      let current = el;
      while (current && current !== container) {
        if (current.querySelector?.(collectIconSelector)) return current;
        current = current.parentElement;
      }
      return null;
    }

    for (const el of elements) {
      const rect = visibleRect(el);
      if (!rect) continue;

      const style = window.getComputedStyle(el);
      const src = el.currentSrc || el.src || style.backgroundImage || '';
      const key = `${src}|${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (seenSet.has(key)) continue;
      const id = `hs_candidate_${Date.now()}_${candidates.length}`;
      const card = collectionCardFor(el);
      el.setAttribute('data-hs-candidate-id', id);
      candidates.push({
        id,
        key,
        tag: el.tagName.toLowerCase(),
        src,
        cardText: card?.textContent || '',
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return candidates;
  }, {
    selector: MATERIAL_CONTAINER_SELECTOR,
    collectIconSelector: COLLECT_ICON_SELECTOR,
    seen: Array.from(seenKeys),
  });
}

async function visibleVideoSources(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('video[src], video source[src]'))
      .map((el) => {
        const video = el.tagName.toLowerCase() === 'source' ? el.closest('video') : el;
        const rect = video?.getBoundingClientRect();
        const src = el.src || el.currentSrc || '';
        const style = video ? window.getComputedStyle(video) : null;
        return {
          src,
          area: rect ? rect.width * rect.height : 0,
          visible: Boolean(rect && rect.width > 80 && rect.height > 80 && rect.bottom > 0 && rect.right > 0 && style?.display !== 'none' && style?.visibility !== 'hidden'),
        };
      })
      .filter((item) => item.visible && /^https?:\/\//.test(item.src) && /\.mp4(\?|$)/.test(item.src))
      .sort((a, b) => b.area - a.area)
      .map((item) => item.src);
  });
}

function waitForMp4Response(page, timeout = 6000) {
  return page.waitForResponse((response) => {
    const url = response.url();
    return /\.mp4(\?|$)/.test(url) && response.status() < 500;
  }, { timeout }).then((response) => response.url()).catch(() => '');
}

async function waitForModalVideoUrl(page, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const sources = await visibleVideoSources(page);
    const url = sources.find((src) => /\.mp4(\?|$)/.test(src));
    if (url) return url;
    await page.waitForTimeout(250);
  }
  return '';
}

async function isMaterialModalOpen(page) {
  return page.locator(MODAL_CLOSE_SELECTOR).last().isVisible({ timeout: 300 }).catch(() => false);
}

async function closeMaterialModal(page) {
  const closeButton = page.locator(MODAL_CLOSE_SELECTOR).last();
  const visible = await closeButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) {
    throw new Error(`未找到素材播放弹窗关闭按钮: ${MODAL_CLOSE_SELECTOR}`);
  }

  await closeButton.click({ timeout: 3000 });
  await page.waitForTimeout(300);

  const stillOpen = await isMaterialModalOpen(page);
  if (stillOpen) {
    throw new Error('点击关闭按钮后素材播放弹窗仍未消失');
  }
}

async function scrollMaterialList(page) {
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (!container) return { before: 0, after: 0, max: 0, missing: true };
    const before = container.scrollTop;
    const amount = Math.max(160, Math.floor(container.clientHeight * 0.75));
    container.scrollBy({ top: amount, behavior: 'instant' });
    return {
      before,
      after: container.scrollTop,
      max: container.scrollHeight - container.clientHeight,
      missing: false,
    };
  }, MATERIAL_CONTAINER_SELECTOR);
}

async function openCollectionMaterialList(page, args) {
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await openMaterialPanel(page);
  await selectMaterialTab(page, '收藏');
  await materialContainer(page);
}

async function extractSceneMaterials(page, sceneNumber, args) {
  const targetUrl = sceneUrl(args.url, sceneNumber);
  console.log(`\n[分镜 ${pad2(sceneNumber)}] 打开 ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if (!args.headless && await isProbablyLoggedOut(page)) {
    await pauseForEnter('页面需要登录。请在打开的浏览器窗口中确认登录状态。');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  const expanded = await openMaterialPanel(page);
  if (!expanded) {
    console.warn(`[分镜 ${pad2(sceneNumber)}] 没有点到“展开更多”，将尝试直接扫描当前可见素材。`);
  }
  await selectMaterialTab(page, '推荐');
  await materialContainer(page);

  return extractVisibleMaterials(page, {
    limit: args.limitPerScene,
    sceneNumber,
    logPrefix: `分镜 ${pad2(sceneNumber)}`,
    recovery: async () => {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await openMaterialPanel(page);
      await selectMaterialTab(page, '推荐');
      await materialContainer(page);
    },
  });
}

async function extractCollectionMaterials(page, args) {
  console.log(`\n[收藏] 打开 ${args.url}`);
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if (!args.headless && await isProbablyLoggedOut(page)) {
    await pauseForEnter('页面需要登录。请在打开的浏览器窗口中确认登录状态。');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  const expanded = await openMaterialPanel(page);
  if (!expanded) {
    console.warn('[收藏] 没有点到“展开更多”，将尝试直接扫描当前可见素材。');
  }
  await selectMaterialTab(page, '收藏');
  await materialContainer(page);

  return extractVisibleMaterials(page, {
    limit: 0,
    sceneNumber: null,
    logPrefix: '收藏',
    recovery: null,
    includeCollectionSignature: true,
  });
}

async function extractVisibleMaterials(page, {
  limit,
  sceneNumber,
  logPrefix,
  recovery,
  includeCollectionSignature = false,
}) {
  const materials = [];
  const extractionFailures = [];
  const seenCandidateKeys = new Set();
  const seenVideoKeys = new Set();
  let emptyScrolls = 0;

  if (includeCollectionSignature) {
    const iconCount = await countCollectIconsInContainer(page);
    if (iconCount === 0) {
      console.log(`[${logPrefix}] 收藏列表中已无星标素材，提取结束`);
      return materials;
    }
  }

  while (emptyScrolls < DEFAULT_STOP_AFTER_EMPTY_SCROLLS) {
    const candidates = await markVisibleMaterialCandidates(page, seenCandidateKeys);
    let newVideosThisPass = 0;

    for (const candidate of candidates) {
      if (limit && materials.length >= limit) break;
      seenCandidateKeys.add(candidate.key);

      const locator = page.locator(`[data-hs-candidate-id="${candidate.id}"]`).first();
      const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) continue;

      let modalOpened = false;
      let modalClosed = false;
      let failureIndex = -1;
      try {
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        const mp4FromNetwork = waitForMp4Response(page);
        await locator.click({ timeout: 3000 }).catch(async () => {
          await locator.click({ force: true, timeout: 2000 });
        });

        const domUrl = await waitForModalVideoUrl(page);
        const networkUrl = await mp4FromNetwork;
        const videoUrl = domUrl || networkUrl;
        modalOpened = await isMaterialModalOpen(page);

        const videoKey = videoUrl ? materialUrlKey(videoUrl) : '';
        if (videoUrl && !seenVideoKeys.has(videoKey)) {
          seenVideoKeys.add(videoKey);
          materials.push({
            sceneNumber,
            materialNumber: materials.length + 1,
            url: videoUrl,
            key: videoKey,
            candidate,
            collectionCard: includeCollectionSignature
              ? collectionCardSignature(candidate)
              : undefined,
          });
          newVideosThisPass += 1;
          console.log(`[${logPrefix}] 捕获素材 ${pad2(materials.length)}: ${shortUrl(videoUrl)}`);
        } else if (!videoUrl) {
          failureIndex = extractionFailures.push({
            sceneNumber,
            materialNumber: materials.length + 1,
            candidate,
            reason: '未从弹窗 DOM 或网络请求捕获到 mp4 URL',
            modalClosed: false,
          }) - 1;
        }

        if (modalOpened) {
          await closeMaterialModal(page);
          modalClosed = true;
          if (failureIndex >= 0) extractionFailures[failureIndex].modalClosed = true;
        }
      } catch (error) {
        console.warn(`[${logPrefix}] 素材候选处理失败: ${error.message}`);
        failureIndex = extractionFailures.push({
          sceneNumber,
          materialNumber: materials.length + 1,
          candidate,
          reason: error.message,
          modalClosed,
        }) - 1;
        if (modalOpened || await isMaterialModalOpen(page)) {
          try {
            await closeMaterialModal(page);
            modalClosed = true;
            extractionFailures[failureIndex].modalClosed = true;
          } catch (closeError) {
            console.warn(`[${logPrefix}] 弹窗关闭失败: ${closeError.message}`);
            extractionFailures[failureIndex].modalClosed = false;
            if (recovery) {
              extractionFailures[failureIndex].recovery = `重新加载当前素材列表: ${closeError.message}`;
              await recovery();
            } else {
              extractionFailures[failureIndex].recovery = '弹窗未能关闭，停止当前素材列表提取';
              materials.extractionFailures = extractionFailures;
              return materials;
            }
          }
        }
      }
    }

    if (limit && materials.length >= limit) break;

    const scroll = await scrollMaterialList(page);
    await page.waitForTimeout(800);
    if (newVideosThisPass === 0 && scroll.after === scroll.before) {
      emptyScrolls += 1;
    } else {
      emptyScrolls = 0;
    }
  }

  materials.extractionFailures = extractionFailures;
  return materials;
}

async function findCollectionCardOnCurrentView(page, signature) {
  return page.evaluate(({
    selector,
    collectIconSelector,
    coverKey,
    cardText,
  }) => {
    const container = document.querySelector(selector);
    if (!container) return { matchCount: 0, cardId: '' };

    function sourceKey(rawSource) {
      const source = String(rawSource || '')
        .trim()
        .replace(/^url\((['"]?)(.*?)\1\)$/i, '$2');
      try {
        const url = new URL(source);
        return `${url.origin}${url.pathname}`;
      } catch {
        return source;
      }
    }

    function normalizedText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function collectionCardFor(el) {
      let current = el;
      while (current && current !== container) {
        if (current.querySelector?.(collectIconSelector)) return current;
        current = current.parentElement;
      }
      return null;
    }

    const cards = new Set();
    const elements = container.querySelectorAll('img, [style*="background-image"], video, canvas');
    for (const el of elements) {
      const style = window.getComputedStyle(el);
      const src = el.currentSrc || el.src || style.backgroundImage || '';
      if (sourceKey(src) !== coverKey) continue;

      const card = collectionCardFor(el);
      if (!card) continue;
      cards.add(card);
    }

    let matches = Array.from(cards);
    if (matches.length > 1 && cardText) {
      matches = matches.filter((card) => normalizedText(card.textContent) === cardText);
    }
    if (matches.length !== 1) {
      return { matchCount: matches.length, cardId: '' };
    }

    const cardId = `hs_uncollect_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    matches[0].setAttribute('data-hs-collection-card-id', cardId);
    return { matchCount: 1, cardId };
  }, {
    selector: MATERIAL_CONTAINER_SELECTOR,
    collectIconSelector: COLLECT_ICON_SELECTOR,
    coverKey: signature.coverKey,
    cardText: signature.cardText,
  });
}

async function resetMaterialListScroll(page) {
  await page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (container) container.scrollTop = 0;
  }, MATERIAL_CONTAINER_SELECTOR);
  await page.waitForTimeout(300);
}

async function countCollectIconsInContainer(page) {
  return page.evaluate(({ containerSelector, iconSelector }) => {
    const container = document.querySelector(containerSelector);
    if (!container) return 0;
    return container.querySelectorAll(iconSelector).length;
  }, {
    containerSelector: MATERIAL_CONTAINER_SELECTOR,
    iconSelector: COLLECT_ICON_SELECTOR,
  });
}

async function findCollectionCard(page, signature) {
  if (!signature?.coverKey) {
    throw new Error('收藏素材缺少封面定位特征');
  }

  await resetMaterialListScroll(page);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const match = await findCollectionCardOnCurrentView(page, signature);
    if (match.matchCount > 1) {
      throw new Error('收藏卡片匹配不唯一');
    }
    if (match.matchCount === 1) {
      return page.locator(`[data-hs-collection-card-id="${match.cardId}"]`).first();
    }

    const scroll = await scrollMaterialList(page);
    if (scroll.missing || scroll.after === scroll.before) return null;
    await page.waitForTimeout(300);
  }

  throw new Error('查找收藏卡片超过最大滚动次数');
}

async function uncollectMaterial(page, item) {
  const card = await findCollectionCard(page, item.collectionCard);
  if (!card) throw new Error('未找到对应收藏卡片');

  const icon = card.locator(COLLECT_ICON_SELECTOR).first();
  const visible = await icon.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible) throw new Error('对应收藏卡片未找到星标按钮');

  try {
    await icon.click({ timeout: 3000 });
  } catch (error) {
    error.uncollectClickAttempted = true;
    throw error;
  }
  await page.waitForTimeout(500);

  const remaining = await findCollectionCard(page, item.collectionCard);
  if (remaining) {
    const error = new Error('点击星标后收藏卡片仍然存在');
    error.uncollectClickAttempted = true;
    throw error;
  }
}

async function uncollectMaterialWithRecovery(page, item, args) {
  try {
    await uncollectMaterial(page, item);
  } catch (firstError) {
    if (firstError.uncollectClickAttempted) throw firstError;
    await openCollectionMaterialList(page, args);
    try {
      await uncollectMaterial(page, item);
    } catch (secondError) {
      throw new Error(`取消收藏重试失败: ${firstError.message}; ${secondError.message}`);
    }
  }
}

async function downloadMaterial(context, item, outDir, referer) {
  const response = await context.request.get(item.url, {
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
  if (!item.sceneNumber) {
    const result = await writeCollectionVideo(outDir, body, item.materialNumber);
    return { ...result, bytes: body.byteLength };
  }

  const filename = `分镜${pad2(item.sceneNumber)}_素材${pad2(item.materialNumber)}.mp4`;
  const filePath = path.join(outDir, filename);
  await writeFileExclusive(filePath, body);
  return { materialNumber: item.materialNumber, filename, filePath, bytes: body.byteLength };
}

async function cleanupDownloadedCollections({
  page,
  args,
  manifest,
  failures,
  manifestPath,
  failuresPath,
}) {
  const queue = collectionCleanupQueue(manifest.items, {
    tab: args.tab,
    dryRun: args.dryRun,
  });
  if (!queue.length) return { attempted: 0, uncollected: 0 };

  console.log(`\n[收藏] 下载阶段已完成，开始取消 ${queue.length} 个已下载素材的收藏`);
  try {
    await openCollectionMaterialList(page, args);
  } catch (error) {
    for (const record of queue) {
      record.uncollectStatus = 'failed';
      record.uncollectError = `无法打开收藏列表: ${error.message}`;
      failures.push({
        ...record,
        failureType: 'uncollect',
        reason: record.uncollectError,
      });
    }
    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
    console.warn(`[收藏] 取消收藏阶段未启动: ${error.message}`);
    return { attempted: queue.length, uncollected: 0 };
  }

  let uncollectedCount = 0;
  for (const record of queue) {
    try {
      await uncollectMaterialWithRecovery(page, record, args);
      record.uncollectStatus = 'uncollected';
      uncollectedCount += 1;
      console.log(`[收藏] 已取消收藏 素材${pad2(record.materialNumber)}`);
    } catch (error) {
      record.uncollectStatus = 'failed';
      record.uncollectError = error.message;
      failures.push({
        ...record,
        failureType: 'uncollect',
        reason: error.message,
      });
      console.warn(`[收藏] 取消收藏失败 素材${pad2(record.materialNumber)}: ${error.message}`);
    }

    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
  }
  return { attempted: queue.length, uncollected: uncollectedCount };
}

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

  await ensureDir(args.outDir);

  const manifestPath = path.join(args.outDir, 'manifest.json');
  const failuresPath = path.join(args.outDir, 'failures.json');
  const manifest = {
    startedAt: new Date().toISOString(),
    projectUrl: args.url,
    outDir: args.outDir,
    profileDir: args.profileDir,
    tab: args.tab,
    items: [],
  };
  const failures = [];

  try {
    if (args.tab === '收藏') {
      let passCount = 0;
      const downloadedVideoKeys = new Set();
      const downloadAttempts = new Map();
      const existingFileNames = await fs.readdir(args.outDir);
      let nextMaterialNumber = nextCollectionMaterialNumber(existingFileNames);
      let downloadedCount = 0;

      console.log(`[收藏] 新素材将从 素材${pad2(nextMaterialNumber)}.mp4 开始编号`);

      while (true) {
        const remainingLimit = remainingCollectionLimit(args.limitPerScene, downloadedCount);
        if (args.limitPerScene && remainingLimit === 0) {
          console.log(`[收藏] 已达到本次运行上限 ${args.limitPerScene} 个素材`);
          break;
        }

        passCount += 1;
        console.log(`\n[收藏] === 第 ${passCount} 轮提取 ===`);

        const materials = await extractCollectionMaterials(page, args);
        const selectedMaterials = collectionMaterialsForPass(materials, {
          downloadedVideoKeys,
          downloadAttempts,
          limit: remainingLimit,
        });
        if (materials.length > selectedMaterials.length) {
          console.log(`[收藏] 跳过 ${materials.length - selectedMaterials.length} 个已完成、已耗尽重试或超出上限的素材`);
        }

        let processedRecords = [];
        let successfulDownloadCount = 0;
        if (selectedMaterials.length) {
          console.log(`[收藏] 第 ${passCount} 轮处理 ${selectedMaterials.length} 个素材`);
          for (const material of selectedMaterials) {
            downloadAttempts.set(material.key, (downloadAttempts.get(material.key) || 0) + 1);
          }

          const numberedMaterials = assignCollectionMaterialNumbers(selectedMaterials, nextMaterialNumber);
          numberedMaterials.extractionFailures = materials.extractionFailures;
          processedRecords = await processMaterials({
            materials: numberedMaterials,
            context,
            args,
            manifest,
            failures,
            manifestPath,
            failuresPath,
            referer: args.url,
            label: '收藏',
          });

          const successfulKeys = successfulMaterialKeys(processedRecords);
          for (const key of successfulKeys) downloadedVideoKeys.add(key);
          successfulDownloadCount = successfulKeys.size;
          downloadedCount += successfulDownloadCount;
          nextMaterialNumber = processedRecords.reduce(
            (next, record) => Math.max(next, (record.materialNumber || 0) + 1),
            nextMaterialNumber + numberedMaterials.length
          );
        }

        await writeJson(manifestPath, manifest);
        const cleanupResult = await cleanupDownloadedCollections({
          page,
          args,
          manifest,
          failures,
          manifestPath,
          failuresPath,
        });

        if (args.dryRun) {
          console.log('[收藏] dry-run 提取完成');
          break;
        }
        if (args.limitPerScene && downloadedCount >= args.limitPerScene) {
          console.log(`[收藏] 已达到本次运行上限 ${args.limitPerScene} 个素材`);
          break;
        }
        if (!materials.length) {
          console.log('[收藏] 收藏列表已清空，没有更多素材');
          break;
        }

        const hasRetryableVisibleMaterial = materials.some((material) => (
          !downloadedVideoKeys.has(material.key)
          && (downloadAttempts.get(material.key) || 0) < MAX_COLLECTION_DOWNLOAD_ATTEMPTS
        ));
        if (!shouldContinueCollectionLoop({
          successfulDownloadCount,
          uncollectedCount: cleanupResult.uncollected,
          hasRetryableVisibleMaterial,
        })) {
          console.log('[收藏] 当前可见素材均已处理，结束本次运行');
          break;
        }
      }
    } else {
      const scenes = await discoverScenes(page, args);
      console.log(`将处理 ${scenes.length} 个分镜: ${scenes.map((n) => pad2(n)).join(', ')}`);

      for (const sceneNumber of scenes) {
        try {
          const materials = await extractSceneMaterials(page, sceneNumber, args);
          await processMaterials({
            materials,
            context,
            args,
            manifest,
            failures,
            manifestPath,
            failuresPath,
            referer: sceneUrl(args.url, sceneNumber),
            label: `分镜 ${pad2(sceneNumber)}`,
          });
        } catch (error) {
          failures.push({ sceneNumber, reason: error.message });
          await writeJson(failuresPath, failures);
          console.warn(`[分镜 ${pad2(sceneNumber)}] 处理失败: ${error.message}`);
        }
      }
    }
  } finally {
    manifest.finishedAt = new Date().toISOString();
    manifest.summary = {
      total: manifest.items.length,
      downloaded: manifest.items.filter((item) => item.status === 'downloaded').length,
      failed: failures.length,
      dryRun: args.dryRun,
    };
    if (args.tab === '收藏') {
      manifest.summary.uncollected = manifest.items
        .filter((item) => item.uncollectStatus === 'uncollected').length;
      manifest.summary.uncollectFailed = manifest.items
        .filter((item) => item.uncollectStatus === 'failed').length;
    }
    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
    if (ownBrowser) await context.close();
  }
}

async function processMaterials({ materials, context, args, manifest, failures, manifestPath, failuresPath, referer, label }) {
  const processedRecords = [];
  if (materials.extractionFailures?.length) {
    failures.push(...materials.extractionFailures);
    await writeJson(failuresPath, failures);
  }
  if (!materials.length) {
    failures.push({ sceneNumber: null, label, reason: '未发现素材视频 URL' });
    await writeJson(failuresPath, failures);
    return processedRecords;
  }

  for (const item of materials) {
    const record = {
      sceneNumber: item.sceneNumber,
      materialNumber: item.materialNumber,
      sourceUrl: item.url,
      sourceKey: item.key || materialUrlKey(item.url),
      status: args.dryRun ? 'dry-run' : 'pending',
    };
    if (args.tab === '收藏') {
      record.collectionCard = item.collectionCard;
      record.uncollectStatus = 'skipped';
    }

    try {
      if (!args.dryRun) {
        const result = await downloadMaterial(context, item, args.outDir, referer);
        Object.assign(record, {
          materialNumber: result.materialNumber,
          status: 'downloaded',
          filename: result.filename,
          filePath: result.filePath,
          bytes: result.bytes,
        });
        console.log(`[${label}] 已下载 ${result.filename} (${result.bytes} bytes)`);
      }
    } catch (error) {
      record.status = 'failed';
      record.error = error.message;
      failures.push(record);
      console.warn(`[${label}] 下载失败 素材${pad2(item.materialNumber)}: ${error.message}`);
    }

    manifest.items.push(record);
    processedRecords.push(record);
    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
  }
  return processedRecords;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  downloadCollections(args).catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
