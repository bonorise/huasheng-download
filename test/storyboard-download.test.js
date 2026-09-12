import test from 'node:test';
import assert from 'node:assert/strict';
import { storyboardNumber, storyboardFilename, validateStoryboardNumbers } from '../src/storyboard-download.js';
import { parseArgs } from '../src/huasheng-download.js';

test('分镜入口要求项目 URL，拒绝会改变下载范围的其他模式', () => {
  const url = 'https://www.huasheng.cn/video/229303396626434';
  assert.equal(parseArgs([url, '--storyboard']).storyboard, true);
  assert.throws(() => parseArgs(['--storyboard']), /必须提供/);
  for (const options of [['--tab', '推荐'], ['--uncollect-only'], ['--count', '1'], ['--limit', '2']]) {
    assert.throws(() => parseArgs([url, '--storyboard', ...options]), /不可/);
  }
  assert.equal(parseArgs([]).tab, '收藏');
});

test('按分镜数字排序且必须包含从 01 到总数的每一项', () => {
  assert.deepEqual(validateStoryboardNumbers([3, 1, 2], 3), [1, 2, 3]);
  assert.throws(() => validateStoryboardNumbers([1, 3], 3), /缺少：2/);
  assert.throws(() => validateStoryboardNumbers([1, 2, 3, 4], 3), /不完整/);
  assert.throws(() => validateStoryboardNumbers([], 0), /总数/);
});

test('严格读取分镜名称并保留源格式，不按素材序号命名', () => {
  assert.equal(storyboardNumber('分镜01'), 1);
  assert.equal(storyboardNumber('分镜 100'), 100);
  assert.equal(storyboardNumber('MG动画01'), 0);
  assert.equal(storyboardFilename(1, 'https://example.com/a.mp4?signature=x'), '分镜01.mp4');
  assert.equal(storyboardFilename(60, 'https://example.com/a.webm'), '分镜60.webm');
  assert.throws(() => storyboardFilename(1, 'https://example.com/a.html'), /格式/);
});
