import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, ensureDir, writeJson, writeFileExclusive, pad2 } from './shared.js';

// React 的 :r17: 会变；使用同一时间轴内稳定的卡片类和编号标签。
export const STORYBOARD_CARD = '.clip-card-box';
export function storyboardNumber(text) {
  const match = /^分镜\s*(\d+)$/.exec(String(text).trim());
  return match ? Number(match[1]) : 0;
}
export function storyboardFilename(number, url) {
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  if (!['.mp4', '.webm', '.mov'].includes(extension)) throw new Error('不支持的分镜视频格式');
  return `分镜${pad2(number)}${extension}`;
}
export function validateStoryboardNumbers(numbers, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error('无法确定分镜总数');
  const found = new Set(numbers);
  const missing = Array.from({ length: total }, (_, i) => i + 1).filter(n => !found.has(n));
  if (missing.length || found.size !== total) throw new Error(`时间轴分镜不完整，缺少：${missing.join(', ')}；发现 ${found.size}/${total}`);
  return [...found].sort((a, b) => a - b);
}
async function scrollTimeline(page, reset = false) {
  return page.locator(STORYBOARD_CARD).first().evaluate((card, reset) => {
    let container = card.parentElement;
    while (container && !(container.scrollWidth > container.clientWidth && /auto|scroll/.test(getComputedStyle(container).overflowX))) container = container.parentElement;
    if (!container) throw new Error('找不到时间轴横向滚动容器');
    const before = container.scrollLeft;
    container.scrollLeft = reset ? 0 : before + Math.max(100, container.clientWidth * 0.75);
    return { before, after: container.scrollLeft, end: container.scrollLeft + container.clientWidth >= container.scrollWidth - 2 };
  }, reset);
}
async function readCards(page) {
  return page.locator(STORYBOARD_CARD).evaluateAll(cards => cards.map(card => ({
    name: [...card.querySelectorAll('div')].map(e => e.textContent.trim()).find(t => /^分镜\s*\d+$/.test(t)),
    clipId: card.querySelector('img')?.getAttribute('alt'),
  })).filter(card => card.name));
}
async function findCard(page, number) {
  const locator = page.locator(STORYBOARD_CARD).filter({ has: page.getByText(new RegExp(`^分镜\\s*0*${number}$`)) });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await locator.count() === 1) return locator;
    const state = await scrollTimeline(page);
    await page.waitForTimeout(150);
    if (state.end && await locator.count() !== 1) break;
  }
  throw new Error(`未找到分镜${pad2(number)}卡片`);
}
export async function downloadStoryboards(args) {
  await ensureDir(args.outDir);
  const manifestPath = path.join(args.outDir, args.dryRun ? 'storyboard-dry-run.json' : 'storyboard-manifest.json');
  const failuresPath = path.join(args.outDir, 'storyboard-failures.json');
  const previous = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => ({}));
  const manifest = { projectUrl: args.url, startedAt: new Date().toISOString(), items: [] };
  const failures = [];
  const { context, page } = await launchBrowser(args);
  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator(STORYBOARD_CARD).first().waitFor({ timeout: 60000 });
    const totalText = await page.getByText(/分镜总数\s*\d+/).first().innerText();
    const total = Number(/分镜总数\s*(\d+)/.exec(totalText)?.[1]);
    const discovered = new Map();
    await scrollTimeline(page, true);
    for (let attempt = 0; attempt < 300; attempt++) {
      for (const card of await readCards(page)) discovered.set(storyboardNumber(card.name), card);
      const state = await scrollTimeline(page);
      await page.waitForTimeout(180);
      if (state.end) {
        for (const card of await readCards(page)) discovered.set(storyboardNumber(card.name), card);
        break;
      }
    }
    const numbers = validateStoryboardNumbers([...discovered.keys()], total);
    manifest.total = total;
    console.log(`时间轴完整校验通过：${numbers.length}/${total} 个分镜，将按编号顺序下载`);
    await scrollTimeline(page, true);
    await page.waitForTimeout(200);
    for (const number of numbers) {
      const cardInfo = discovered.get(number);
      try {
        const card = await findCard(page, number);
        await card.scrollIntoViewIfNeeded();
        await card.click();
        if (!/^\d+$/.test(cardInfo.clipId || '')) throw new Error('分镜卡片缺少可靠的 clip ID');
        const video = page.locator(`video[data-loaded-clip-id="${cardInfo.clipId}"]`);
        await page.waitForFunction(id => [...document.querySelectorAll('video')].some(v => v.dataset.loadedClipId === id && /^https?:/.test(v.getAttribute('src') || '')), cardInfo.clipId, { timeout: 30000 });
        const url = await video.first().getAttribute('src');
        const filename = storyboardFilename(number, url);
        const filePath = path.join(args.outDir, filename);
        const record = { number, name: cardInfo.name, clipId: cardInfo.clipId, sourceUrl: url, filename, status: 'dry-run' };
        if (!args.dryRun) {
          const old = previous.projectUrl === args.url && previous.items?.find(item => item.number === number && item.clipId === cardInfo.clipId && item.filename === filename && new URL(item.sourceUrl).pathname === new URL(url).pathname && ['downloaded', 'existing'].includes(item.status));
          const stat = await fs.stat(filePath).catch(() => null);
          if (stat && old && stat.size === old.bytes && stat.size > 0) {
            record.bytes = stat.size;
            record.status = 'existing';
          } else {
            if (stat) throw new Error(`已有同名文件且无法确认来源，拒绝覆盖：${filename}`);
            let body;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const response = await context.request.get(url, { headers: { referer: args.url }, timeout: 120000 });
                try {
                  if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
                  body = await response.body();
                  const valid = filename.endsWith('.webm') ? body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : body.subarray(4, 8).toString() === 'ftyp';
                  if (!valid) throw new Error('响应不是有效的视频文件');
                } finally { await response.dispose(); }
                break;
              } catch (error) { if (attempt === 2) throw error; }
            }
            await writeFileExclusive(filePath, body);
            record.bytes = body.length;
            record.status = 'downloaded';
          }
        }
        manifest.items.push(record);
        console.log(`[${cardInfo.name}] ${record.status} ${filename}${record.bytes ? ` (${record.bytes} bytes)` : ''}`);
      } catch (error) {
        failures.push({ number, name: cardInfo.name, reason: error.message });
        console.warn(`[${cardInfo.name}] 失败：${error.message}`);
      }
      await writeJson(manifestPath, manifest);
      await writeJson(failuresPath, failures);
    }
  } catch (error) {
    failures.push({ reason: error.message, phase: 'discovery' });
    throw error;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    manifest.summary = { success: manifest.items.length, failed: failures.length, dryRun: args.dryRun };
    if (manifest.total) await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
    await context.close();
  }
  if (failures.length) throw new Error(`${failures.length} 个分镜失败，请查看 ${failuresPath}`);
  console.log(`分镜下载完成：${manifest.items.length}/${manifest.total}，输出目录：${args.outDir}`);
}
