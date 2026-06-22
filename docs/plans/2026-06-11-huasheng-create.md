# 华声项目自动创建 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增独立命令，读取 TXT 文案并复用现有华声登录态，自动创建项目、选择“A - 素材剪辑成片”、提交两次“确认”，最后输出项目 URL 并保留浏览器现场。

**Architecture:** 新建 `src/huasheng-create.js`，将参数解析、文本清理、URL 判定等纯逻辑与 Playwright 页面操作分开。浏览器继续使用 `src/shared.js` 的持久化 profile；关键页面步骤使用统一的一次重试包装和最长 60 秒状态等待，成功或最终失败后都进入不主动结束的保留现场状态。

**Tech Stack:** Node.js ESM、Playwright、Node.js 内置测试运行器 `node:test`

---

### Task 1: 建立参数解析和 TXT 输入验证

**Files:**
- Create: `src/huasheng-create.js`
- Create: `test/huasheng-create.test.js`

**Step 1: Write the failing tests**

在 `test/huasheng-create.test.js` 中加入：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeScriptText,
  parseCreateArgs,
  readScriptText,
} from '../src/huasheng-create.js';

test('parseCreateArgs parses txt path and browser options', () => {
  const args = parseCreateArgs([
    './input.txt',
    '--profile',
    './profile',
    '--headless',
    '--slow-mo',
    '120',
  ]);

  assert.equal(args.txtPath, path.resolve('./input.txt'));
  assert.equal(args.profileDir, path.resolve('./profile'));
  assert.equal(args.headless, true);
  assert.equal(args.slowMo, 120);
});

test('parseCreateArgs requires a txt path', () => {
  assert.throws(
    () => parseCreateArgs([]),
    /需要提供 TXT 文件路径/
  );
});

test('parseCreateArgs rejects unknown options', () => {
  assert.throws(
    () => parseCreateArgs(['./input.txt', '--wat']),
    /未知参数/
  );
});

test('normalizeScriptText trims outer whitespace and keeps inner lines', () => {
  assert.equal(
    normalizeScriptText('\n  第一段\n第二段  \n'),
    '第一段\n第二段'
  );
});

test('normalizeScriptText rejects empty content', () => {
  assert.throws(
    () => normalizeScriptText(' \n\t '),
    /TXT 文件内容为空/
  );
});

test('readScriptText reads UTF-8 text and normalizes it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'huasheng-create-'));
  const file = path.join(dir, 'script.txt');
  await fs.writeFile(file, '\n文案内容\n', 'utf8');

  assert.equal(await readScriptText(file), '文案内容');
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test test/huasheng-create.test.js
```

Expected: FAIL，提示找不到 `src/huasheng-create.js` 或导出函数不存在。

**Step 3: Write the minimal implementation**

创建 `src/huasheng-create.js`，先实现纯逻辑：

```js
#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PROFILE_DIR } from './shared.js';

export function parseCreateArgs(argv) {
  const args = {
    txtPath: '',
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    slowMo: 80,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !args.txtPath) {
      args.txtPath = path.resolve(arg);
    } else if (arg === '--profile') {
      const value = argv[++i];
      if (!value) throw new Error('--profile 需要提供目录。');
      args.profileDir = path.resolve(value);
    } else if (arg === '--headless') {
      args.headless = true;
    } else if (arg === '--slow-mo') {
      const value = argv[++i];
      args.slowMo = Number(value);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!args.txtPath) {
    throw new Error('需要提供 TXT 文件路径。');
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) {
    throw new Error('--slow-mo 必须是大于或等于 0 的数字。');
  }

  return args;
}

export function normalizeScriptText(rawText) {
  const text = String(rawText).trim();
  if (!text) throw new Error('TXT 文件内容为空。');
  return text;
}

export async function readScriptText(txtPath) {
  let rawText;
  try {
    rawText = await fs.readFile(txtPath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 TXT 文件 ${txtPath}: ${error.message}`);
  }
  return normalizeScriptText(rawText);
}
```

不要添加浏览器启动代码，保证测试导入模块时没有副作用。

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test test/huasheng-create.test.js
```

Expected: 6 tests PASS。

**Step 5: Commit**

```bash
git add src/huasheng-create.js test/huasheng-create.test.js
git commit -m "feat: add huasheng create input parsing"
```

---

### Task 2: 增加项目 URL 判定和通用重试逻辑

**Files:**
- Modify: `src/huasheng-create.js`
- Modify: `test/huasheng-create.test.js`

**Step 1: Write the failing tests**

扩展测试导入：

```js
import {
  isVideoProjectUrl,
  normalizeProjectUrl,
  normalizeScriptText,
  parseCreateArgs,
  readScriptText,
  runStepWithRetry,
} from '../src/huasheng-create.js';
```

加入测试：

```js
test('isVideoProjectUrl accepts a huasheng clip=-1 project URL', () => {
  assert.equal(
    isVideoProjectUrl('https://www.huasheng.cn/video/164064789790827?clip=-1'),
    true
  );
});

test('isVideoProjectUrl rejects wrong host, path, or clip value', () => {
  assert.equal(isVideoProjectUrl('https://example.com/video/164064789790827?clip=-1'), false);
  assert.equal(isVideoProjectUrl('https://www.huasheng.cn/video/abc?clip=-1'), false);
  assert.equal(isVideoProjectUrl('https://www.huasheng.cn/video/164064789790827?clip=0'), false);
});

test('normalizeProjectUrl keeps the validated project URL', () => {
  assert.equal(
    normalizeProjectUrl('https://www.huasheng.cn/video/164064789790827?clip=-1'),
    'https://www.huasheng.cn/video/164064789790827?clip=-1'
  );
});

test('normalizeProjectUrl rejects an invalid URL', () => {
  assert.throws(
    () => normalizeProjectUrl('https://www.huasheng.cn/'),
    /不是有效的视频项目 URL/
  );
});

test('runStepWithRetry retries once and returns the second result', async () => {
  let attempts = 0;
  const result = await runStepWithRetry('测试步骤', async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('第一次失败');
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('runStepWithRetry reports the step after two failures', async () => {
  await assert.rejects(
    runStepWithRetry('点击创建', async () => {
      throw new Error('按钮不存在');
    }),
    /点击创建.*按钮不存在/
  );
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test test/huasheng-create.test.js
```

Expected: FAIL，提示 URL 和重试函数未导出。

**Step 3: Write the minimal implementation**

在 `src/huasheng-create.js` 中加入：

```js
export function isVideoProjectUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && url.hostname === 'www.huasheng.cn'
      && /^\/video\/\d+$/.test(url.pathname)
      && url.searchParams.get('clip') === '-1';
  } catch {
    return false;
  }
}

export function normalizeProjectUrl(rawUrl) {
  if (!isVideoProjectUrl(rawUrl)) {
    throw new Error(`不是有效的视频项目 URL: ${rawUrl}`);
  }
  return new URL(rawUrl).toString();
}

export async function runStepWithRetry(stepName, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        console.warn(`[${stepName}] 第一次失败，正在重试: ${error.message}`);
      }
    }
  }
  throw new Error(`[${stepName}] 重试后仍失败: ${lastError.message}`);
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test test/huasheng-create.test.js
```

Expected: 12 tests PASS。

**Step 5: Commit**

```bash
git add src/huasheng-create.js test/huasheng-create.test.js
git commit -m "feat: add huasheng create workflow helpers"
```

---

### Task 3: 实现稳定的页面定位和“确认”提交

**Files:**
- Modify: `src/huasheng-create.js`

**Step 1: Add selector constants and locator helpers**

在模块顶部加入：

```js
const HOME_URL = 'https://www.huasheng.cn/';
const STEP_TIMEOUT_MS = 60_000;
const CHAT_INPUT_SELECTOR = 'textarea[placeholder="输入你的任何想法"]';
const CREATE_MODE_TEXT = 'A - 素材剪辑成片';
```

实现首页文本框定位。先筛选可见的 `textarea.ant-input`，按面积从大到小选第一个；没有时回退到所有可见 `textarea`：

```js
async function largestVisibleTextarea(page, selector) {
  const candidates = page.locator(selector);
  const count = await candidates.count();
  let best = null;
  let bestArea = -1;

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const box = await candidate.boundingBox();
    const area = box ? box.width * box.height : 0;
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }

  return best;
}

async function findHomeTextarea(page) {
  await page.locator('textarea').first().waitFor({
    state: 'visible',
    timeout: STEP_TIMEOUT_MS,
  });

  return await largestVisibleTextarea(page, 'textarea.ant-input')
    || await largestVisibleTextarea(page, 'textarea')
    || Promise.reject(new Error('未找到首页文案输入框。'));
}
```

实现按钮和对话输入框定位：

```js
async function findVisibleChatInput(page) {
  const inputs = page.locator(CHAT_INPUT_SELECTOR);
  await inputs.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  const count = await inputs.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index);
    if (await input.isVisible().catch(() => false)) return input;
  }
  throw new Error('未找到可见的对话输入框。');
}

async function clickButtonByExactText(page, text) {
  const button = page.getByRole('button', { name: text, exact: true }).filter({ visible: true }).first();
  await button.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  await button.click();
}
```

实现提交并等待清空。不要缓存旧 locator；轮询期间每次重新查询输入框：

```js
async function submitConfirmation(page) {
  const input = await findVisibleChatInput(page);
  await input.fill('确认');
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
      return visible.length > 0 && visible.every((element) => element.value === '');
    },
    CHAT_INPUT_SELECTOR,
    { timeout: STEP_TIMEOUT_MS }
  );
}
```

注意：若当前 Playwright 版本不支持 locator 的 `{ visible: true }` 过滤参数，则改为取精确文本匹配结果并逐个调用 `isVisible()`，不要改用完整动态 class。

**Step 2: Add URL wait helper**

实现：

```js
async function waitForVideoProjectUrl(page) {
  await page.waitForURL(
    (url) => isVideoProjectUrl(url.toString()),
    { timeout: STEP_TIMEOUT_MS }
  );
  return normalizeProjectUrl(page.url());
}
```

**Step 3: Run syntax and unit checks**

Run:

```bash
node --check src/huasheng-create.js
node --test test/huasheng-create.test.js
```

Expected: syntax check 成功，12 tests PASS。

**Step 4: Commit**

```bash
git add src/huasheng-create.js
git commit -m "feat: add huasheng page interaction helpers"
```

---

### Task 4: 串联完整浏览器工作流

**Files:**
- Modify: `src/huasheng-create.js`

**Step 1: Add imports and login recovery**

扩展 `src/shared.js` 导入：

```js
import {
  DEFAULT_PROFILE_DIR,
  isProbablyLoggedOut,
  launchBrowser,
  pauseForEnter,
} from './shared.js';
```

实现首页打开和登录恢复：

```js
async function openHome(page, args) {
  await page.goto(HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: STEP_TIMEOUT_MS,
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (!await isProbablyLoggedOut(page)) return;
  if (args.headless) {
    throw new Error('当前登录态已失效，无头模式无法手动登录。');
  }

  await pauseForEnter('当前登录态已失效，请在浏览器中完成华声登录。');
  await page.goto(HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: STEP_TIMEOUT_MS,
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (await isProbablyLoggedOut(page)) {
    throw new Error('登录后仍未检测到有效登录态。');
  }
}
```

**Step 2: Implement the workflow**

实现并导出：

```js
export async function createHuashengProject({ page, args, scriptText }) {
  await runStepWithRetry('打开首页', () => openHome(page, args));

  await runStepWithRetry('填写文案', async () => {
    const input = await findHomeTextarea(page);
    await input.fill(scriptText);
  });

  await runStepWithRetry('点击创建', async () => {
    await clickButtonByExactText(page, '创建');
  });

  await runStepWithRetry(`点击${CREATE_MODE_TEXT}`, async () => {
    await clickButtonByExactText(page, CREATE_MODE_TEXT);
  });

  await runStepWithRetry('第一次提交确认', async () => {
    await submitConfirmation(page);
  });

  const projectUrl = await runStepWithRetry('等待视频项目页', async () => {
    return waitForVideoProjectUrl(page);
  });

  await runStepWithRetry('第二次提交确认', async () => {
    await submitConfirmation(page);
  });

  return projectUrl;
}
```

页面可能在点击创建后先跳转再渲染按钮，因此不额外要求固定 URL 变化；等待成片按钮本身就是该步骤的成功条件。

**Step 3: Add the browser-preserving CLI**

加入：

```js
function holdBrowserOpen(message) {
  console.log(`\n${message}`);
  console.log('浏览器已保留，请检查页面；按 Ctrl+C 结束脚本。');
  return new Promise(() => {});
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCreateArgs(argv);
  const scriptText = await readScriptText(args.txtPath);
  const { page } = await launchBrowser(args);

  try {
    const projectUrl = await createHuashengProject({ page, args, scriptText });
    console.log(`\n创建完成: ${projectUrl}`);
    await holdBrowserOpen('任务已完成。');
  } catch (error) {
    console.error(`\n创建失败: ${error.message}`);
    console.error(`当前页面: ${page.url()}`);
    await holdBrowserOpen('任务失败，请检查浏览器现场。');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n错误: ${error.message}`);
    process.exitCode = 1;
  });
}
```

不要调用 `context.close()`。输入文件验证发生在 `launchBrowser()` 之前，因此文件错误不会打开浏览器，也不会进入无限暂停。

**Step 4: Run checks**

Run:

```bash
node --check src/huasheng-create.js
node --test test/huasheng-create.test.js
```

Expected: syntax check 成功，12 tests PASS。

**Step 5: Commit**

```bash
git add src/huasheng-create.js
git commit -m "feat: automate huasheng project creation"
```

---

### Task 5: 接入 npm 命令并更新说明

**Files:**
- Modify: `package.json:10-14`
- Modify: `README.md:13-40`

**Step 1: Add the npm script and syntax check**

将 `package.json` 的 scripts 修改为：

```json
"scripts": {
  "download": "node ./src/index.js",
  "create": "node ./src/huasheng-create.js",
  "check": "node --check ./src/index.js && node --check ./src/shared.js && node --check ./src/huasheng-download.js && node --check ./src/mg-download.js && node --check ./src/huasheng-create.js",
  "test": "node --test"
}
```

不要修改依赖，不安装任何新包，避免引入额外原生模块和架构风险。

**Step 2: Document the create command**

在 README 的“使用”部分新增独立小节：

```markdown
### 根据 TXT 文案创建项目

传入 UTF-8 TXT 文件。脚本会复用 `.browser-profile` 登录态，创建项目、选择“A - 素材剪辑成片”，并自动提交两次“确认”：

```bash
npm run create -- /绝对路径/文案.txt
```

可选参数：

```text
--profile <目录>    Playwright 登录态目录，默认 .browser-profile
--headless          无头模式；登录失效时无法人工恢复
--slow-mo <毫秒>    浏览器操作延迟，默认 80
```

每一步最长等待 60 秒，目标出现后立即继续。成功后终端会输出新项目 URL；成功或失败时浏览器都会保持打开，使用 `Ctrl+C` 结束脚本。
```

保持原有下载说明不变。

**Step 3: Run complete automated verification**

Run:

```bash
npm run check
npm test
```

Expected:

- 所有 JavaScript 文件语法检查成功。
- 原有下载测试和新增创建测试全部 PASS。

**Step 4: Review the scoped diff**

Run:

```bash
git diff --check
git status --short
git diff -- package.json README.md src/huasheng-create.js test/huasheng-create.test.js
```

Expected:

- `git diff --check` 无输出。
- `src/index.js` 仍可能显示用户原有未提交修改，但本任务不修改、不暂存它。
- 本功能差异仅涉及计划列出的新模块、测试、`package.json` 和 README。

**Step 5: Commit**

```bash
git add package.json README.md
git commit -m "docs: add huasheng create command"
```

---

### Task 6: 人工验收真实华声流程

**Files:**
- Verify: `src/huasheng-create.js`
- Verify: `.browser-profile/`

**Step 1: Prepare a temporary TXT file manually**

创建一个短测试文案 TXT，确认内容适合实际创建华声项目。不要将测试文案提交到仓库。

**Step 2: Run the visible-browser workflow**

Run:

```bash
npm run create -- /绝对路径/测试文案.txt
```

Expected:

1. 浏览器复用现有登录态打开华声首页。
2. 首页输入框收到完整文案。
3. 脚本点击“创建”。
4. `A - 素材剪辑成片` 出现后立即被点击。
5. 第一个对话输入框提交“确认”并清空。
6. 页面进入 `https://www.huasheng.cn/video/<数字ID>?clip=-1`。
7. 第二个对话输入框提交“确认”并清空。
8. 终端输出同一个项目 URL。
9. 浏览器保持打开，进程等待 `Ctrl+C`。

**Step 3: Verify failure preservation if practical**

使用一个不会造成真实副作用的方式制造失败，例如临时断网或在测试环境缩短等待后恢复代码。确认终端输出失败步骤和当前 URL，浏览器保持打开。不要为了测试失败而提交破坏性代码。

**Step 4: Stop the process**

按 `Ctrl+C` 结束脚本，确认浏览器进程随 CLI 终止，不需要代码主动调用 `context.close()`。

**Step 5: Final regression verification**

Run:

```bash
npm run check
npm test
```

Expected: 全部 PASS，现有下载模块行为未改变。
