#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_OUT_DIR = path.join(os.homedir(), 'Desktop', 'hs-src');
const DEFAULT_PROFILE_DIR = path.resolve('.browser-profile');
const DEFAULT_STOP_AFTER_EMPTY_SCROLLS = 3;

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
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!args.url) {
    printHelp();
    throw new Error('请提供华声项目 URL。');
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) args.slowMo = 80;
  if (args.count !== null && (!Number.isInteger(args.count) || args.count < 1)) {
    throw new Error('--count 必须是大于 0 的整数。');
  }
  if (args.limitPerScene && (!Number.isInteger(args.limitPerScene) || args.limitPerScene < 1)) {
    throw new Error('--limit 必须是大于 0 的整数。');
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
  --limit <数量>      每个分镜最多下载多少个素材，默认不限制
  --headless          无头模式。首次登录不建议使用
  --dry-run           只提取素材 URL，不下载
  --slow-mo <毫秒>    浏览器操作延迟，默认 80
`);
}

function sceneUrl(baseUrl, sceneNumber) {
  const url = new URL(baseUrl);
  if (sceneNumber <= 1) {
    url.searchParams.delete('clip');
  } else {
    url.searchParams.set('clip', String(sceneNumber - 1));
  }
  return url.toString();
}

function sceneNumberFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const clip = url.searchParams.get('clip');
  if (clip === null) return 1;
  const clipNumber = Number(clip);
  return Number.isInteger(clipNumber) && clipNumber >= 0 ? clipNumber + 1 : 1;
}

function pad2(number) {
  return String(number).padStart(2, '0');
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
  return /登录|验证码|手机号|微信扫码|未登录/.test(text) && !/分镜|素材|推荐/.test(text);
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
  if (args.count) count = Math.max(count, args.count);
  if (args.lastUrl) count = Math.max(count, sceneNumberFromUrl(args.lastUrl));

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

  await clickFirstVisibleText(page, ['推荐']);
  await page.waitForTimeout(900);

  return expanded;
}

async function markVisibleMaterialCandidates(page, seenKeys) {
  return page.evaluate((seen) => {
    const seenSet = new Set(seen);
    const viewportW = window.innerWidth || document.documentElement.clientWidth;
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const elements = Array.from(document.querySelectorAll('img, [style*="background-image"], video, canvas'));
    const candidates = [];

    function visibleRect(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
      if (rect.width < 48 || rect.height < 48) return null;
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportH || rect.left >= viewportW) return null;
      return rect;
    }

    for (const el of elements) {
      const rect = visibleRect(el);
      if (!rect) continue;
      if (rect.left < viewportW * 0.35) continue;
      if (rect.width > viewportW * 0.65 || rect.height > viewportH * 0.75) continue;

      const style = window.getComputedStyle(el);
      const src = el.currentSrc || el.src || style.backgroundImage || '';
      const key = `${src}|${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (seenSet.has(key)) continue;
      const id = `hs_candidate_${Date.now()}_${candidates.length}`;
      el.setAttribute('data-hs-candidate-id', id);
      candidates.push({
        id,
        key,
        tag: el.tagName.toLowerCase(),
        src,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return candidates;
  }, Array.from(seenKeys));
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

async function closeMaterialModal(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
  const closed = await clickFirstVisibleText(page, ['关闭', '×', '取消'], 1000).catch(() => false);
  if (!closed) {
    const viewport = page.viewportSize();
    if (viewport) await page.mouse.click(viewport.width - 28, 28).catch(() => {});
  }
  await page.waitForTimeout(350);
}

async function scrollMaterialList(page) {
  return page.evaluate(() => {
    const viewportW = window.innerWidth || document.documentElement.clientWidth;
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const scrollables = Array.from(document.querySelectorAll('body, body *')).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.left < viewportW * 0.3 || rect.height < 160) return false;
      if (!/(auto|scroll)/.test(`${style.overflowY}${style.overflow}`)) return false;
      return el.scrollHeight > el.clientHeight + 40;
    });
    scrollables.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.height * br.width) - (ar.height * ar.width);
    });
    const target = scrollables[0] || document.scrollingElement || document.documentElement;
    const before = target.scrollTop;
    target.scrollBy({ top: Math.floor(viewportH * 0.75), behavior: 'instant' });
    return { before, after: target.scrollTop, max: target.scrollHeight - target.clientHeight };
  });
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

  const materials = [];
  const seenCandidateKeys = new Set();
  const seenVideoUrls = new Set();
  let emptyScrolls = 0;

  while (emptyScrolls < DEFAULT_STOP_AFTER_EMPTY_SCROLLS) {
    const candidates = await markVisibleMaterialCandidates(page, seenCandidateKeys);
    let newVideosThisPass = 0;

    for (const candidate of candidates) {
      if (args.limitPerScene && materials.length >= args.limitPerScene) break;
      seenCandidateKeys.add(candidate.key);

      const beforeSources = new Set(await visibleVideoSources(page));
      const locator = page.locator(`[data-hs-candidate-id="${candidate.id}"]`).first();
      const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) continue;

      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 3000 }).catch(async () => {
        await locator.click({ force: true, timeout: 2000 });
      }).catch(() => {});

      let videoUrl = '';
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await page.waitForTimeout(350);
        const afterSources = await visibleVideoSources(page);
        videoUrl = afterSources.find((src) => !beforeSources.has(src)) || afterSources[0] || '';
        if (videoUrl) break;
      }

      if (videoUrl && !seenVideoUrls.has(videoUrl)) {
        seenVideoUrls.add(videoUrl);
        materials.push({
          sceneNumber,
          materialNumber: materials.length + 1,
          url: videoUrl,
          candidate,
        });
        newVideosThisPass += 1;
        console.log(`[分镜 ${pad2(sceneNumber)}] 捕获素材 ${pad2(materials.length)}: ${shortUrl(videoUrl)}`);
      }

      await closeMaterialModal(page);
    }

    if (args.limitPerScene && materials.length >= args.limitPerScene) break;

    const scroll = await scrollMaterialList(page);
    await page.waitForTimeout(800);
    if (newVideosThisPass === 0 && scroll.after === scroll.before) {
      emptyScrolls += 1;
    } else {
      emptyScrolls = 0;
    }
  }

  return materials;
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').pop();
    return `${parsed.origin}/.../${file}`;
  } catch {
    return url.slice(0, 96);
  }
}

async function downloadMaterial(context, item, outDir, referer) {
  const filename = `分镜${pad2(item.sceneNumber)}_素材${pad2(item.materialNumber)}.mp4`;
  const filePath = path.join(outDir, filename);
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
  await fs.writeFile(filePath, body);
  return { filename, filePath, bytes: body.byteLength };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureDir(args.outDir);

  const manifestPath = path.join(args.outDir, 'manifest.json');
  const failuresPath = path.join(args.outDir, 'failures.json');
  const manifest = {
    startedAt: new Date().toISOString(),
    projectUrl: args.url,
    outDir: args.outDir,
    profileDir: args.profileDir,
    items: [],
  };
  const failures = [];

  const context = await chromium.launchPersistentContext(args.profileDir, {
    headless: args.headless,
    slowMo: args.slowMo,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    locale: 'zh-CN',
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    const scenes = await discoverScenes(page, args);
    console.log(`将处理 ${scenes.length} 个分镜: ${scenes.map((n) => pad2(n)).join(', ')}`);

    for (const sceneNumber of scenes) {
      try {
        const materials = await extractSceneMaterials(page, sceneNumber, args);
        if (!materials.length) {
          failures.push({ sceneNumber, reason: '未发现素材视频 URL' });
          await writeJson(failuresPath, failures);
          continue;
        }

        for (const item of materials) {
          const record = {
            sceneNumber: item.sceneNumber,
            materialNumber: item.materialNumber,
            sourceUrl: item.url,
            status: args.dryRun ? 'dry-run' : 'pending',
          };

          try {
            if (!args.dryRun) {
              const result = await downloadMaterial(context, item, args.outDir, sceneUrl(args.url, sceneNumber));
              Object.assign(record, {
                status: 'downloaded',
                filename: result.filename,
                filePath: result.filePath,
                bytes: result.bytes,
              });
              console.log(`[分镜 ${pad2(sceneNumber)}] 已下载 ${result.filename} (${result.bytes} bytes)`);
            }
          } catch (error) {
            record.status = 'failed';
            record.error = error.message;
            failures.push(record);
            console.warn(`[分镜 ${pad2(sceneNumber)}] 下载失败 素材${pad2(item.materialNumber)}: ${error.message}`);
          }

          manifest.items.push(record);
          await writeJson(manifestPath, manifest);
          await writeJson(failuresPath, failures);
        }
      } catch (error) {
        failures.push({ sceneNumber, reason: error.message });
        await writeJson(failuresPath, failures);
        console.warn(`[分镜 ${pad2(sceneNumber)}] 处理失败: ${error.message}`);
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
    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
    await context.close();
  }

  console.log(`\n完成。清单: ${manifestPath}`);
  console.log(`失败记录: ${failuresPath}`);
  console.log(`输出目录: ${args.outDir}`);
}

main().catch((error) => {
  console.error(`\n错误: ${error.message}`);
  process.exitCode = 1;
});
