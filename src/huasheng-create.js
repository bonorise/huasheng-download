#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROFILE_DIR,
  isProbablyLoggedOut,
  launchBrowser,
  pauseForEnter,
} from './shared.js';

const HOME_URL = 'https://www.huasheng.cn/';
const STEP_TIMEOUT_MS = 60_000;
const CHAT_INPUT_SELECTOR = 'textarea[placeholder="输入你的任何想法"]';
const CREATE_MODE_TEXT = 'A - 素材剪辑成片';

export function parseCreateArgs(argv) {
  const args = {
    txtPath: '',
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    slowMo: 80,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !args.txtPath) {
      args.txtPath = path.resolve(arg);
    } else if (arg === '--profile') {
      const value = argv[++i];
      if (!value) throw new Error('--profile 需要提供目录。');
      args.profileDir = path.resolve(value);
    } else if (arg === '--headless') {
      args.headless = true;
    } else if (arg === '--slow-mo') {
      args.slowMo = Number(argv[++i]);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!args.txtPath) {
    throw new Error('需要提供 TXT 文件路径。');
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) {
    throw new Error('--slow-mo 必须是大于或等于 0 的数字。');
  }

  return args;
}

export function normalizeScriptText(rawText) {
  const text = String(rawText).trim();
  if (!text) throw new Error('TXT 文件内容为空。');
  return text;
}

export async function readScriptText(txtPath) {
  let rawText;
  try {
    rawText = await fs.readFile(txtPath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 TXT 文件 ${txtPath}: ${error.message}`);
  }
  return normalizeScriptText(rawText);
}

export function isVideoProjectUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && url.hostname === 'www.huasheng.cn'
      && /^\/video\/\d+$/.test(url.pathname)
      && url.searchParams.get('clip') === '-1';
  } catch {
    return false;
  }
}

export function normalizeProjectUrl(rawUrl) {
  if (!isVideoProjectUrl(rawUrl)) {
    throw new Error(`不是有效的视频项目 URL: ${rawUrl}`);
  }
  return new URL(rawUrl).toString();
}

export async function runStepWithRetry(stepName, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        console.warn(`[${stepName}] 第一次失败，正在重试: ${error.message}`);
      }
    }
  }
  throw new Error(`[${stepName}] 重试后仍失败: ${lastError.message}`);
}

async function largestVisibleTextarea(page, selector) {
  const candidates = page.locator(selector);
  const count = await candidates.count();
  let best = null;
  let bestArea = -1;

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const box = await candidate.boundingBox();
    const area = box ? box.width * box.height : 0;
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }

  return best;
}

async function findHomeTextarea(page) {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('textarea')).some((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    }),
    null,
    { timeout: STEP_TIMEOUT_MS }
  );

  const antInput = await largestVisibleTextarea(page, 'textarea.ant-input');
  if (antInput) return antInput;

  const fallback = await largestVisibleTextarea(page, 'textarea');
  if (fallback) return fallback;

  throw new Error('未找到首页文案输入框。');
}

async function findVisibleChatInput(page) {
  const inputs = page.locator(CHAT_INPUT_SELECTOR);
  await page.waitForFunction(
    (selector) => Array.from(document.querySelectorAll(selector)).some((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    }),
    CHAT_INPUT_SELECTOR,
    { timeout: STEP_TIMEOUT_MS }
  );

  const count = await inputs.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index);
    if (await input.isVisible().catch(() => false)) return input;
  }

  throw new Error('未找到可见的对话输入框。');
}

async function findVisibleButtonByExactText(page, text) {
  const buttons = page.getByRole('button', { name: text, exact: true });
  await page.waitForFunction(
    (buttonText) => Array.from(document.querySelectorAll('button')).some((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = element.textContent?.replace(/\s+/g, ' ').trim();
      return text === buttonText
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    }),
    text,
    { timeout: STEP_TIMEOUT_MS }
  );

  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible().catch(() => false)) return button;
  }

  throw new Error(`未找到可见按钮: ${text}`);
}

async function clickButtonByExactText(page, text) {
  const button = await findVisibleButtonByExactText(page, text);
  await button.click();
}

async function submitConfirmation(page) {
  const input = await findVisibleChatInput(page);
  await input.fill('确认');
  await input.press('Enter');

  await page.waitForFunction(
    (selector) => {
      const inputs = Array.from(document.querySelectorAll(selector));
      const visible = inputs.filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0;
      });
      return visible.some((element) => element.value === '');
    },
    CHAT_INPUT_SELECTOR,
    { timeout: STEP_TIMEOUT_MS }
  );
}

async function waitForVideoProjectUrl(page) {
  await page.waitForURL(
    (url) => isVideoProjectUrl(url.toString()),
    { timeout: STEP_TIMEOUT_MS }
  );
  return normalizeProjectUrl(page.url());
}

async function openHome(page, args) {
  await page.goto(HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: STEP_TIMEOUT_MS,
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (!await isProbablyLoggedOut(page)) return;
  if (args.headless) {
    throw new Error('当前登录态已失效，无头模式无法手动登录。');
  }

  await pauseForEnter('当前登录态已失效，请在浏览器中完成华声登录。');
  await page.goto(HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: STEP_TIMEOUT_MS,
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (await isProbablyLoggedOut(page)) {
    throw new Error('登录后仍未检测到有效登录态。');
  }
}

export async function createHuashengProject({ page, args, scriptText }) {
  await runStepWithRetry('打开首页', () => openHome(page, args));

  await runStepWithRetry('填写文案', async () => {
    const input = await findHomeTextarea(page);
    await input.fill(scriptText);
  });

  await runStepWithRetry('点击创建', async () => {
    await clickButtonByExactText(page, '创建');
  });

  await runStepWithRetry(`点击${CREATE_MODE_TEXT}`, async () => {
    await clickButtonByExactText(page, CREATE_MODE_TEXT);
  });

  await runStepWithRetry('第一次提交确认', async () => {
    await submitConfirmation(page);
  });

  const projectUrl = await runStepWithRetry('等待视频项目页', async () => {
    return waitForVideoProjectUrl(page);
  });

  await runStepWithRetry('第二次提交确认', async () => {
    await submitConfirmation(page);
  });

  return projectUrl;
}

function holdBrowserOpen(message) {
  console.log(`\n${message}`);
  console.log('浏览器已保留，请检查页面；按 Ctrl+C 结束脚本。');
  return new Promise(() => {});
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCreateArgs(argv);
  const scriptText = await readScriptText(args.txtPath);
  const { page } = await launchBrowser(args);

  try {
    const projectUrl = await createHuashengProject({ page, args, scriptText });
    console.log(`\n创建完成: ${projectUrl}`);
    await holdBrowserOpen('任务已完成。');
  } catch (error) {
    console.error(`\n创建失败: ${error.message}`);
    console.error(`当前页面: ${page.url()}`);
    await holdBrowserOpen('任务失败，请检查浏览器现场。');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
