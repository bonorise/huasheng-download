import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assignCollectionMaterialNumbers,
  collectionCardSignature,
  collectionApiPageCount,
  collectionApiVideosToMaterials,
  collectionCleanupQueue,
  collectionCleanupScope,
  favoriteMutationUrl,
  favoriteUncollectPayload,
  markCollectionLedgerUncollected,
  collectionMaterialsForPass,
  mergeCollectionLedgerItems,
  materialSourceKey,
  materialCandidateKey,
  materialUrlKey,
  nextCollectionMaterialNumber,
  pad2,
  remainingCollectionLimit,
  selectScrollableTarget,
  sceneNumberFromUrl,
  sceneUrl,
  shouldUncollectMaterial,
  shouldContinueCollectionLoop,
  shouldCleanupCollections,
  shouldCountEmptyMaterialScroll,
  successfulMaterialKeys,
  writeCollectionVideo,
  writeFileExclusive,
} from '../src/huasheng-download.js';

test('收藏清理只能在全部下载阶段结束后启动', () => {
  assert.equal(shouldCleanupCollections({
    tab: '收藏',
    dryRun: false,
    noUncollect: false,
    downloadPhaseComplete: false,
  }), false);
  assert.equal(shouldCleanupCollections({
    tab: '收藏',
    dryRun: false,
    noUncollect: false,
    downloadPhaseComplete: true,
  }), true);
  assert.equal(shouldCleanupCollections({
    tab: '收藏',
    dryRun: true,
    noUncollect: false,
    downloadPhaseComplete: true,
  }), false);
  assert.equal(shouldCleanupCollections({
    tab: '收藏',
    dryRun: false,
    noUncollect: true,
    downloadPhaseComplete: true,
  }), false);
});

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

test('虚拟列表中同一素材移动位置后仍视为同一候选', () => {
  assert.equal(
    materialCandidateKey({ src: 'https://cdn.example.com/a.jpg?token=1', cardText: ' 人物  空镜 ' }),
    materialCandidateKey({ src: 'https://cdn.example.com/a.jpg?token=2', cardText: '人物 空镜' })
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

test('取消收藏只限于本次扫描到的素材', () => {
  const current = [{ key: 'current' }];
  const ledger = [{ sourceKey: 'old' }, { sourceKey: 'current' }];
  assert.deepEqual(collectionCleanupScope(ledger, current), [ledger[1]]);
});

test('收藏永久台账保留旧下载，并更新同一素材的取消状态', () => {
  const oldItem = {
    sourceKey: 'https://cdn.example.com/old.mp4',
    status: 'downloaded',
    uncollectStatus: 'failed',
    collectionCard: { coverKey: 'old-cover', cardText: '旧素材' },
  };
  const updatedItem = {
    ...oldItem,
    uncollectStatus: 'uncollected',
  };
  const nextItem = {
    sourceKey: 'https://cdn.example.com/new.mp4',
    status: 'downloaded',
    uncollectStatus: 'skipped',
    collectionCard: { coverKey: 'new-cover', cardText: '新素材' },
  };

  const merged = mergeCollectionLedgerItems([oldItem], [updatedItem, nextItem]);

  assert.deepEqual(merged, [updatedItem, nextItem]);
  assert.deepEqual(
    collectionCleanupQueue(merged, { tab: '收藏', dryRun: false }),
    [nextItem]
  );
});

test('优先选择实际可滚动的 InfiniteList 容器', () => {
  assert.equal(selectScrollableTarget([
    { id: '旧素材容器', scrollHeight: 480, clientHeight: 480 },
    { id: 'InfiniteList', scrollHeight: 2400, clientHeight: 480 },
  ]), 'InfiniteList');
  assert.equal(selectScrollableTarget([
    { id: '首屏', scrollHeight: 480, clientHeight: 480 },
  ]), '首屏');
});

test('虚拟收藏列表未到真实底部时，假空滚动不能结束完整扫描', () => {
  assert.equal(shouldCountEmptyMaterialScroll({
    newVideosThisPass: 0,
    before: 995,
    after: 995,
    max: 1742,
  }), false);
  assert.equal(shouldCountEmptyMaterialScroll({
    newVideosThisPass: 0,
    before: 1742,
    after: 1742,
    max: 1742,
  }), true);
  assert.equal(shouldCountEmptyMaterialScroll({
    newVideosThisPass: 1,
    before: 1742,
    after: 1742,
    max: 1742,
  }), false);
});

test('收藏接口按 200 条分页，并直接产出可下载素材', () => {
  assert.equal(collectionApiPageCount(203, 200), 2);
  assert.equal(collectionApiPageCount(0, 200), 0);
  assert.deepEqual(
    collectionApiVideosToMaterials([
      {
        id: 'video-id',
        cover: 'https://cdn.example.com/cover.jpg?token=abc',
        url: 'https://cdn.example.com/video.mp4?signature=abc',
      },
    ]).map((item) => ({
      key: item.key,
      url: item.url,
      collectionCard: item.collectionCard,
    })),
    [{
      key: 'https://cdn.example.com/video.mp4',
      url: 'https://cdn.example.com/video.mp4?signature=abc',
      collectionCard: { coverKey: 'https://cdn.example.com/cover.jpg', cardText: '' },
    }]
  );
});

test('取消收藏接口沿用收藏列表签名参数，但不携带分页和项目参数', () => {
  const mutationUrl = new URL(favoriteMutationUrl(
    'https://www.huasheng.cn/api/innovideo/clip/video/favorite?clip_id=42&ps=200&pn=2&_ra=abc&_bs=def&_fv=ghi',
    'csrf-token'
  ));

  assert.equal(mutationUrl.pathname, '/api/innovideo/clip/video/fav');
  assert.equal(mutationUrl.searchParams.get('_ra'), 'abc');
  assert.equal(mutationUrl.searchParams.get('_bs'), 'def');
  assert.equal(mutationUrl.searchParams.get('_fv'), 'ghi');
  assert.equal(mutationUrl.searchParams.get('csrf'), 'csrf-token');
  assert.equal(mutationUrl.searchParams.has('clip_id'), false);
  assert.equal(mutationUrl.searchParams.has('ps'), false);
  assert.equal(mutationUrl.searchParams.has('pn'), false);
});

test('取消收藏请求使用视频 ID，并明确设置 fav=0', () => {
  assert.deepEqual(favoriteUncollectPayload('video-uuid'), {
    clip_uuid: 'video-uuid',
    fav: 0,
    is_revoke: false,
  });
});

test('服务端收藏列表清空后，永久台账全部标记为已取消', () => {
  const ledger = {
    items: [
      { sourceKey: 'a', status: 'downloaded', uncollectStatus: 'failed', uncollectError: '旧错误' },
      { sourceKey: 'b', status: 'downloaded', uncollectStatus: 'skipped' },
      { sourceKey: 'c', status: 'failed', uncollectStatus: 'skipped' },
    ],
  };

  assert.equal(markCollectionLedgerUncollected(ledger), 2);
  assert.deepEqual(ledger.items, [
    { sourceKey: 'a', status: 'downloaded', uncollectStatus: 'uncollected' },
    { sourceKey: 'b', status: 'downloaded', uncollectStatus: 'uncollected' },
    { sourceKey: 'c', status: 'failed', uncollectStatus: 'skipped' },
  ]);
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

test('收藏页只执行一次完整提取，不因下载成功或失败重新扫描', () => {
  assert.equal(shouldContinueCollectionLoop({
    successfulDownloadCount: 0,
    uncollectedCount: 1,
    hasRetryableVisibleMaterial: false,
  }), false);
  assert.equal(shouldContinueCollectionLoop({
    successfulDownloadCount: 0,
    uncollectedCount: 0,
    hasRetryableVisibleMaterial: true,
  }), false);
  assert.equal(shouldContinueCollectionLoop({
    successfulDownloadCount: 0,
    uncollectedCount: 0,
    hasRetryableVisibleMaterial: false,
  }), false);
});
