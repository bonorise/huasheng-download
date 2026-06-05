import test from 'node:test';
import assert from 'node:assert/strict';
import { materialUrlKey, pad2, sceneNumberFromUrl, sceneUrl } from '../src/huasheng-download.js';

test('pad2 formats scene and material numbers', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(12), '12');
});

test('sceneUrl maps scene 1 to base URL without clip', () => {
  assert.equal(
    sceneUrl('https://www.huasheng.cn/video/158889664548866?clip=9', 1),
    'https://www.huasheng.cn/video/158889664548866'
  );
});

test('sceneUrl maps scene number to clip query', () => {
  assert.equal(
    sceneUrl('https://www.huasheng.cn/video/158889664548866', 3),
    'https://www.huasheng.cn/video/158889664548866?clip=2'
  );
});

test('sceneNumberFromUrl maps clip query to one-based scene number', () => {
  assert.equal(sceneNumberFromUrl('https://www.huasheng.cn/video/158889664548866'), 1);
  assert.equal(sceneNumberFromUrl('https://www.huasheng.cn/video/158889664548866?clip=1'), 2);
});

test('materialUrlKey ignores temporary signed query parameters', () => {
  assert.equal(
    materialUrlKey('https://boss.hdslb.com/a/b/video.mp4?X-Amz-Date=1&X-Amz-Signature=abc'),
    'https://boss.hdslb.com/a/b/video.mp4'
  );
});
