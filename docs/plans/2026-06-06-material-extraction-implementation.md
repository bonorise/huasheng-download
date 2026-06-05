# Stable Material Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Huasheng material extraction reliable across two-column and three-column layouts by scanning the recommendation container, collecting each material URL, and closing the playback modal before continuing.

**Architecture:** Refactor `src/huasheng-download.js` so material extraction is container-driven instead of broad right-panel scanning. The extraction loop will collect visible cards from `.ClipChoiceList_contentWrap__Ii6jf`, click one card at a time, capture `.mp4` URLs from `video[src]` with network fallback, close the modal through `button[aria-label="关闭"]`, then verify the modal disappeared before moving on.

**Tech Stack:** Node.js 22, Playwright 1.58, built-in `node:test`, built-in `assert`.

---

### Task 1: Add Test Harness For Pure Helpers

**Files:**
- Modify: `package.json`
- Create: `test/huasheng-download.test.js`
- Modify: `src/huasheng-download.js`

**Step 1: Export pure helpers**

In `src/huasheng-download.js`, export existing pure helpers without changing behavior:

```js
export function sceneUrl(baseUrl, sceneNumber) { ... }
export function sceneNumberFromUrl(rawUrl) { ... }
export function pad2(number) { ... }
```

Guard `main()` so importing the file in tests does not run the CLI:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
```

**Step 2: Add test script**

Update `package.json`:

```json
{
  "scripts": {
    "download": "node ./src/huasheng-download.js",
    "check": "node --check ./src/huasheng-download.js",
    "test": "node --test"
  }
}
```

**Step 3: Write helper tests**

Create `test/huasheng-download.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pad2, sceneNumberFromUrl, sceneUrl } from '../src/huasheng-download.js';

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
```

**Step 4: Run tests**

Run:

```bash
npm test
npm run check
```

Expected: all tests pass and syntax check passes.

**Step 5: Commit**

```bash
git add package.json src/huasheng-download.js test/huasheng-download.test.js
git commit -m "test: add downloader helper coverage"
```

### Task 2: Add Recommendation Container Locator

**Files:**
- Modify: `src/huasheng-download.js`

**Step 1: Add selector constants**

Near the existing constants:

```js
const MATERIAL_CONTAINER_SELECTOR = '.ClipChoiceList_contentWrap__Ii6jf';
const MODAL_CLOSE_SELECTOR = 'button[aria-label="关闭"]';
```

**Step 2: Add locator helper**

Add:

```js
async function materialContainer(page) {
  const container = page.locator(MATERIAL_CONTAINER_SELECTOR).first();
  const visible = await container.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    throw new Error(`未找到推荐素材容器: ${MATERIAL_CONTAINER_SELECTOR}`);
  }
  return container;
}
```

**Step 3: Use it after opening panel**

In `extractSceneMaterials`, after `openMaterialPanel(page)`, call:

```js
await materialContainer(page);
```

Expected behavior: if the panel opens but the recommendation container is absent, the scene fails with a clear message.

**Step 4: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/huasheng-download.js
git commit -m "feat: locate huasheng material container"
```

### Task 3: Replace Broad Candidate Scan With Container Card Scan

**Files:**
- Modify: `src/huasheng-download.js`

**Step 1: Replace `markVisibleMaterialCandidates`**

Change the function to scan only inside `.ClipChoiceList_contentWrap__Ii6jf`.

Implementation shape:

```js
async function markVisibleMaterialCandidates(page, seenKeys) {
  return page.evaluate(({ selector, seen }) => {
    const container = document.querySelector(selector);
    if (!container) return [];

    const seenSet = new Set(seen);
    const containerRect = container.getBoundingClientRect();
    const rawElements = Array.from(container.querySelectorAll('img, [style*="background-image"], video, canvas'));
    const candidates = [];

    function visibleRect(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
      if (rect.width < 48 || rect.height < 48) return null;
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) return null;
      if (rect.right <= containerRect.left || rect.left >= containerRect.right) return null;
      return rect;
    }

    for (const el of rawElements) {
      const rect = visibleRect(el);
      if (!rect) continue;
      const style = window.getComputedStyle(el);
      const src = el.currentSrc || el.src || style.backgroundImage || '';
      const key = `${src}|${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (seenSet.has(key)) continue;
      const id = `hs_candidate_${Date.now()}_${candidates.length}`;
      el.setAttribute('data-hs-candidate-id', id);
      candidates.push({
        id,
        key,
        tag: el.tagName.toLowerCase(),
        src,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return candidates;
  }, { selector: MATERIAL_CONTAINER_SELECTOR, seen: Array.from(seenKeys) });
}
```

**Step 2: Remove viewport column assumptions**

Delete logic that filters candidates with right-panel assumptions such as:

```js
if (rect.left < viewportW * 0.35) continue;
if (rect.width > viewportW * 0.65 || rect.height > viewportH * 0.75) continue;
```

**Step 3: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: pass.

**Step 4: Commit**

```bash
git add src/huasheng-download.js
git commit -m "feat: scan material cards within recommendation container"
```

### Task 4: Add DOM-First And Network-Fallback URL Capture

**Files:**
- Modify: `src/huasheng-download.js`

**Step 1: Add network wait helper**

Add:

```js
function waitForMp4Response(page, timeout = 6000) {
  return page.waitForResponse((response) => {
    const url = response.url();
    return /\.mp4(\?|$)/.test(url) && response.status() < 500;
  }, { timeout }).then((response) => response.url()).catch(() => '');
}
```

**Step 2: Add modal video wait helper**

Add:

```js
async function waitForModalVideoUrl(page, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const sources = await visibleVideoSources(page);
    const url = sources.find((src) => /\.mp4(\?|$)/.test(src));
    if (url) return url;
    await page.waitForTimeout(250);
  }
  return '';
}
```

**Step 3: Update click flow**

In `extractSceneMaterials`, before clicking a candidate:

```js
const mp4FromNetwork = waitForMp4Response(page);
```

After click:

```js
const domUrl = await waitForModalVideoUrl(page);
const networkUrl = await mp4FromNetwork;
const videoUrl = domUrl || networkUrl;
```

Keep existing dedupe within the same scene so the same candidate is not recorded twice. Do not dedupe across scenes.

**Step 4: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/huasheng-download.js
git commit -m "feat: capture material mp4 urls with network fallback"
```

### Task 5: Close Modal With `aria-label="关闭"` Button

**Files:**
- Modify: `src/huasheng-download.js`

**Step 1: Replace close function**

Replace `closeMaterialModal` so the normal path does not press `Escape`.

Implementation shape:

```js
async function closeMaterialModal(page) {
  const closeButton = page.locator(MODAL_CLOSE_SELECTOR).last();
  const visible = await closeButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) {
    throw new Error(`未找到素材播放弹窗关闭按钮: ${MODAL_CLOSE_SELECTOR}`);
  }

  await closeButton.click({ timeout: 3000 });

  await Promise.race([
    page.locator('video[src]').last().waitFor({ state: 'hidden', timeout: 5000 }),
    closeButton.waitFor({ state: 'hidden', timeout: 5000 }),
  ]).catch(async () => {
    const stillVisible = await closeButton.isVisible({ timeout: 500 }).catch(() => false);
    if (stillVisible) throw new Error('点击关闭按钮后素材播放弹窗仍未消失');
  });
}
```

**Step 2: Update extraction error handling**

After each candidate attempt, call `closeMaterialModal(page)` only if a close button is visible or a modal video appeared. If closing fails, record failure and do not click the next card until recovery succeeds.

**Step 3: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: pass.

**Step 4: Commit**

```bash
git add src/huasheng-download.js
git commit -m "fix: close material modal before continuing"
```

### Task 6: Scroll Only The Material Container

**Files:**
- Modify: `src/huasheng-download.js`

**Step 1: Replace `scrollMaterialList`**

Change the function so it scrolls only `.ClipChoiceList_contentWrap__Ii6jf`:

```js
async function scrollMaterialList(page) {
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (!container) return { before: 0, after: 0, max: 0, missing: true };
    const before = container.scrollTop;
    const amount = Math.max(160, Math.floor(container.clientHeight * 0.75));
    container.scrollBy({ top: amount, behavior: 'instant' });
    return {
      before,
      after: container.scrollTop,
      max: container.scrollHeight - container.clientHeight,
      missing: false,
    };
  }, MATERIAL_CONTAINER_SELECTOR);
}
```

**Step 2: Keep stop condition**

Keep `DEFAULT_STOP_AFTER_EMPTY_SCROLLS`, but base it on container scroll values and whether new candidates or new videos were found.

**Step 3: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: pass.

**Step 4: Commit**

```bash
git add src/huasheng-download.js
git commit -m "fix: scroll recommendation material container"
```

### Task 7: Improve Failure Records

**Files:**
- Modify: `src/huasheng-download.js`

**Step 1: Add candidate failure detail**

When a candidate fails, include:

```js
{
  sceneNumber,
  materialNumber: materials.length + 1,
  candidate,
  reason: error.message,
  modalClosed: true_or_false
}
```

**Step 2: Preserve scene continuation**

Ensure one failed card does not stop the scene loop unless modal recovery fails. If modal recovery fails, record the failure and reload the current scene before continuing.

**Step 3: Run checks**

Run:

```bash
npm run check
npm test
```

Expected: pass.

**Step 4: Commit**

```bash
git add src/huasheng-download.js
git commit -m "chore: record material extraction failures"
```

### Task 8: Manual Verification On Huasheng

**Files:**
- No source edits unless verification exposes issues.

**Step 1: Run one-scene dry run**

Run:

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --count 1 --limit 6 --dry-run
```

Expected:
- Browser opens with existing login profile or prompts for login.
- The script opens the material panel.
- The script scans `.ClipChoiceList_contentWrap__Ii6jf`.
- At least several素材 URLs are captured.
- After each capture, `button[aria-label="关闭"]` is clicked.
- The next card is clickable after the modal closes.

**Step 2: Run one-scene real download**

Run:

```bash
npm run download -- https://www.huasheng.cn/video/158889664548866 --count 1 --limit 3
```

Expected:
- `/Users/liubo/Desktop/hs-src/分镜01_素材01.mp4` exists.
- `/Users/liubo/Desktop/hs-src/manifest.json` includes downloaded records.
- `/Users/liubo/Desktop/hs-src/failures.json` is empty or only contains explainable non-blocking card failures.

**Step 3: Commit verification notes if docs changed**

If README needs a troubleshooting note, update `README.md` and commit:

```bash
git add README.md
git commit -m "docs: add material extraction troubleshooting"
```

### Task 9: Final Project Check

**Files:**
- No source edits expected.

**Step 1: Run final checks**

Run:

```bash
npm test
npm run check
git status --short
```

Expected:
- Tests pass.
- Syntax check passes.
- Git working tree is clean.

**Step 2: Summarize**

Report:

- Which selectors are now used.
- How modal closing is enforced.
- Dry-run result.
- Real download result, if run.
- Any remaining known limitations.
