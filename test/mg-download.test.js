import test from 'node:test';
import assert from 'node:assert/strict';
import { mgFilename, pad2 } from '../src/mg-download.js';

test('mgFilename produces naming pattern based on mimeType', () => {
  assert.equal(mgFilename(1), 'MG动画_01.mp4'); // 默认非 webm → mp4
  assert.equal(mgFilename(1, 'video/webm'), 'MG动画_01.webm');
  assert.equal(mgFilename(5, 'video/mp4'), 'MG动画_05.mp4');
  assert.equal(mgFilename(12, 'video/webm'), 'MG动画_12.webm');
});

test('pad2 still works for MG numbering', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(42), '42');
});
