# 收藏素材下载后自动取消收藏 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 收藏模式下先完成全部素材下载，再由独立后处理模块批量取消本轮成功下载素材的收藏；下载失败和 `--dry-run` 不修改收藏状态。

**Architecture:** 保留现有“先提取全部 URL，再统一下载”的结构，并把取消收藏实现为下载完成后的独立后处理器。下载模块只负责更新 manifest 的下载状态；它完全结束后，后处理器从本次 manifest 中筛选 `downloaded` 条目形成清理队列，再从列表顶部滚动查找匹配卡片、点击卡片内部星标并确认卡片消失。匹配不唯一、定位失败或确认失败时只记录取消收藏失败，不改变下载结果。

**Tech Stack:** Node.js ESM、Playwright、`node:test`、`node:assert/strict`

---

### Task 1: 增加卡片签名和取消收藏决策的纯函数

**Files:**
- Modify: `src/huasheng-download.js:13-121`
- Test: `test/huasheng-download.test.js`

**Step 1: 写失败测试**

扩展测试导入：

```js
import {
  materialSourceKey,
  materialUrlKey,
  pad2,
  sceneNumberFromUrl,
  sceneUrl,
  shouldUncollectMaterial,
} from '../src/huasheng-download.js';
```

增加以下测试：

```js
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

test('shouldUncollectMaterial only selects successful collection downloads', () => {
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'downloaded', dryRun: false }), true);
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'failed', dryRun: false }), false);
  assert.equal(shouldUncollectMaterial({ tab: '收藏', status: 'dry-run', dryRun: true }), false);
  assert.equal(shouldUncollectMaterial({ tab: '推荐', status: 'downloaded', dryRun: false }), false);
});
```

**Step 2: 运行测试并确认失败**

Run:

```bash
npm test
```

Expected: FAIL，提示 `materialSourceKey` 或 `shouldUncollectMaterial` 未导出。

**Step 3: 实现最小纯函数**

在选择器常量附近增加：

```js
const COLLECT_ICON_SELECTOR = '[class*="ClipChoiceItem_collectIconWrap__"]';
```

在 `materialUrlKey` 附近增加并导出：

```js
export function materialSourceKey(rawSource) {
  const source = String(rawSource || '')
    .trim()
    .replace(/^url\((['"]?)(.*?)\1\)$/i, '$2');
  return materialUrlKey(source);
}

export function shouldUncollectMaterial({ tab, status, dryRun }) {
  return tab === '收藏' && status === 'downloaded' && !dryRun;
}
```

**Step 4: 运行测试和语法检查**

Run:

```bash
npm test
npm run check
```

Expected: 全部 PASS，语法检查退出码为 0。

**Step 5: 提交**

```bash
git add src/huasheng-download.js test/huasheng-download.test.js
git commit -m "test: cover collection cleanup decisions"
```

### Task 2: 提取阶段保存可重新定位的收藏卡片签名

**Files:**
- Modify: `src/huasheng-download.js:245-289`
- Modify: `src/huasheng-download.js:425-468`
- Test: `test/huasheng-download.test.js`

**Step 1: 写失败测试**

增加签名构造函数的测试：

```js
test('collectionCardSignature keeps stable cover and card text features', () => {
  assert.deepEqual(
    collectionCardSignature({
      src: 'url("https://cdn.example.com/cover.jpg?token=abc")',
      cardText: '人物 空镜',
    }),
    {
      coverKey: 'https://cdn.example.com/cover.jpg',
      cardText: '人物 空镜',
    }
  );
});
```

同时把 `collectionCardSignature` 加入测试导入。

**Step 2: 运行测试并确认失败**

Run:

```bash
npm test
```

Expected: FAIL，提示 `collectionCardSignature` 未导出。

**Step 3: 实现签名构造函数**

在纯函数区域增加：

```js
export function collectionCardSignature({ src, cardText = '' }) {
  return {
    coverKey: materialSourceKey(src),
    cardText: String(cardText).replace(/\s+/g, ' ').trim(),
  };
}
```

**Step 4: 扩展候选标记**

在 `markVisibleMaterialCandidates` 的浏览器端循环中：

1. 使用 `el.closest()` 逐层寻找包含 `COLLECT_ICON_SELECTOR` 的最近祖先卡片。
2. 给卡片设置 `data-hs-collection-card-id` 临时标识。
3. 在候选对象中增加 `cardId` 和规范化前的 `cardText`。
4. 推荐 tab 中找不到收藏星标时允许 `cardId` 为空，保持推荐模式兼容。

调用 `page.evaluate` 时把 `collectIconSelector: COLLECT_ICON_SELECTOR` 一并传入，避免在浏览器回调内硬编码类名。

候选结果形状应包含：

```js
{
  id,
  key,
  tag,
  src,
  cardId,
  cardText,
  x,
  y,
  width,
  height,
}
```

**Step 5: 收藏素材记录保存签名**

给 `extractVisibleMaterials` 增加 `includeCollectionSignature = false` 参数。收藏模式调用时传 `true`，推荐模式保持默认值。

在 `materials.push()` 中仅为收藏素材增加：

```js
collectionCard: includeCollectionSignature
  ? collectionCardSignature(candidate)
  : undefined,
```

如果收藏候选没有找到卡片或 `coverKey` 为空，仍允许下载，但后续取消收藏应明确失败，不进行不确定点击。

**Step 6: 运行测试和语法检查**

Run:

```bash
npm test
npm run check
```

Expected: 全部 PASS。

**Step 7: 提交**

```bash
git add src/huasheng-download.js test/huasheng-download.test.js
git commit -m "feat: retain collection card signatures"
```

### Task 3: 实现滚动定位和取消收藏交互

**Files:**
- Modify: `src/huasheng-download.js:228-364`

**Step 1: 增加收藏列表恢复函数**

提取 `openCollectionMaterialList(page, args)`，负责：

```js
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await openMaterialPanel(page);
await selectMaterialTab(page, '收藏');
await materialContainer(page);
```

`extractCollectionMaterials` 复用该函数。登录检测仍保留在首次打开流程中，恢复动作不重复要求用户登录。

**Step 2: 实现单屏匹配函数**

增加 `findCollectionCardOnCurrentView(page, signature)`：

1. 仅在 `MATERIAL_CONTAINER_SELECTOR` 内查询包含 `COLLECT_ICON_SELECTOR` 的卡片。
2. 从卡片内的 `img`、背景图元素或 `video` 读取封面资源。
3. 使用与 `materialSourceKey` 相同的 URL 规范化规则匹配 `signature.coverKey`。
4. 封面相同且 `signature.cardText` 非空时，再比较规范化文本。
5. 返回匹配卡片的临时 `data-hs-collection-card-id`。
6. 如果当前视口匹配超过一个，抛出“收藏卡片匹配不唯一”，不点击任何元素。

浏览器端只返回匹配数量和临时 ID，Node 端负责决定是否继续滚动。

**Step 3: 实现跨懒加载列表查找**

增加 `findCollectionCard(page, signature)`：

1. 验证 `signature.coverKey` 非空，否则抛出“收藏素材缺少封面定位特征”。
2. 将素材容器 `scrollTop` 重置为 0，并等待 300ms。
3. 调用 `findCollectionCardOnCurrentView`。
4. 未找到时按现有滚动步长向下滚动并等待 300ms。
5. 到达列表底部后再检查一次；仍未找到则抛出“未找到对应收藏卡片”。
6. 设置最大滚动轮数，例如 100，避免页面异常时无限循环。

**Step 4: 实现点击与确认**

增加 `uncollectMaterial(page, item)`：

```js
async function uncollectMaterial(page, item) {
  const card = await findCollectionCard(page, item.collectionCard);
  const icon = card.locator(COLLECT_ICON_SELECTOR).first();
  const visible = await icon.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible) throw new Error('对应收藏卡片未找到星标按钮');

  await icon.click({ timeout: 3000 });
  await card.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  const remaining = await findCollectionCardOnCurrentView(page, item.collectionCard);
  if (remaining.matchCount > 0) {
    throw new Error('点击星标后收藏卡片仍然存在');
  }
}
```

确认逻辑需要同时兼容 DOM 节点被直接移除和列表整体重渲染。不得使用页面中的第一个星标作为后备点击目标。

**Step 5: 增加一次恢复重试**

实现 `uncollectMaterialWithRecovery(page, item, args)`：

1. 首次调用 `uncollectMaterial`。
2. 失败后调用 `openCollectionMaterialList(page, args)` 恢复收藏列表。
3. 再尝试一次。
4. 第二次失败时抛出包含两次失败上下文的错误。

只有定位、点击或确认失败时才重试；点击后已经确认卡片消失时不得重复操作。

**Step 6: 运行静态验证**

Run:

```bash
npm test
npm run check
```

Expected: 全部 PASS，语法检查退出码为 0。

**Step 7: 提交**

```bash
git add src/huasheng-download.js
git commit -m "feat: locate and uncollect material cards"
```

### Task 4: 建立独立的下载后取消收藏阶段

**Files:**
- Modify: `src/huasheng-download.js:589-685`
- Test: `test/huasheng-download.test.js`

**Step 1: 保持下载处理器职责单一**

`processMaterials` 不接收 page、取消收藏回调或星标相关参数。它继续只负责：

- 下载每条素材。
- 设置 `status`、文件路径和字节数。
- 记录下载失败。
- 将每条结果写入 manifest。

不得在 `downloadMaterial` 成功后立即点击星标。

**Step 2: 初始化收藏清理状态**

仅在 `args.tab === '收藏'` 时给 record 增加：

```js
uncollectStatus: 'skipped',
```

推荐模式的 manifest 结构保持不变。

**Step 3: 实现取消收藏队列构造函数**

增加并导出纯函数：

```js
export function collectionCleanupQueue(items, { tab, dryRun }) {
  if (tab !== '收藏' || dryRun) return [];
  return items.filter((item) => shouldUncollectMaterial({
    tab,
    status: item.status,
    dryRun,
  }));
}
```

在测试中增加：

```js
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
  assert.deepEqual(
    collectionCleanupQueue(items, { tab: '收藏', dryRun: true }),
    []
  );
  assert.deepEqual(
    collectionCleanupQueue(items, { tab: '推荐', dryRun: false }),
    []
  );
});
```

先运行 `npm test` 确认失败，再实现函数并确认通过。

**Step 4: 实现独立后处理器**

增加：

```js
async function cleanupDownloadedCollections({
  page,
  args,
  manifest,
  failures,
  manifestPath,
  failuresPath,
}) {
  const queue = collectionCleanupQueue(manifest.items, {
    tab: args.tab,
    dryRun: args.dryRun,
  });

  if (!queue.length) return;

  await openCollectionMaterialList(page, args);

  for (const record of queue) {
    try {
      await uncollectMaterialWithRecovery(page, record, args);
      record.uncollectStatus = 'uncollected';
      console.log(`[收藏] 已取消收藏 素材${pad2(record.materialNumber)}`);
    } catch (error) {
      record.uncollectStatus = 'failed';
      record.uncollectError = error.message;
      failures.push({
        ...record,
        failureType: 'uncollect',
        reason: error.message,
      });
      console.warn(`[收藏] 取消收藏失败 素材${pad2(record.materialNumber)}: ${error.message}`);
    }

    await writeJson(manifestPath, manifest);
    await writeJson(failuresPath, failures);
  }
}
```

提取阶段保存的 `collectionCard` 必须复制到 manifest record，确保后处理器只依赖 manifest 条目，不依赖下载函数内部的 item 对象。

**Step 5: 在收藏下载全部结束后调用后处理器**

收藏模式主流程必须严格按以下顺序：

```js
const materials = await extractCollectionMaterials(page, args);

await processMaterials({
  materials,
  context,
  args,
  manifest,
  failures,
  manifestPath,
  failuresPath,
  referer: args.url,
  label: '收藏',
});

await writeJson(manifestPath, manifest);

await cleanupDownloadedCollections({
  page,
  args,
  manifest,
  failures,
  manifestPath,
  failuresPath,
});
```

推荐模式不得调用 `cleanupDownloadedCollections`。

约束：

- `processMaterials` 完整处理完所有收藏素材后，才能进入后处理器。
- 下载失败时保持 `uncollectStatus: "skipped"`。
- `--dry-run` 时整个后处理器直接返回。
- 取消收藏失败不能把成功下载记录改成 `failed`。
- 取消收藏模块异常不能回滚、删除或覆盖已下载文件。

**Step 6: 增加汇总字段**

收藏模式下在 `manifest.summary` 增加：

```js
uncollected: manifest.items.filter((item) => item.uncollectStatus === 'uncollected').length,
uncollectFailed: manifest.items.filter((item) => item.uncollectStatus === 'failed').length,
```

**Step 7: 运行测试和语法检查**

Run:

```bash
npm test
npm run check
```

Expected: 全部 PASS。

**Step 8: 提交**

```bash
git add src/huasheng-download.js test/huasheng-download.test.js
git commit -m "feat: uncollect successfully downloaded materials"
```

### Task 5: 更新使用说明

**Files:**
- Modify: `README.md:18-27`
- Modify: `README.md:63-66`

**Step 1: 说明默认行为**

在收藏模式说明中明确：

```markdown
默认会点击“收藏”tab，不按分镜循环。脚本会先完成本轮全部下载，再批量取消成功下载素材的收藏，避免下次重复下载。下载失败或使用 `--dry-run` 时会保留收藏。
```

**Step 2: 说明清单字段**

在输出说明中补充：

```markdown
收藏模式的每条记录还包含 `uncollectStatus`，用于区分 `uncollected`、`failed` 和 `skipped`。
```

**Step 3: 检查文档差异**

Run:

```bash
git diff --check
git diff -- README.md
```

Expected: 无空白错误，文档准确描述实际行为。

**Step 4: 提交**

```bash
git add README.md
git commit -m "docs: explain collection cleanup behavior"
```

### Task 6: 完整验证

**Files:**
- Verify: `src/huasheng-download.js`
- Verify: `test/huasheng-download.test.js`
- Verify: `README.md`
- Verify output: `/Users/liubo/Desktop/hs-src/manifest.json`
- Verify output: `/Users/liubo/Desktop/hs-src/failures.json`

**Step 1: 运行自动化检查**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: 所有命令成功。

**Step 2: 验证 dry-run 不取消收藏**

先在收藏 tab 准备至少两个素材，然后运行：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --limit 2 --dry-run
```

Expected:

- 两个素材仍保留在收藏 tab。
- manifest 中两条记录的 `status` 为 `dry-run`。
- 两条记录的 `uncollectStatus` 为 `skipped`。

**Step 3: 验证全部下载结束后再取消收藏**

运行：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --limit 2
```

Expected:

- 两个文件成功写入 `/Users/liubo/Desktop/hs-src`。
- 日志先连续出现全部“已下载”记录，之后才出现“已取消收藏”记录。
- 对应卡片随后从收藏 tab 消失。
- manifest 中 `status` 为 `downloaded`。
- manifest 中 `uncollectStatus` 为 `uncollected`。

**Step 4: 验证下载失败保留收藏**

使用临时不可写输出目录或在调试环境中让一次 `downloadMaterial` 抛错，确保不更改已有文件权限或用户数据。运行后确认：

- 对应素材仍保留在收藏 tab。
- manifest 中 `status` 为 `failed`。
- `uncollectStatus` 为 `skipped`。

**Step 5: 验证推荐模式不点击星标**

运行：

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --tab 推荐 --count 1 --limit 1 --dry-run
```

Expected:

- 推荐素材提取行为保持不变。
- 不发生收藏星标点击。
- 推荐模式 manifest 记录不增加 `uncollectStatus`。

**Step 6: 检查最终工作区**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: 只保留实施前已存在且与本功能无关的未跟踪文件；功能提交按任务清晰分离。
