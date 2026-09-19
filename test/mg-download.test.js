import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeDownloadUrl,
  directMGMaterials,
  isDirectWebmUrl,
  isPrivateAddress,
  mgAnimationNumber,
  mgFilename,
  pad2,
  timelineMGNumbers,
} from '../src/mg-download.js';

test('mgFilename produces naming pattern based on mimeType', () => {
  assert.equal(mgFilename(1), 'MG动画_01.mp4'); // 默认非 webm → mp4
  assert.equal(mgFilename(1, 'video/webm'), 'MG动画_01.webm');
  assert.equal(mgFilename(5, 'video/mp4'), 'MG动画_05.mp4');
  assert.equal(mgFilename(12, 'video/webm'), 'MG动画_12.webm');
});

test('pad2 still works for MG numbering', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(42), '42');
});

test('mgAnimationNumber accepts material panel labels with optional whitespace', () => {
  assert.equal(mgAnimationNumber('MG动画01'), 1);
  assert.equal(mgAnimationNumber(' MG 动画 12 '), 12);
  assert.equal(mgAnimationNumber('重新生成MG动画'), 0);
});

test('isDirectWebmUrl only accepts http webm video links', () => {
  assert.equal(isDirectWebmUrl('https://jssz-boss.hdslb.com/path/output.webm'), true);
  assert.equal(isDirectWebmUrl('https://jssz-boss.hdslb.com/path/output.webm?token=abc'), true);
  assert.equal(isDirectWebmUrl('blob:https://www.huasheng.cn/abc'), false);
  assert.equal(isDirectWebmUrl('https://example.com/poster.png'), false);
});

test('directMGMaterials maps material panel labels to numbered webm files and deduplicates', () => {
  const url1 = 'https://jssz-boss.hdslb.com/capture/prod/one/output.webm';
  const url2 = 'https://jssz-boss.hdslb.com/capture/prod/two/output.webm?token=abc';
  assert.deepEqual(directMGMaterials([
    { label: 'MG动画01', url: url1 },
    { label: 'MG动画01', url: url1 },
    { label: 'MG 动画 02', url: url2 },
    { label: '普通素材', url: 'https://example.com/other.webm' },
    { label: 'MG动画03', url: 'blob:https://www.huasheng.cn/legacy' },
  ]), [
    { mgNumber: 1, filename: 'MG动画_01.webm', url: url1, mimeType: 'video/webm', sourceType: 'direct' },
    { mgNumber: 2, filename: 'MG动画_02.webm', url: url2, mimeType: 'video/webm', sourceType: 'direct' },
  ]);
});

test('timelineMGNumbers discovers cross-clip MG bars by their labels', () => {
  assert.deepEqual(timelineMGNumbers([
    'MG动画 10',
    'MG动画 01',
    'MG动画 10',
    '重新生成MG动画',
    'MG动画 11',
  ]), [1, 10, 11]);
});

test('isPrivateAddress blocks loopback, private, link-local, CGNAT and IPv6 local addresses', () => {
  const blocked = [
    '127.0.0.1', '0.0.0.0', '10.1.2.3', '192.168.0.1', '172.16.0.1',
    '172.31.255.255', '169.254.169.254', '100.64.0.1',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
  ];
  for (const address of blocked) {
    assert.equal(isPrivateAddress(address), true, `${address} 应被判为内网地址`);
  }
});

test('isPrivateAddress allows public IPv4 and IPv6 addresses', () => {
  const allowed = [
    '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1',
    '2606:4700:4700::1111', '::ffff:8.8.8.8',
  ];
  for (const address of allowed) {
    assert.equal(isPrivateAddress(address), false, `${address} 应被判为公网地址`);
  }
});

test('assertSafeDownloadUrl rejects non-http schemes and private or unresolvable hosts', async () => {
  const publicHost = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(() => assertSafeDownloadUrl('file:///etc/passwd', { resolveHost: publicHost }), /协议/);
  await assert.rejects(() => assertSafeDownloadUrl('blob:https://www.huasheng.cn/abc', { resolveHost: publicHost }), /协议/);
  await assert.rejects(() => assertSafeDownloadUrl('http://127.0.0.1/a.webm', { resolveHost: publicHost }), /内网/);
  await assert.rejects(
    () => assertSafeDownloadUrl('http://internal.example.com/a.webm', {
      resolveHost: async () => [{ address: '192.168.1.10', family: 4 }],
    }),
    /内网/,
  );
  await assert.rejects(
    () => assertSafeDownloadUrl('http://rebind.example.com/a.webm', {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.9', family: 4 }],
    }),
    /内网/,
    '多记录中只要有一条内网地址就必须拒绝',
  );
});

test('assertSafeDownloadUrl returns the URL unchanged for public http targets', async () => {
  const target = 'https://jssz-boss.hdslb.com/a/output.webm?token=1';
  assert.equal(
    await assertSafeDownloadUrl(target, { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] }),
    target,
  );
});

test('isDirectWebmUrl rejects webm links pointing at literal internal addresses', () => {
  assert.equal(isDirectWebmUrl('http://127.0.0.1/a/output.webm'), false);
  assert.equal(isDirectWebmUrl('http://192.168.1.5/a/output.webm'), false);
  assert.equal(isDirectWebmUrl('http://169.254.169.254/latest/output.webm'), false);
  assert.equal(isDirectWebmUrl('http://[::1]/a/output.webm'), false);
  assert.equal(isDirectWebmUrl('https://jssz-boss.hdslb.com/a/output.webm'), true);
});
