#!/usr/bin/env node
// src/index.js — 统一入口，先后调用收藏下载和 MG 动画下载
import path from 'node:path';
import { downloadCollections } from './huasheng-download.js';
import { downloadMGAnimations } from './mg-download.js';
import {
  DEFAULT_OUT_DIR,
  DEFAULT_PROFILE_DIR,
  ensureDir,
  launchBrowser,
} from './shared.js';

const COLLECTION_URL = 'https://www.huasheng.cn/video/158889664548866';

function parseArgs(argv) {
  const args = {
    url: '',
    outDir: DEFAULT_OUT_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    slowMo: 80,
    mgOnly: false,
    // 收藏模式专用参数
    count: null,
    lastUrl: '',
    limitPerScene: 0,
    dryRun: false,
    tab: '收藏',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mg-only') args.mgOnly = true;
    else if (!arg.startsWith('--') && !args.url) args.url = arg;
    else if (arg === '--headless') args.headless = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--out') args.outDir = path.resolve(argv[++i]);
    else if (arg === '--profile') args.profileDir = path.resolve(argv[++i]);
    else if (arg === '--slow-mo') args.slowMo = Number(argv[++i]);
    else if (arg === '--count') args.count = Number(argv[++i]);
    else if (arg === '--last-url') args.lastUrl = argv[++i];
    else if (arg === '--limit') args.limitPerScene = Number(argv[++i]);
    else if (arg === '--tab') args.tab = argv[++i];
    else throw new Error(`未知参数: ${arg}`);
  }

  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) args.slowMo = 80;
  return args;
}

async function main() {
  const rawArgs = parseArgs(process.argv.slice(2));

  await ensureDir(rawArgs.outDir);

  const { context, page } = await launchBrowser({
    profileDir: rawArgs.profileDir,
    headless: rawArgs.headless,
    slowMo: rawArgs.slowMo,
  });

  try {
    if (!rawArgs.mgOnly) {
      // 阶段 1: 收藏下载（使用固定 URL）
      console.log('========================================');
      console.log('  阶段 1: 收藏视频下载');
      console.log('========================================');

      const collectionArgs = {
        url: COLLECTION_URL,
        outDir: rawArgs.outDir,
        profileDir: rawArgs.profileDir,
        headless: rawArgs.headless,
        slowMo: rawArgs.slowMo,
        count: rawArgs.count,
        lastUrl: rawArgs.lastUrl,
        limitPerScene: rawArgs.limitPerScene,
        dryRun: rawArgs.dryRun,
        tab: rawArgs.tab,
      };

      await downloadCollections(collectionArgs, { page, context });
    }

    if (rawArgs.url) {
      // 阶段 2: MG 动画下载（使用传入的 URL）
      console.log('\n========================================');
      console.log('  阶段 2: MG 动画下载');
      console.log('========================================');

      const mgArgs = {
        url: rawArgs.url,
        outDir: rawArgs.outDir,
        profileDir: rawArgs.profileDir,
        headless: rawArgs.headless,
        slowMo: rawArgs.slowMo,
        dryRun: rawArgs.dryRun,
        limit: rawArgs.limitPerScene,
      };

      await downloadMGAnimations({ page, context, args: mgArgs });
    }
  } finally {
    await context.close();
    console.log('\n========================================');
    console.log('  全部完成');
    console.log(`  输出目录: ${rawArgs.outDir}`);
    console.log('========================================');
  }
}

main().catch((error) => {
  console.error(`\n错误: ${error.message}`);
  process.exitCode = 1;
});
