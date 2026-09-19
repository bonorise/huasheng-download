#!/usr/bin/env node

import { chromium } from 'playwright';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_OUT_DIR = path.join(os.homedir(), 'Desktop', 'hs-src');
const DEFAULT_PROFILE_DIR = path.resolve('.browser-profile');

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
  --start-card <编号>  从指定 MG 编号开始处理
  --headless          无头模式。首次登录不建议使用
  --dry-run           只提取 WebM 直链，不下载
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

export function mgAnimationNumber(text) {
  const match = /^\s*MG\s*动画\s*(\d+)\s*$/i.exec(String(text || ''));
  return match ? Number(match[1]) : 0;
}

export function isDirectWebmUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (!/^https?:$/.test(url.protocol)) return false;
    if (!/\.webm$/i.test(url.pathname)) return false;
    // 地址来自页面 DOM，指向内网字面量的候选必须在提取阶段就丢弃
    return !isPrivateAddress(url.hostname);
  } catch {
    return false;
  }
}

export function mgFilename(mgNumber, mimeType = '') {
  const ext = /^video\/webm\b/i.test(mimeType) ? 'webm' : 'mp4';
  return `MG动画_${pad2(mgNumber)}.${ext}`;
}

const PRIVATE_IPV4_PATTERNS = [
  /^0\./, // 0.0.0.0/8 未指定
  /^10\./, // 10.0.0.0/8 私有
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGNAT
  /^127\./, // 环回
  /^169\.254\./, // 链路本地（含 169.254.169.254 云元数据）
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12 私有
  /^192\.168\./, // 192.168.0.0/16 私有
];

// 判定单个 IP 字面量是否指向本机/内网。下载目标来自页面 DOM，
// 必须校验，否则页面上的任意 URL 都会让脚本替其发出带登录态的请求。
export function isPrivateAddress(address) {
  const value = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return true;

  // IPv4-mapped/compatible IPv6（::ffff:127.0.0.1）取内嵌 v4 重新判定
  const ipv4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (ipv4Tail && value.includes(':')) return isPrivateAddress(ipv4Tail[1]);

  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(value));
  }

  if (value.includes(':')) {
    if (value === '::' || value === '::1') return true;
    const head = value.split(':')[0];
    if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true; // fc00::/7 唯一本地
    if (/^fe[89ab][0-9a-f]?$/.test(head)) return true; // fe80::/10 链路本地
    if (/^ff[0-9a-f]{0,2}$/.test(head)) return true; // ff00::/8 组播
    return false;
  }

  return false;
}

// 校验下载目标：仅允许 http(s)，且主机名及其全部 DNS 解析结果都不得落在内网。
// maxRedirects 由调用方设为 0，避免 302 跳到内网绕过本校验。
export async function assertSafeDownloadUrl(rawUrl, { resolveHost } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('下载地址不是合法 URL');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`下载地址协议不受支持: ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('下载地址缺少主机名');
  if (isPrivateAddress(host)) {
    throw new Error(`下载地址指向内网，已拒绝: ${host}`);
  }

  const lookup = resolveHost || ((name) => dns.lookup(name, { all: true }));
  let records;
  try {
    records = await lookup(host);
  } catch (error) {
    throw new Error(`下载地址主机名无法解析: ${host} (${error.message})`);
  }
  for (const record of Array.isArray(records) ? records : [records]) {
    if (isPrivateAddress(record?.address)) {
      throw new Error(`下载地址解析到内网地址，已拒绝: ${host} -> ${record.address}`);
    }
  }

  return url.toString();
}

export function directMGMaterials(entries) {
  const seenNumbers = new Set();
  const seenUrls = new Set();
  const materials = [];
  for (const entry of entries || []) {
    const mgNumber = mgAnimationNumber(entry?.label);
    const url = String(entry?.url || '');
    if (!mgNumber || !isDirectWebmUrl(url) || seenNumbers.has(mgNumber) || seenUrls.has(url)) continue;
    seenNumbers.add(mgNumber);
    seenUrls.add(url);
    materials.push({
      mgNumber,
      filename: mgFilename(mgNumber, 'video/webm'),
      url,
      mimeType: 'video/webm',
      sourceType: 'direct',
    });
  }
  return materials.sort((a, b) => a.mgNumber - b.mgNumber);
}

export function timelineMGNumbers(labels) {
  return Array.from(new Set((labels || []).map(mgAnimationNumber).filter(Boolean))).sort((a, b) => a - b);
}

async function readDirectMGMaterials(page) {
  const entries = await page.evaluate(() => {
    const result = [];
    for (const video of document.querySelectorAll('video[src]')) {
      // 素材窗源码中的 src 才是可持久下载地址；currentSrc 可能被播放器改成临时 blob。
      const url = video.getAttribute('src') || video.src || video.currentSrc || '';
      if (!/^https?:\/\//i.test(url) || !/\.webm(?:[?#]|$)/i.test(url)) continue;

      let container = video.parentElement;
      let label = '';
      for (let depth = 0; container && depth < 12; depth += 1, container = container.parentElement) {
        const labelNode = Array.from(container.querySelectorAll('div')).find((node) => (
          /^\s*MG\s*动画\s*\d+\s*$/i.test(node.textContent || '')
        ));
        if (labelNode) {
          label = labelNode.textContent || '';
          break;
        }
      }
      if (label) result.push({ label, url });
    }
    return result;
  });
  return directMGMaterials(entries);
}

async function mgFileExists(outDir, mgNumber) {
  for (const mimeType of ['video/webm', 'video/mp4']) {
    try {
      await fs.access(path.join(outDir, mgFilename(mgNumber, mimeType)));
      return true;
    } catch { /* 不存在 */ }
  }
  return false;
}

async function collectTimelineMGNumbers(page) {
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('span'))
    .filter((span) => {
      if (!/^\s*MG\s*动画\s*\d+\s*$/i.test(span.textContent || '')) return false;
      let element = span.parentElement;
      for (let depth = 0; element && depth < 5; depth += 1, element = element.parentElement) {
        if (element.classList.contains('absolute') && element.classList.contains('cursor-pointer')) return true;
      }
      return false;
    })
    .map((span) => span.textContent || ''));
  return timelineMGNumbers(labels);
}

async function selectTimelineMG(page, mgNumber) {
  return page.evaluate((targetNumber) => {
    for (const span of document.querySelectorAll('span')) {
      const match = /^\s*MG\s*动画\s*(\d+)\s*$/i.exec(span.textContent || '');
      if (Number(match?.[1]) !== targetNumber) continue;
      let element = span.parentElement;
      for (let depth = 0; element && depth < 5; depth += 1, element = element.parentElement) {
        if (element.classList.contains('absolute') && element.classList.contains('cursor-pointer')) {
          element.scrollIntoView({ block: 'nearest', inline: 'center' });
          element.click();
          return true;
        }
      }
    }
    return false;
  }, mgNumber);
}

async function waitForDirectMGMaterial(page, mgNumber, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const item = (await readDirectMGMaterials(page)).find((material) => material.mgNumber === mgNumber);
    if (item) return item;
    await page.waitForTimeout(250);
  }
  return null;
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

async function extractMGAnimations(page, args) {
  const materials = [];
  const failures = [];
  let existingCount = 0;

  console.log('\n[MG] 收集时间轴 MG 条带...');
  const mgNumbers = await collectTimelineMGNumbers(page);
  console.log(`[MG] 发现 ${mgNumbers.length} 个 MG 动画: ${mgNumbers.map(pad2).join(', ')}`);

  for (const mgNumber of mgNumbers) {
    if (args.startCard && mgNumber < args.startCard) continue;
    if (args.limit && materials.length >= args.limit) break;

    if (await mgFileExists(args.outDir, mgNumber)) {
      existingCount += 1;
      console.log(`[MG] 跳过 MG动画 ${pad2(mgNumber)} (已存在)`);
      continue;
    }

    const selected = await selectTimelineMG(page, mgNumber);
    if (!selected) {
      failures.push({ mgNumber, reason: '未找到对应的时间轴 MG 条带' });
      continue;
    }
    const item = await waitForDirectMGMaterial(page, mgNumber);
    if (!item) {
      failures.push({ mgNumber, reason: '素材窗口未出现对应的 WebM 直链' });
      console.warn(`[MG] MG动画 ${pad2(mgNumber)} 未找到 WebM 直链`);
      continue;
    }
    materials.push({ ...item, filePath: path.join(args.outDir, item.filename) });
    console.log(`[MG] 发现直链 MG动画 ${pad2(mgNumber)}: ${shortUrl(item.url)}`);
  }
  console.log(`[MG] 扫描完成：总计 ${mgNumbers.length} 个，待下载 ${materials.length} 个，已存在 ${existingCount} 个`);
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
      sourceType: 'direct',
      sourceUrl: item.url,
      status: args.dryRun ? 'dry-run' : 'pending',
      filename: item.filename,
      mimeType: item.mimeType,
      bytes: item.bytes || 0,
      reportedBytes: item.reportedBytes,
    };

    try {
      if (!args.dryRun) {
        const safeUrl = await assertSafeDownloadUrl(item.url);
        const response = await page.request.get(safeUrl, {
          headers: { Referer: args.url },
          timeout: 60000,
          maxRedirects: 0, // 禁止跳转，避免 302 把请求带到内网绕过上面的校验
        });
        if (!response.ok()) {
          const redirectHint = response.status() >= 300 && response.status() < 400 ? '（重定向被安全策略拒绝）' : '';
          throw new Error(`HTTP ${response.status()}${redirectHint}`);
        }
        await assertSafeDownloadUrl(response.url()); // 防御纵深：最终落地地址仍须为公网
        const body = await response.body();
        const isWebm = body.length >= 4 && body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
        if (!isWebm) throw new Error('直链响应不是 WebM 文件');
        record.bytes = body.byteLength;
        record.reportedBytes = body.byteLength;
        console.log(`[MG] 直链下载 MG动画 ${pad2(item.mgNumber)}: ${shortUrl(item.url)} (${(body.byteLength / 1024 / 1024).toFixed(1)} MB)`);
        await fs.writeFile(item.filePath, body, { flag: 'wx' });
        record.status = 'downloaded';
        record.filePath = item.filePath;
        downloaded += 1;
        console.log(`[MG] 已下载 ${item.filename} (${record.bytes} bytes)`);
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
