# 收藏多轮下载安全修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复收藏多轮下载的文件覆盖、失败状态丢失和 `--limit` 重置问题。

**Architecture:** 启动时从输出目录计算收藏素材的下一全局编号，下载使用排他写入；主循环只记录成功下载的 URL key，并从 manifest 中持续重试未完成的取消收藏。收藏模式限制按本次运行的成功下载总数累计。

**Tech Stack:** Node.js ESM、`node:fs/promises`、Playwright、Node.js test runner

---

### Task 1: 编号和限制纯函数

**Files:**
- Modify: `src/huasheng-download.js`
- Test: `test/huasheng-download.test.js`

**Step 1: Write the failing test**

为以下行为增加测试：

```js
nextCollectionMaterialNumber([
  '素材01.mp4',
  '素材12.mp4',
  '分镜01_素材99.mp4',
]) === 13;

assignCollectionMaterialNumbers(
  [{ key: 'a' }, { key: 'b' }],
  13
).map((item) => item.materialNumber) deepEqual [13, 14];

remainingCollectionLimit(5, 2) === 3;
remainingCollectionLimit(0, 20) === 0;
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL，因为导出的辅助函数尚不存在。

**Step 3: Write minimal implementation**

实现并导出：

- `nextCollectionMaterialNumber(fileNames)`
- `assignCollectionMaterialNumbers(materials, startNumber)`
- `remainingCollectionLimit(limit, downloadedCount)`

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS。

### Task 2: 排他写入

**Files:**
- Modify: `src/huasheng-download.js`
- Test: `test/huasheng-download.test.js`

**Step 1: Write the failing test**

导出一个小型文件写入辅助函数，在临时目录预先创建 `素材01.mp4`，验证再次写入抛出 `EEXIST` 且原内容不变。

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL，因为辅助函数尚不存在。

**Step 3: Write minimal implementation**

使用：

```js
await fs.writeFile(filePath, body, { flag: 'wx' });
```

并让 `downloadMaterial` 调用该函数。

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS。

### Task 3: 修复收藏主循环

**Files:**
- Modify: `src/huasheng-download.js`
- Test: `test/huasheng-download.test.js`

**Step 1: Write the failing test**

增加状态辅助函数测试：

```js
successfulMaterialKeys(records)
```

只返回 `status === 'downloaded'` 的 `sourceKey`；下载失败记录不应进入集合。

验证 `collectionCleanupQueue`：

- `uncollected` 不入队。
- `failed` 与 `skipped` 的 downloaded 记录入队。

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL，因为成功 key 辅助函数不存在，或队列行为不完整。

**Step 3: Write minimal implementation**

- 启动收藏循环前读取输出目录并计算下一编号。
- 每轮剩余额度传入提取器。
- 过滤成功下载 key 后分配全局编号。
- `processMaterials` 返回本轮记录并保存 `sourceKey`。
- 仅把本轮成功记录加入 `downloadedVideoKeys`。
- 每轮都调用清理函数，再根据列表为空、达到上限或无进展决定退出。
- `EEXIST` 时收藏模式增加编号并重试，不覆盖已有文件。

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS。

### Task 4: 完整验证与文档

**Files:**
- Modify: `README.md`

**Step 1: Update documentation**

说明收藏模式：

- 多轮处理直到列表清空或达到总限制。
- 新文件从输出目录最大编号后继续。
- 已有文件永不覆盖。

**Step 2: Run verification**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: 全部通过。

**Step 3: Review diff**

Run:

```bash
git diff -- src/huasheng-download.js test/huasheng-download.test.js README.md
```

Expected: 仅包含本修复相关改动。

