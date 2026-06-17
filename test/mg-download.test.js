import test from 'node:test';
import assert from 'node:assert/strict';
import { mgFilename, pad2 } from '../src/mg-download.js';

test('mgFilename produces webm naming pattern', () => {
  assert.equal(mgFilename(1), 'MG动画_01.webm');
  assert.equal(mgFilename(5), 'MG动画_05.webm');
  assert.equal(mgFilename(12), 'MG动画_12.webm');
});

test('pad2 still works for MG numbering', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(42), '42');
});
