#!/usr/bin/env node

// 续传命令：create 失败但项目已生成时，在已有项目页补交剩余步骤（方案指令 + 两次确认）。
// 不会重新创建项目；--start 指定从第几步开始（1=方案指令，2=第一次确认，3=第二次确认）。
import {
  createModePrompt,
  normalizeProjectUrl,
  submitChatMessage,
  waitForAiReady,
} from './huasheng-create.js';
import { DEFAULT_PROFILE_DIR, launchBrowser } from './shared.js';
import path from 'node:path';

const STEP_TIMEOUT_MS = 60_000;
const HOLD_BROWSER_MS = 600_000;
const TOTAL_STEPS = 3;

export function parseResumeArgs(argv) {
  const args = {
    projectUrl: '',
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    slowMo: 80,
    mode: 'A',
    start: 1,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !args.projectUrl) {
      args.projectUrl = normalizeProjectUrl(arg);
    } else if (arg === '--profile') {
      const value = argv[++i];
      if (!value) throw new Error('--profile 需要提供目录。');
      args.profileDir = path.resolve(value);
    } else if (arg === '--headless') {
      args.headless = true;
    } else if (arg === '--slow-mo') {
      args.slowMo = Number(argv[++i]);
    } else if (arg === '--mode') {
      const value = argv[++i];
      if (!value) throw new Error('--mode 需要提供 A 或 B。');
      const mode = value.toUpperCase();
      if (!['A', 'B'].includes(mode)) {
        throw new Error('--mode 只支持 A 或 B。');
      }
      args.mode = mode;
    } else if (arg === '--start') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1 || value > TOTAL_STEPS) {
        throw new Error(`--start 只支持 1 到 ${TOTAL_STEPS}。`);
      }
      args.start = value;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!args.projectUrl) {
    throw new Error('需要提供华声项目 URL。');
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) {
    throw new Error('--slow-mo 必须是大于或等于 0 的数字。');
  }

  return args;
}

export function resumeMessages(mode, start = 1) {
  const messages = [createModePrompt(mode), '确认', '确认'];
  return messages.slice(start - 1);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseResumeArgs(argv);
  const messages = resumeMessages(args.mode, args.start);
  const { context, page } = await launchBrowser(args);

  try {
    await page.goto(args.projectUrl, {
      waitUntil: 'domcontentloaded',
      timeout: STEP_TIMEOUT_MS,
    });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    for (const [index, message] of messages.entries()) {
      const step = args.start + index;
      console.log(`[${step}/${TOTAL_STEPS}] 等待 AI 可输入...`);
      await waitForAiReady(page);
      console.log(`[${step}/${TOTAL_STEPS}] 提交: "${message}"`);
      await submitChatMessage(page, message);
      console.log(`[${step}/${TOTAL_STEPS}] 已提交 ✓`);
    }

    console.log('\n续传完成：剩余步骤均已提交。');
    console.log(`浏览器保留 ${HOLD_BROWSER_MS / 60_000} 分钟供检查，之后自动关闭（Ctrl+C 可提前结束）。`);
    await page.waitForTimeout(HOLD_BROWSER_MS);
  } catch (error) {
    console.error(`\n续传失败: ${error.message}`);
    console.error(`当前页面: ${page.url()}`);
    console.error(`浏览器保留 ${HOLD_BROWSER_MS / 60_000} 分钟供检查。`);
    await page.waitForTimeout(HOLD_BROWSER_MS);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
