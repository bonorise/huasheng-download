// test/mg-download.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { materialUrlKey, pad2 } from '../src/shared.js';
import { mgFilename } from '../src/mg-download.js';

test('mgFilename produces correct naming pattern', async () => {
  assert.equal(await mgFilename(1), 'MG动画_01.mp4');
  assert.equal(await mgFilename(5), 'MG动画_05.mp4');
  assert.equal(await mgFilename(12), 'MG动画_12.mp4');
});

test('materialUrlKey dedupes MG video URLs across signed params', () => {
  const url1 = 'https://jssz-boss.hdslb.com/aippt-recorder-oss/capture/prod/f3630c5e/output.mp4?token=abc';
  const url2 = 'https://jssz-boss.hdslb.com/aippt-recorder-oss/capture/prod/f3630c5e/output.mp4?token=xyz';
  assert.equal(materialUrlKey(url1), materialUrlKey(url2));
});

test('pad2 still works after refactoring', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(42), '42');
});
