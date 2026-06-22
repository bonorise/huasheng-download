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

export function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').pop();
    return `${parsed.origin}/.../${file}`;
  } catch {
    return url.slice(0, 96);
  }
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
