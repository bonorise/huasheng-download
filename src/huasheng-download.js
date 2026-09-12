#!/usr/bin/env node

import fs from 'node:fs/promises';
import { downloadStoryboards } from './storyboard-download.js';
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
const COLLECTION_LEDGER_FILE = 'collection-ledger.json';
const COLLECTION_API_PAGE_SIZE = 200;
const COLLECTION_UNCOLLECT_CONCURRENCY = 6;
const COLLECTION_UNCOLLECT_MAX_ATTEMPTS = 3;
const COLLECTION_UNCOLLECT_MAX_PASSES = 3;
const MATERIAL_CONTAINER_SELECTOR = '.ClipChoiceList_contentWrap__Ii6jf';
const MODAL_CLOSE_SELECTOR = 'button[aria-label="关闭"]';
const COLLECT_ICON_SELECTOR = '[class*="ClipChoiceItem_collectIconWrap__"]';
const SUPPORTED_TABS = new Set(['收藏', '推荐']);

export function parseArgs(argv) {
  const args = {
    url: '',
    outDir: DEFAULT_OUT_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    count: null,
    lastUrl: '',
    limitPerScene: 0,
    dryRun: false,
    uncollectOnly: false,
    noUncollect: false,
    slowMo: 80,
    tab: '收藏',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !args.url) {
      args.url = arg;
      continue;
    }
    if (arg === '--storyboard') args.storyboard = true;
    else if (arg === '--headless') args.headless = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--uncollect-only') args.uncollectOnly = true;
    else if (arg === '--no-uncollect') args.noUncollect = true;
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

  if (args.storyboard) {
    if (!args.url || !/^https:\/\/www\.huasheng\.cn\/video\/\d+(?:[?#].*)?$/.test(args.url)) throw new Error('--storyboard 必须提供华声项目 URL');
    if (args.uncollectOnly || args.noUncollect || args.count || args.lastUrl || args.limitPerScene || argv.includes('--tab')) throw new Error('--storyboard 不可与收藏、推荐、数量限制参数混用');
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
  if (args.uncollectOnly) args.tab = '收藏';
  return args;
}

function printHelp() {
  console.log(`用法:
  npm run download -- <项目URL> [选项]

示例:
  npm run download -- https://www.huasheng.cn/video/158889664548866
  npm run download -- https://www.huasheng.cn/video/158889664548866 --last-url "https://www.huasheng.cn/video/158889664548866?clip=42"

选项:
  --storyboard        按时间轴顺序下载当前分镜视频，命名为分镜01.mp4等
  --out <目录>        输出目录，默认 ${DEFAULT_OUT_DIR}
  --profile <目录>    Playwright 登录态目录，默认 ${DEFAULT_PROFILE_DIR}
  --count <数量>      分镜总数，自动发现失败时可用
  --last-url <URL>    最后一个分镜 URL，用于推算分镜总数
  --tab <收藏|推荐>   素材来源，默认 收藏
  --limit <数量>      最多下载多少个素材；推荐模式下表示每个分镜最多数量
  --uncollect-only    通过接口清空收藏页，不下载素材
  --no-uncollect      只下载素材，不取消收藏（下载全部完成后可单独 --uncollect-only 统一取消收藏）
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

export function materialCandidateKey({ src, cardText }) {
  return `${materialSourceKey(src)}|${String(cardText || '').replace(/\s+/g, ' ').trim()}`;
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
  successfulDownloadCount: _successfulDownloadCount,
  hasRetryableVisibleMaterial: _hasRetryableVisibleMaterial,
}) {
  return false;
}

export function shouldCleanupCollections({
  tab,
  dryRun,
  noUncollect,
  downloadPhaseComplete,
}) {
  return tab === '收藏'
    && !dryRun
    && !noUncollect
    && downloadPhaseComplete;
}

export function selectScrollableTarget(targets) {
  return targets.find((target) => target.scrollHeight > target.clientHeight)?.id
    || targets[0]?.id
    || '';
}

export function shouldCountEmptyMaterialScroll({ newVideosThisPass, before, after, max }) {
  return newVideosThisPass === 0
    && after === before
    && after >= Math.max(0, max);
}

export function collectionApiPageCount(total, pageSize = COLLECTION_API_PAGE_SIZE) {
  return Math.ceil(Math.max(0, Number(total) || 0) / pageSize);
}

export function collectionApiVideosToMaterials(videos) {
  return (Array.isArray(videos) ? videos : [])
    .filter((video) => /^https?:\/\//.test(String(video?.url || '')) && /\.mp4(\?|$)/.test(video.url))
    .map((video) => ({
      sceneNumber: null,
      url: video.url,
      key: materialUrlKey(video.url),
      candidate: {
        id: String(video.id || ''),
        src: video.cover || '',
        cardText: '',
      },
      collectionCard: collectionCardSignature({
        src: video.cover || '',
        cardText: '',
      }),
    }));
}

export function favoriteMutationUrl(favoriteListUrl, csrfToken) {
  const listUrl = new URL(favoriteListUrl);
  const mutationUrl = new URL('/api/innovideo/clip/video/fav', listUrl.origin);
  for (const [key, value] of listUrl.searchParams) {
    if (key.startsWith('_')) mutationUrl.searchParams.set(key, value);
  }
  mutationUrl.searchParams.set('csrf', csrfToken);
  return mutationUrl.toString();
}

export function favoriteUncollectPayload(videoId) {
  return {
    clip_uuid: String(videoId || ''),
    fav: 0,
    is_revoke: false,
  };
}

export function markCollectionLedgerUncollected(ledger, sourceKeys = null) {
  const allowedKeys = sourceKeys ? new Set(sourceKeys) : null;
  let changed = 0;
  for (const item of ledger.items || []) {
    if (item.status !== 'downloaded') continue;
    if (allowedKeys && !allowedKeys.has(item.sourceKey)) continue;
    if (item.uncollectStatus !== 'uncollected' || item.uncollectError) changed += 1;
    item.uncollectStatus = 'uncollected';
    delete item.uncollectError;
  }
  return changed;
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

export function collectionCleanupScope(ledgerItems, scannedMaterials) {
  const scannedKeys = new Set(scannedMaterials.map((material) => material.key));
  return ledgerItems.filter((item) => scannedKeys.has(item.sourceKey));
}

export function mergeCollectionLedgerItems(existingItems, updatedItems) {
  const indexBySourceKey = new Map();
  const merged = [];

  for (const item of [...existingItems, ...updatedItems]) {
    if (!item?.sourceKey) continue;
    const index = indexBySourceKey.get(item.sourceKey);
    if (index === undefined) {
      indexBySourceKey.set(item.sourceKey, merged.length);
      merged.push(item);
    } else {
      merged[index] = item;
    }
  }

  return merged;
}

async function loadCollectionLedger(ledgerPath) {
  try {
    const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    if (Array.isArray(ledger.items)) return ledger;
    throw new Error('items 不是数组');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { version: 1, items: [] };
    }
    throw new Error(`读取收藏永久台账失败: ${error.message}`);
  }
}

async function saveCollectionLedger(ledgerPath, ledger) {
  ledger.version = 1;
  ledger.updatedAt = new Date().toISOString();
  await writeJson(ledgerPath, ledger);
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
      const card = collectionCardFor(el);
      const normalizedSource = String(src || '')
        .trim()
        .replace(/^url\((['"]?)(.*?)\1\)$/i, '$2')
        .split('?')[0];
      const cardText = (card?.textContent || '').replace(/\s+/g, ' ').trim();
      const key = `${normalizedSource}|${cardText}`;
      if (seenSet.has(key)) continue;
      seenSet.add(key);
      const id = `hs_candidate_${Date.now()}_${candidates.length}`;
      el.setAttribute('data-hs-candidate-id', id);
      candidates.push({
        id,
        key,
        tag: el.tagName.toLowerCase(),
        src,
        cardText,
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

async function scrollMaterialList(page, { reset = false } = {}) {
  const scroll = await page.evaluate(({ selector, collectIconSelector, resetToTop }) => {
    const materialContainer = document.querySelector(selector);
    if (!materialContainer) return { before: 0, after: 0, max: 0, missing: true };

    const targets = [];
    const addTarget = (element) => {
      if (element && !targets.includes(element)) targets.push(element);
    };
    for (const element of document.querySelectorAll('[class*="InfiniteList_scrollRef__"]')) {
      if (element.querySelector(collectIconSelector)) addTarget(element);
    }
    let current = materialContainer;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      addTarget(current);
    }

    const target = targets.find((element) => element.scrollHeight > element.clientHeight)
      || targets[0];
    if (!target) return { before: 0, after: 0, max: 0, missing: true };

    const before = target.scrollTop;
    const amount = Math.max(160, Math.floor(target.clientHeight * 0.75));
    if (resetToTop) {
      target.scrollTop = 0;
    } else {
      target.scrollBy({ top: amount, behavior: 'instant' });
      target.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    const rect = target.getBoundingClientRect();
    return {
      before,
      after: target.scrollTop,
      max: target.scrollHeight - target.clientHeight,
      amount,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      missing: false,
    };
  }, {
    selector: MATERIAL_CONTAINER_SELECTOR,
    collectIconSelector: COLLECT_ICON_SELECTOR,
    resetToTop: reset,
  });

  if (!reset && !scroll.missing && scroll.after === scroll.before && scroll.max > 0) {
    await page.mouse.move(scroll.x, scroll.y);
    await page.mouse.wheel(0, scroll.amount);
    await page.waitForTimeout(100);
    return page.evaluate(({ selector, collectIconSelector, before }) => {
      const materialContainer = document.querySelector(selector);
      const target = Array.from(document.querySelectorAll('[class*="InfiniteList_scrollRef__"]'))
        .find((element) => element.querySelector(collectIconSelector) && element.scrollHeight > element.clientHeight)
        || materialContainer;
      return {
        before,
        after: target?.scrollTop || 0,
        max: target ? target.scrollHeight - target.clientHeight : 0,
        missing: !target,
      };
    }, { selector: MATERIAL_CONTAINER_SELECTOR, collectIconSelector: COLLECT_ICON_SELECTOR, before: scroll.before });
  }

  if (!reset && !scroll.missing) {
    // 虚拟列表在 scroll 事件后异步追加卡片；等其稳定后再读取位置/高度，
    // 避免把“正在加载下一批”误判为已滚动到底。
    await page.waitForTimeout(900);
    return page.evaluate(({ selector, collectIconSelector, before }) => {
      const materialContainer = document.querySelector(selector);
      const target = Array.from(document.querySelectorAll('[class*="InfiniteList_scrollRef__"]'))
        .find((element) => element.querySelector(collectIconSelector))
        || materialContainer;
      return {
        before,
        after: target?.scrollTop || 0,
        max: target ? target.scrollHeight - target.clientHeight : 0,
        missing: !target,
      };
    }, { selector: MATERIAL_CONTAINER_SELECTOR, collectIconSelector: COLLECT_ICON_SELECTOR, before: scroll.before });
  }

  return scroll;
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

async function captureCollectionFavoriteListUrl(page, args) {
  console.log(`\n[收藏] 打开 ${args.url}`);
  let favoriteListUrl = '';
  const observeFavoriteResponse = (response) => {
    if (response.url().includes('/api/innovideo/clip/video/favorite?')) {
      favoriteListUrl = response.url();
    }
  };
  page.on('response', observeFavoriteResponse);

  try {
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

    const deadline = Date.now() + 10000;
    while (!favoriteListUrl && Date.now() < deadline) {
      await page.waitForTimeout(100);
    }
    if (!favoriteListUrl) {
      favoriteListUrl = await page.evaluate(() => {
        const entries = performance.getEntriesByType('resource');
        return entries
          .map((entry) => entry.name)
          .reverse()
          .find((url) => url.includes('/api/innovideo/clip/video/favorite?')) || '';
      });
    }
  } finally {
    page.off('response', observeFavoriteResponse);
  }

  if (!favoriteListUrl) {
    throw new Error('未捕获收藏列表接口，无法执行无点击批量提取');
  }
  return favoriteListUrl;
}

async function fetchCollectionFavoriteSnapshot(context, initialUrl, referer) {
  const requestUrl = new URL(initialUrl);
  requestUrl.searchParams.set('ps', String(COLLECTION_API_PAGE_SIZE));
  requestUrl.searchParams.set('pn', '1');
  const firstResponse = await context.request.get(requestUrl.toString(), {
    timeout: 60000,
    headers: { referer },
  });
  if (!firstResponse.ok()) {
    throw new Error(`收藏列表接口 HTTP ${firstResponse.status()}`);
  }
  const firstPage = await firstResponse.json();
  const pageCount = collectionApiPageCount(firstPage.total, COLLECTION_API_PAGE_SIZE);
  const pages = [firstPage];
  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    requestUrl.searchParams.set('pn', String(pageNumber));
    const response = await context.request.get(requestUrl.toString(), {
      timeout: 60000,
      headers: { referer },
    });
    if (!response.ok()) throw new Error(`收藏列表第 ${pageNumber} 页 HTTP ${response.status()}`);
    pages.push(await response.json());
  }

  const seenVideos = new Set();
  const videos = [];
  for (const pageData of pages) {
    for (const video of Array.isArray(pageData.videos) ? pageData.videos : []) {
      const key = String(video?.id || '') || materialUrlKey(video?.url || '');
      if (!key || seenVideos.has(key)) continue;
      seenVideos.add(key);
      videos.push(video);
    }
  }

  return {
    total: Math.max(0, Number(firstPage.total) || 0),
    pageCount,
    videos,
  };
}

async function extractCollectionMaterials(page, context, args) {
  const initialUrl = await captureCollectionFavoriteListUrl(page, args);
  const snapshot = await fetchCollectionFavoriteSnapshot(context, initialUrl, args.url);
  const seen = new Set();
  const materials = [];
  for (const material of collectionApiVideosToMaterials(snapshot.videos)) {
    if (seen.has(material.key)) continue;
    seen.add(material.key);
    materials.push({ ...material, materialNumber: materials.length + 1 });
  }
  materials.extractionFailures = [];
  console.log(`[收藏] 直接接口提取 ${materials.length}/${snapshot.total || materials.length} 条素材，共 ${snapshot.pageCount} 页`);
  return materials;
}

async function extractVisibleMaterials(page, {
  limit,
  sceneNumber,
  logPrefix,
  recovery,
}) {
  const materials = [];
  const extractionFailures = [];
  const seenCandidateKeys = new Set();
  const seenVideoKeys = new Set();
  let emptyScrolls = 0;

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
        // 虚拟列表在卡片标记后可能立即回收 DOM；候选已确认可见，
        // 因此这里不能让 Playwright 默认等待 30 秒而阻塞整批扫描。
        await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
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
    if (shouldCountEmptyMaterialScroll({
      newVideosThisPass,
      before: scroll.before,
      after: scroll.after,
      max: scroll.max,
    })) {
      emptyScrolls += 1;
    } else {
      emptyScrolls = 0;
    }
  }

  materials.extractionFailures = extractionFailures;
  return materials;
}

async function csrfTokenFromContext(context) {
  const cookies = await context.cookies('https://www.huasheng.cn');
  return cookies.find((cookie) => cookie.name === 'bili_jct')?.value || '';
}

async function uncollectFavoriteRequest(context, {
  favoriteListUrl,
  csrfToken,
  videoId,
  referer,
}) {
  const response = await context.request.post(favoriteMutationUrl(favoriteListUrl, csrfToken), {
    timeout: 60000,
    headers: { referer },
    data: favoriteUncollectPayload(videoId),
  });
  const responseText = await response.text();
  let responseBody = null;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    // HTTP 状态仍会在下面校验；部分成功响应可能没有 JSON 正文。
  }
  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()} ${response.statusText()}`);
  }
  if (responseBody && Object.hasOwn(responseBody, 'code') && Number(responseBody.code) !== 0) {
    throw new Error(`接口返回 code=${responseBody.code}: ${responseBody.message || responseBody.msg || '未知错误'}`);
  }
}

async function uncollectFavoriteWithRetry(context, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= COLLECTION_UNCOLLECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await uncollectFavoriteRequest(context, options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < COLLECTION_UNCOLLECT_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
  }
  throw lastError;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker()
  ));
  return results;
}

async function uncollectCollectionsViaApi({
  page,
  context,
  args,
  ledger,
  ledgerPath,
  allowedSourceKeys = null,
  requireEmpty = false,
}) {
  const favoriteListUrl = await captureCollectionFavoriteListUrl(page, args);
  const csrfToken = await csrfTokenFromContext(context);
  if (!csrfToken) throw new Error('登录态中缺少 CSRF 凭据，无法调用取消收藏接口');

  const allowedKeys = allowedSourceKeys ? new Set(allowedSourceKeys) : null;
  const successfulSourceKeys = new Set();
  let attempted = 0;
  let uncollected = 0;
  let verification = null;

  for (let pass = 1; pass <= COLLECTION_UNCOLLECT_MAX_PASSES; pass += 1) {
    const snapshot = await fetchCollectionFavoriteSnapshot(context, favoriteListUrl, args.url);
    const targets = snapshot.videos.filter((video) => {
      if (!allowedKeys) return true;
      return allowedKeys.has(materialUrlKey(video?.url || ''));
    });

    console.log(`[收藏] 接口校验：服务端现有 ${snapshot.total} 条，本轮需取消 ${targets.length} 条`);
    if (!targets.length) {
      verification = snapshot;
      break;
    }

    attempted += targets.length;
    let finished = 0;
    const results = await runWithConcurrency(
      targets,
      COLLECTION_UNCOLLECT_CONCURRENCY,
      async (video) => {
        try {
          if (!video?.id) throw new Error('收藏记录缺少视频 ID');
          await uncollectFavoriteWithRetry(context, {
            favoriteListUrl,
            csrfToken,
            videoId: video.id,
            referer: args.url,
          });
          return { ok: true, video };
        } catch (error) {
          return { ok: false, video, error };
        } finally {
          finished += 1;
          if (finished % 20 === 0 || finished === targets.length) {
            console.log(`[收藏] 本轮取消进度 ${finished}/${targets.length}`);
          }
        }
      }
    );

    const failures = results.filter((result) => !result.ok);
    for (const result of results) {
      if (!result.ok) continue;
      uncollected += 1;
      successfulSourceKeys.add(materialUrlKey(result.video?.url || ''));
    }
    if (successfulSourceKeys.size) {
      markCollectionLedgerUncollected(ledger, successfulSourceKeys);
      await saveCollectionLedger(ledgerPath, ledger);
    }
    if (failures.length) {
      console.warn(`[收藏] 本轮 ${failures.length} 条接口请求失败，将根据服务端剩余列表继续重试`);
    }

    verification = await fetchCollectionFavoriteSnapshot(context, favoriteListUrl, args.url);
    const remainingTargets = verification.videos.filter((video) => (
      !allowedKeys || allowedKeys.has(materialUrlKey(video?.url || ''))
    ));
    if (!remainingTargets.length) break;
    console.warn(`[收藏] 服务端复查仍有 ${remainingTargets.length} 条目标收藏，第 ${pass + 1} 轮继续处理`);
  }

  verification ||= await fetchCollectionFavoriteSnapshot(context, favoriteListUrl, args.url);
  const remainingTargets = verification.videos.filter((video) => (
    !allowedKeys || allowedKeys.has(materialUrlKey(video?.url || ''))
  ));
  if (remainingTargets.length) {
    throw new Error(`取消收藏后服务端复查仍有 ${remainingTargets.length} 条目标记录`);
  }
  if (requireEmpty && verification.total !== 0) {
    throw new Error(`取消收藏后服务端总数仍为 ${verification.total}，未达到清空标准`);
  }

  if (verification.total === 0) {
    markCollectionLedgerUncollected(ledger);
    await saveCollectionLedger(ledgerPath, ledger);
  }
  console.log(`[收藏] 服务端最终复查通过：剩余 ${verification.total} 条收藏`);
  return { attempted, uncollected, remaining: verification.total };
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
  context,
  args,
  manifest,
  ledger,
  failures,
  manifestPath,
  failuresPath,
  ledgerPath,
  scopedItems = ledger.items,
}) {
  if (args.noUncollect) {
    console.log('[收藏] --no-uncollect：跳过统一取消收藏阶段');
    return { attempted: 0, uncollected: 0 };
  }

  const queue = collectionCleanupQueue(scopedItems, {
    tab: args.tab,
    dryRun: args.dryRun,
  });
  if (!queue.length) return { attempted: 0, uncollected: 0 };

  console.log(`\n[收藏] 下载阶段已完成，开始通过接口取消 ${queue.length} 个已下载素材的收藏`);
  try {
    return await uncollectCollectionsViaApi({
      page,
      context,
      args,
      ledger,
      ledgerPath,
      allowedSourceKeys: queue.map((record) => record.sourceKey),
      requireEmpty: false,
    });
  } catch (error) {
    for (const record of queue) {
      if (record.uncollectStatus === 'uncollected') continue;
      record.uncollectStatus = 'failed';
      record.uncollectError = error.message;
      failures.push({
        ...record,
        failureType: 'uncollect',
        reason: record.uncollectError,
      });
    }
    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
    await saveCollectionLedger(ledgerPath, ledger);
    throw error;
  }
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

  const manifestPath = path.join(args.outDir, 'manifest.json');
  const failuresPath = path.join(args.outDir, 'failures.json');
  const ledgerPath = path.join(args.outDir, COLLECTION_LEDGER_FILE);
  const manifest = {
    startedAt: new Date().toISOString(),
    projectUrl: args.url,
    outDir: args.outDir,
    profileDir: args.profileDir,
    tab: args.tab,
    items: [],
  };
  const failures = [];
  let collectionLedger = { version: 1, items: [] };

  try {
    await ensureDir(args.outDir);
    if (args.tab === '收藏') {
      collectionLedger = await loadCollectionLedger(ledgerPath);
    }
    if (args.uncollectOnly) {
      const result = await uncollectCollectionsViaApi({
        page,
        context,
        args,
        ledger: collectionLedger,
        ledgerPath,
        requireEmpty: true,
      });
      console.log(`[收藏] 全量取消收藏完成：本次接口成功 ${result.uncollected} 条，服务端剩余 ${result.remaining} 条`);
      return;
    }

    if (args.tab === '收藏') {
      let passCount = 0;
      const downloadedVideoKeys = successfulMaterialKeys(collectionLedger.items);
      const downloadAttempts = new Map();
      const existingFileNames = await fs.readdir(args.outDir);
      let nextMaterialNumber = nextCollectionMaterialNumber(existingFileNames);
      let downloadedCount = 0;
      let scannedCollectionMaterials = [];

      console.log(`[收藏] 新素材将从 素材${pad2(nextMaterialNumber)}.mp4 开始编号`);

      while (true) {
        const remainingLimit = remainingCollectionLimit(args.limitPerScene, downloadedCount);
        if (args.limitPerScene && remainingLimit === 0) {
          console.log(`[收藏] 已达到本次运行上限 ${args.limitPerScene} 个素材`);
          break;
        }

        passCount += 1;
        console.log(`\n[收藏] === 第 ${passCount} 轮提取 ===`);

        const materials = await extractCollectionMaterials(page, context, args);
        scannedCollectionMaterials = materials;
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
            ledger: collectionLedger,
            failures,
            manifestPath,
            failuresPath,
            ledgerPath,
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
          hasRetryableVisibleMaterial,
        })) {
          console.log('[收藏] 当前收藏列表已通过直接接口完整处理，结束本次运行');
          break;
        }
      }

      if (shouldCleanupCollections({
        tab: args.tab,
        dryRun: args.dryRun,
        noUncollect: args.noUncollect,
        downloadPhaseComplete: true,
      })) {
        console.log('\n[收藏] 全部下载阶段已结束，现在开始统一取消收藏');
        await cleanupDownloadedCollections({
          page,
          context,
          args,
          manifest,
          ledger: collectionLedger,
          failures,
          manifestPath,
          failuresPath,
          ledgerPath,
          scopedItems: collectionCleanupScope(collectionLedger.items, scannedCollectionMaterials),
        });
      } else if (args.noUncollect) {
        console.log('[收藏] --no-uncollect：全部下载阶段已结束，跳过取消收藏');
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
    if (!args.uncollectOnly) {
      await writeJson(manifestPath, manifest).catch(() => {});
      await writeJson(failuresPath, failures).catch(() => {});
    }
    if (ownBrowser) await context.close();
  }

  console.log(`\n完成。清单: ${manifestPath}`);
  console.log(`失败记录: ${failuresPath}`);
  console.log(`输出目录: ${args.outDir}`);
}

async function processMaterials({ materials, context, args, manifest, ledger, failures, manifestPath, failuresPath, ledgerPath, referer, label }) {
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
    if (args.tab === '收藏' && record.status === 'downloaded') {
      ledger.items = mergeCollectionLedgerItems(ledger.items, [record]);
      await saveCollectionLedger(ledgerPath, ledger);
    }
  }
  return processedRecords;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  (args.storyboard ? downloadStoryboards(args) : downloadCollections(args)).catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
