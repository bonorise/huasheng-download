import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeArgs, resumeMessages } from '../src/huasheng-resume.js';

const PROJECT_URL = 'https://www.huasheng.cn/video/188627489873954?clip=-1';

test('parseResumeArgs parses project url with defaults', () => {
  const args = parseResumeArgs([PROJECT_URL]);

  assert.equal(args.projectUrl, PROJECT_URL);
  assert.equal(args.mode, 'A');
  assert.equal(args.start, 1);
  assert.equal(args.headless, false);
});

test('parseResumeArgs parses mode, start and browser options', () => {
  const args = parseResumeArgs([
    PROJECT_URL,
    '--mode',
    'b',
    '--start',
    '2',
    '--slow-mo',
    '120',
  ]);

  assert.equal(args.mode, 'B');
  assert.equal(args.start, 2);
  assert.equal(args.slowMo, 120);
});

test('parseResumeArgs requires a project url', () => {
  assert.throws(() => parseResumeArgs([]), /项目 URL/);
});

test('parseResumeArgs rejects non-project urls', () => {
  assert.throws(
    () => parseResumeArgs(['https://www.huasheng.cn/']),
    /不是有效的视频项目 URL/
  );
});

test('parseResumeArgs rejects out-of-range start', () => {
  assert.throws(() => parseResumeArgs([PROJECT_URL, '--start', '0']), /--start/);
  assert.throws(() => parseResumeArgs([PROJECT_URL, '--start', '4']), /--start/);
  assert.throws(() => parseResumeArgs([PROJECT_URL, '--start', 'x']), /--start/);
});

test('resumeMessages returns full sequence from step 1', () => {
  assert.deepEqual(resumeMessages('B', 1), [
    '方案 B',
    '确认',
    '确认',
  ]);
});

test('resumeMessages slices from the given step', () => {
  assert.deepEqual(resumeMessages('A', 2), ['确认', '确认']);
  assert.deepEqual(resumeMessages('A', 3), ['确认']);
});
