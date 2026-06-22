import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assignCollectionMaterialNumbers,
  collectionCardSignature,
  collectionCleanupQueue,
  collectionMaterialsForPass,
  materialSourceKey,
  materialUrlKey,
  nextCollectionMaterialNumber,
  pad2,
  remainingCollectionLimit,
  sceneNumberFromUrl,
  sceneUrl,
  shouldUncollectMaterial,
  shouldContinueCollectionLoop,
  successfulMaterialKeys,
  writeCollectionVideo,
  writeFileExclusive,
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
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'downloaded', dryRun: false, uncollectStatus: 'skipped' }), true);
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'failed', dryRun: false, uncollectStatus: 'skipped' }), false);
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'dry-run', dryRun: true, uncollectStatus: 'skipped' }), false);
  assert.equal(shouldUncollectMaterial({ tab: '推荐', status: 'downloaded', dryRun: false, uncollectStatus: 'skipped' }), false);
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'downloaded', dryRun: false, uncollectStatus: 'uncollected' }), false);
});

test('collectionCleanupQueue only returns downloaded collection records', () => {
  const items = [
    { materialNumber: 1, status: 'downloaded' },
    { materialNumber: 2, status: 'failed' },
    { materialNumber: 3, status: 'dry-run' },
    { materialNumber: 4, status: 'downloaded', uncollectStatus: 'uncollected' },
    { materialNumber: 5, status: 'downloaded', uncollectStatus: 'failed' },
  ];

  assert.deepEqual(
    collectionCleanupQueue(items, { tab: '收藏', dryRun: false }),
    [items[0], items[4]]
  );
  assert.deepEqual(collectionCleanupQueue(items, { tab: '收藏', dryRun: true }), []);
  assert.deepEqual(collectionCleanupQueue(items, { tab: '推荐', dryRun: false }), []);
});

test('nextCollectionMaterialNumber continues after the largest existing collection file', () => {
  assert.equal(nextCollectionMaterialNumber([
    '素材01.mp4',
    '素材12.mp4',
    '分镜01_素材99.mp4',
    '素材03.mov',
    'notes.txt',
  ]), 13);
  assert.equal(nextCollectionMaterialNumber([]), 1);
});

test('assignCollectionMaterialNumbers uses one sequence across extraction passes', () => {
  assert.deepEqual(
    assignCollectionMaterialNumbers([{ key: 'a' }, { key: 'b' }], 13)
      .map((item) => item.materialNumber),
    [13, 14]
  );
});

test('remainingCollectionLimit treats collection limit as a whole-run limit', () => {
  assert.equal(remainingCollectionLimit(5, 2), 3);
  assert.equal(remainingCollectionLimit(5, 5), 0);
  assert.equal(remainingCollectionLimit(0, 20), 0);
});

test('successfulMaterialKeys excludes failed downloads', () => {
  assert.deepEqual(
    Array.from(successfulMaterialKeys([
      { status: 'downloaded', sourceKey: 'a' },
      { status: 'failed', sourceKey: 'b' },
      { status: 'downloaded', sourceKey: 'c' },
    ])),
    ['a', 'c']
  );
});

test('writeFileExclusive never overwrites an existing video', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'huasheng-download-'));
  const filePath = path.join(dir, '素材01.mp4');
  try {
    await fs.writeFile(filePath, 'existing');
    await assert.rejects(
      writeFileExclusive(filePath, Buffer.from('replacement')),
      { code: 'EEXIST' }
    );
    assert.equal(await fs.readFile(filePath, 'utf8'), 'existing');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('writeCollectionVideo advances to the next number when a file appears', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'huasheng-download-'));
  try {
    await fs.writeFile(path.join(dir, '素材13.mp4'), 'existing');
    const result = await writeCollectionVideo(dir, Buffer.from('new'), 13);

    assert.equal(result.materialNumber, 14);
    assert.equal(result.filename, '素材14.mp4');
    assert.equal(await fs.readFile(path.join(dir, '素材13.mp4'), 'utf8'), 'existing');
    assert.equal(await fs.readFile(path.join(dir, '素材14.mp4'), 'utf8'), 'new');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('collectionMaterialsForPass retries failures without repeating successful downloads', () => {
  const materials = [{ key: 'downloaded' }, { key: 'retry' }, { key: 'exhausted' }, { key: 'later' }];
  const selected = collectionMaterialsForPass(materials, {
    downloadedVideoKeys: new Set(['downloaded']),
    downloadAttempts: new Map([['retry', 1], ['exhausted', 2]]),
    maxAttempts: 2,
    limit: 1,
  });

  assert.deepEqual(selected, [materials[1]]);
});

test('shouldContinueCollectionLoop treats successful uncollect as progress', () => {
  assert.equal(shouldContinueCollectionLoop({
    successfulDownloadCount: 0,
    uncollectedCount: 1,
    hasRetryableVisibleMaterial: false,
  }), true);
  assert.equal(shouldContinueCollectionLoop({
    successfulDownloadCount: 0,
    uncollectedCount: 0,
    hasRetryableVisibleMaterial: true,
  }), true);
  assert.equal(shouldContinueCollectionLoop({
    successfulDownloadCount: 0,
    uncollectedCount: 0,
    hasRetryableVisibleMaterial: false,
  }), false);
});
