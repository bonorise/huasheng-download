# Huasheng Create Mode Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Huasheng project creation choose A/B by typing into the chat input, defaulting to A when no mode is specified.

**Architecture:** Keep the existing `src/huasheng-create.js` flow and add a small `mode` option to parsed args. Replace the brittle mode-button click with a chat-input submission helper, and add a best-effort transient overlay dismissal helper around retryable browser steps.

**Tech Stack:** Node.js ESM, Playwright, `node:test`.

---

### Task 1: Add CLI Mode Parsing Tests

**Files:**
- Modify: `test/huasheng-create.test.js`

**Step 1: Write failing tests**

Add tests after the existing `parseCreateArgs parses txt path and browser options` test:

```js
test('parseCreateArgs defaults create mode to A', () => {
  const args = parseCreateArgs(['./input.txt']);
  assert.equal(args.mode, 'A');
});

test('parseCreateArgs accepts create mode B', () => {
  const args = parseCreateArgs(['./input.txt', '--mode', 'B']);
  assert.equal(args.mode, 'B');
});

test('parseCreateArgs normalizes lowercase create mode', () => {
  const args = parseCreateArgs(['./input.txt', '--mode', 'b']);
  assert.equal(args.mode, 'B');
});

test('parseCreateArgs rejects invalid create mode', () => {
  assert.throws(
    () => parseCreateArgs(['./input.txt', '--mode', 'C']),
    /--mode 只支持 A 或 B/
  );
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/huasheng-create.test.js
```

Expected: at least one new test fails because `args.mode` is undefined or `--mode` is unknown.

**Step 3: Commit**

Do not commit yet; commit together with the implementation in Task 2.

### Task 2: Implement CLI Mode Parsing

**Files:**
- Modify: `src/huasheng-create.js`
- Test: `test/huasheng-create.test.js`

**Step 1: Update defaults**

In `parseCreateArgs`, add:

```js
mode: 'A',
```

**Step 2: Parse `--mode`**

Add an option branch before the unknown option error:

```js
} else if (arg === '--mode') {
  const value = argv[++i];
  if (!value) throw new Error('--mode 需要提供 A 或 B。');
  const mode = value.toUpperCase();
  if (!['A', 'B'].includes(mode)) {
    throw new Error('--mode 只支持 A 或 B。');
  }
  args.mode = mode;
```

**Step 3: Run tests**

Run:

```bash
npm test -- test/huasheng-create.test.js
```

Expected: all `huasheng-create` tests pass.

**Step 4: Commit**

```bash
git add src/huasheng-create.js test/huasheng-create.test.js
git commit -m "feat: parse huasheng create mode"
```

### Task 3: Replace Mode Button Click with Chat Submission

**Files:**
- Modify: `src/huasheng-create.js`
- Test: `test/huasheng-create.test.js`

**Step 1: Add helper**

Create a generic helper near `submitConfirmation`:

```js
async function submitChatMessage(page, message) {
  const input = await findVisibleChatInput(page);
  await input.fill(message);
  await input.press('Enter');

  await page.waitForFunction(
    (selector) => {
      const inputs = Array.from(document.querySelectorAll(selector));
      const visible = inputs.filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0;
      });
      return visible.some((element) => element.value === '');
    },
    CHAT_INPUT_SELECTOR,
    { timeout: STEP_TIMEOUT_MS }
  );
}
```

Update `submitConfirmation` to:

```js
async function submitConfirmation(page) {
  await submitChatMessage(page, '确认');
}
```

**Step 2: Add mode submission**

Add:

```js
async function submitCreateMode(page, mode) {
  await submitChatMessage(page, mode);
}
```

**Step 3: Update flow**

Replace:

```js
await runStepWithRetry(`点击${CREATE_MODE_TEXT}`, async () => {
  await clickButtonByExactText(page, CREATE_MODE_TEXT);
});
```

with:

```js
await runStepWithRetry(`提交${args.mode}方案`, async () => {
  await submitCreateMode(page, args.mode);
});
```

Remove `CREATE_MODE_TEXT` if no longer used.

**Step 4: Run checks**

Run:

```bash
npm test -- test/huasheng-create.test.js
npm run check
```

Expected: tests and syntax checks pass.

**Step 5: Commit**

```bash
git add src/huasheng-create.js
git commit -m "feat: submit huasheng create mode via chat"
```

### Task 4: Add Transient Overlay Dismissal

**Files:**
- Modify: `src/huasheng-create.js`

**Step 1: Add helper**

Add:

```js
async function dismissTransientOverlays(page) {
  const closeSelectors = [
    'button[aria-label="关闭"]',
    'button[aria-label="Close"]',
    'button:has-text("关闭")',
    'button:has-text("我知道了")',
    'button:has-text("知道了")',
    'button:has-text("×")',
  ];

  for (const selector of closeSelectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const target = locator.nth(index);
      if (!await target.isVisible().catch(() => false)) continue;
      await target.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(200).catch(() => {});
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
}
```

**Step 2: Use helper in retry**

In `runStepWithRetry`, before each operation call, call the optional dismiss hook if provided. Because `runStepWithRetry` is pure today and covered by unit tests, avoid changing its public signature. Instead call `dismissTransientOverlays(page)` explicitly inside browser steps that are susceptible to overlays:

```js
await dismissTransientOverlays(page);
```

Add this at the start of:

- `findHomeTextarea`
- `findVisibleChatInput`
- `clickButtonByExactText`

**Step 3: Run checks**

Run:

```bash
npm test -- test/huasheng-create.test.js
npm run check
```

Expected: tests and syntax checks pass.

**Step 4: Commit**

```bash
git add src/huasheng-create.js
git commit -m "fix: dismiss huasheng transient overlays"
```

### Task 5: Update Docs and Package Check

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Update README**

Change create docs to say:

- default mode is `A`
- use `--mode B` when the agent/user specifies B
- selection is submitted through chat input instead of clicking the mode button

**Step 2: Ensure `npm run create` exists**

`README.md` documents `npm run create`, so ensure `package.json` has:

```json
"create": "node ./src/huasheng-create.js"
```

**Step 3: Run full verification**

Run:

```bash
npm test
npm run check
```

Expected: all tests pass and syntax checks pass.

**Step 4: Commit**

```bash
git add README.md package.json package-lock.json
git commit -m "docs: document huasheng create mode option"
```

