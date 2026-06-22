import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isVideoProjectUrl,
  normalizeProjectUrl,
  normalizeScriptText,
  parseCreateArgs,
  readScriptText,
  runStepWithRetry,
} from '../src/huasheng-create.js';

test('parseCreateArgs parses txt path and browser options', () => {
  const args = parseCreateArgs([
    './input.txt',
    '--profile',
    './profile',
    '--headless',
    '--slow-mo',
    '120',
  ]);

  assert.equal(args.txtPath, path.resolve('./input.txt'));
  assert.equal(args.profileDir, path.resolve('./profile'));
  assert.equal(args.headless, true);
  assert.equal(args.slowMo, 120);
});

test('parseCreateArgs requires a txt path', () => {
  assert.throws(
    () => parseCreateArgs([]),
    /需要提供 TXT 文件路径/
  );
});

test('parseCreateArgs rejects unknown options', () => {
  assert.throws(
    () => parseCreateArgs(['./input.txt', '--wat']),
    /未知参数/
  );
});

test('normalizeScriptText trims outer whitespace and keeps inner lines', () => {
  assert.equal(
    normalizeScriptText('\n  第一段\n第二段  \n'),
    '第一段\n第二段'
  );
});

test('normalizeScriptText rejects empty content', () => {
  assert.throws(
    () => normalizeScriptText(' \n\t '),
    /TXT 文件内容为空/
  );
});

test('readScriptText reads UTF-8 text and normalizes it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'huasheng-create-'));
  const file = path.join(dir, 'script.txt');
  await fs.writeFile(file, '\n文案内容\n', 'utf8');

  assert.equal(await readScriptText(file), '文案内容');
});

test('isVideoProjectUrl accepts a huasheng clip=-1 project URL', () => {
  assert.equal(
    isVideoProjectUrl('https://www.huasheng.cn/video/164064789790827?clip=-1'),
    true
  );
});

test('isVideoProjectUrl rejects wrong host, path, or clip value', () => {
  assert.equal(isVideoProjectUrl('https://example.com/video/164064789790827?clip=-1'), false);
  assert.equal(isVideoProjectUrl('https://www.huasheng.cn/video/abc?clip=-1'), false);
  assert.equal(isVideoProjectUrl('https://www.huasheng.cn/video/164064789790827?clip=0'), false);
});

test('normalizeProjectUrl keeps the validated project URL', () => {
  assert.equal(
    normalizeProjectUrl('https://www.huasheng.cn/video/164064789790827?clip=-1'),
    'https://www.huasheng.cn/video/164064789790827?clip=-1'
  );
});

test('normalizeProjectUrl rejects an invalid URL', () => {
  assert.throws(
    () => normalizeProjectUrl('https://www.huasheng.cn/'),
    /不是有效的视频项目 URL/
  );
});

test('runStepWithRetry retries once and returns the second result', async () => {
  let attempts = 0;
  const result = await runStepWithRetry('测试步骤', async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('第一次失败');
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('runStepWithRetry reports the step after two failures', async () => {
  await assert.rejects(
    runStepWithRetry('点击创建', async () => {
      throw new Error('按钮不存在');
    }),
    /点击创建.*按钮不存在/
  );
});
