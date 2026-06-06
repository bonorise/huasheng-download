import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectionCardSignature,
  collectionCleanupQueue,
  materialSourceKey,
  materialUrlKey,
  pad2,
  sceneNumberFromUrl,
  sceneUrl,
  shouldUncollectMaterial,
} from '../src/huasheng-download.js';

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

test('materialSourceKey normalizes image and CSS background sources', () => {
  assert.equal(
    materialSourceKey('url("https://cdn.example.com/cover.jpg?token=abc")'),
    'https://cdn.example.com/cover.jpg'
  );
  assert.equal(
    materialSourceKey('https://cdn.example.com/cover.jpg?token=def'),
    'https://cdn.example.com/cover.jpg'
  );
});

test('collectionCardSignature keeps stable cover and card text features', () => {
  assert.deepEqual(
    collectionCardSignature({
      src: 'url("https://cdn.example.com/cover.jpg?token=abc")',
      cardText: ' 人物   空镜 ',
    }),
    {
      coverKey: 'https://cdn.example.com/cover.jpg',
      cardText: '人物 空镜',
    }
  );
});

test('shouldUncollectMaterial only selects successful collection downloads', () => {
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'downloaded', dryRun: false }), true);
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'failed', dryRun: false }), false);
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'dry-run', dryRun: true }), false);
  assert.equal(shouldUncollectMaterial({ tab: '推荐', status: 'downloaded', dryRun: false }), false);
});

test('collectionCleanupQueue only returns downloaded collection records', () => {
  const items = [
    { materialNumber: 1, status: 'downloaded' },
    { materialNumber: 2, status: 'failed' },
    { materialNumber: 3, status: 'dry-run' },
  ];

  assert.deepEqual(
    collectionCleanupQueue(items, { tab: '收藏', dryRun: false }),
    [items[0]]
  );
  assert.deepEqual(collectionCleanupQueue(items, { tab: '收藏', dryRun: true }), []);
  assert.deepEqual(collectionCleanupQueue(items, { tab: '推荐', dryRun: false }), []);
});
