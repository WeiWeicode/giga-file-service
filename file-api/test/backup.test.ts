/**
 * NAS 備份(F2;docs/Gherkin/files/backup.feature、STORAGE.md §2)。NAS 以暫存目錄模擬(含 / 不含標記檔)。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { gatewayAlert } from '../src/modules/backup/gateway-alert.js';
import { restore } from '../src/modules/backup/restore.js';
import { buildTestApp, MemoryFileRepo, multipart, PDF, startJwks, user, type Jwks, type Part, type TestApp } from './helpers.js';

let jwks: Jwks;
let t: TestApp;
let repo: MemoryFileRepo;

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const auth = async () => ({ 'x-internal-token': await jwks.sign(user('S112009')) });

async function upload(files: Part[], fields: Record<string, string> = { refNo: 'ECR-1' }) {
  const body = await multipart(files, fields);
  const res = await t.app.inject({ method: 'POST', url: '/v1/files', payload: body.payload, headers: { ...body.headers, ...(await auth()) } });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().items as { fileUuid: string }[];
}
const rec = (uuid: string) => repo.files.find((f) => f.fileUuid === uuid)!;
const nasPath = (uuid: string) => path.join(t.backup!.root, rec(uuid).storageKey);
const localPath = (uuid: string) => path.join(t.root, rec(uuid).storageKey);

before(async () => {
  jwks = await startJwks();
});
after(() => jwks.close());

describe('NAS 備份補傳', () => {
  beforeEach(async () => {
    t = await buildTestApp(jwks, { backup: { maxAttempts: 3 } });
    repo = t.repo as MemoryFileRepo;
  });

  it('場景: 補傳到 NAS 並驗證 SHA-256', async () => {
    const [a, b] = await upload([
      { name: '報價單.pdf', content: PDF },
      { name: 'b.txt', content: 'hello' },
    ]);
    const r = await t.backup!.service.runOnce();
    assert.deepEqual([r.skipped, r.done, r.retrying, r.failed.length], [null, 2, 0, 0]);
    for (const u of [a!.fileUuid, b!.fileUuid]) {
      assert.equal(rec(u).backupStatus, 'done');
      assert.ok(rec(u).backupAt);
      assert.equal(sha(readFileSync(nasPath(u))), rec(u).sha256, 'NAS 內容與資料庫 SHA 相符');
      assert.match(rec(u).storageKey, /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/, 'NAS 路徑同本機 {yyyy}/{mm}/{uuid}');
    }
    assert.ok(!readdirSync(path.dirname(nasPath(a!.fileUuid))).some((n) => n.endsWith('.part')), '不留 .part');
    const again = await t.backup!.service.runOnce();
    assert.equal(again.done, 0, '已完成的不重複備份');
  });

  it('場景: NAS 未掛載時跳過,不累計失敗,恢復後自動補', async () => {
    const [a] = await upload([{ name: 'a.pdf', content: PDF }]);
    rmSync(path.join(t.backup!.root, '.giga-files-backup'));
    const r = await t.backup!.service.runOnce();
    assert.match(r.skipped ?? '', /標記檔/);
    assert.equal(rec(a!.fileUuid).backupStatus, 'pending');
    assert.equal(repo.attempts.get(a!.fileUuid) ?? 0, 0, 'NAS 不可用不算失敗');
    assert.ok(!existsSync(nasPath(a!.fileUuid)), '沒有標記檔時不寫入(避免寫到本機空目錄)');

    writeFileSync(path.join(t.backup!.root, '.giga-files-backup'), '');
    assert.equal((await t.backup!.service.runOnce()).done, 1);
    assert.equal(rec(a!.fileUuid).backupStatus, 'done');
  });

  it('場景: 失敗達門檻改為 failed 並告警一次', async () => {
    const [a, b] = await upload([
      { name: 'a.pdf', content: PDF },
      { name: 'b.txt', content: 'ok' },
    ]);
    rmSync(localPath(a!.fileUuid));
    for (let i = 1; i <= 2; i++) {
      const r = await t.backup!.service.runOnce();
      assert.equal(r.retrying, 1, `第 ${i} 次失敗仍為 pending`);
      assert.equal(rec(a!.fileUuid).backupStatus, 'pending');
    }
    assert.equal(t.backup!.alerts.length, 0, '未達門檻不告警');
    const r = await t.backup!.service.runOnce();
    assert.equal(r.failed.length, 1);
    assert.equal(rec(a!.fileUuid).backupStatus, 'failed');
    assert.equal(rec(b!.fileUuid).backupStatus, 'done', '其他檔案不受影響');
    assert.equal(t.backup!.alerts.length, 1);
    assert.equal(t.backup!.alerts[0]![0]!.file.fileUuid, a!.fileUuid);
    assert.match(t.backup!.alerts[0]![0]!.error, /本機實體檔不存在/);
    assert.equal((await t.backup!.service.runOnce()).failed.length, 0, 'failed 不再自動重試');
  });

  it('場景: 本機檔案內容與資料庫不符時不備份', async () => {
    const [a] = await upload([{ name: 'a.txt', content: 'original' }]);
    writeFileSync(localPath(a!.fileUuid), 'tampered');
    const r = await t.backup!.service.runOnce();
    assert.equal(r.retrying, 1);
    assert.ok(!existsSync(nasPath(a!.fileUuid)), '壞檔不覆蓋到 NAS');
  });

  it('場景: 未綁定暫存檔清除時一併移除 NAS 備份', async () => {
    const [a] = await upload([{ name: 'a.pdf', content: PDF }], {});
    await t.backup!.service.runOnce();
    assert.ok(existsSync(nasPath(a!.fileUuid)));
    t.clock.now = new Date(t.clock.now.getTime() + 25 * 3600_000);
    assert.equal(await t.service.cleanupTemps(), 1);
    assert.ok(!existsSync(nasPath(a!.fileUuid)));
  });

  it('場景: 軟刪除不動 NAS 備份', async () => {
    const [a] = await upload([{ name: 'a.pdf', content: PDF }]);
    await t.backup!.service.runOnce();
    const res = await t.app.inject({ method: 'DELETE', url: `/v1/files/${a!.fileUuid}`, headers: await auth() });
    assert.equal(res.statusCode, 204);
    assert.ok(existsSync(nasPath(a!.fileUuid)));
  });
});

describe('重試 API 與統計', () => {
  it('場景: 重試失敗的備份', async () => {
    t = await buildTestApp(jwks, { backup: { maxAttempts: 1 } });
    repo = t.repo as MemoryFileRepo;
    const [a, b] = await upload([
      { name: 'a.pdf', content: PDF },
      { name: 'b.txt', content: 'b' },
    ]);
    rmSync(localPath(a!.fileUuid));
    rmSync(localPath(b!.fileUuid));
    await t.backup!.service.runOnce();
    let s = (await t.app.inject({ method: 'GET', url: '/v1/storage', headers: await auth() })).json();
    assert.equal(s.backupEnabled, true);
    assert.deepEqual(s.backup, { pending: 0, done: 0, failed: 2 });

    const one = await t.app.inject({
      method: 'POST',
      url: '/v1/storage/backup/retry',
      payload: { fileUuids: [a!.fileUuid.toUpperCase()] },
      headers: await auth(),
    });
    assert.equal(one.statusCode, 200, one.body);
    assert.equal(one.json().retried, 1, '可只重試指定檔案(UUID 不分大小寫)');
    const all = await t.app.inject({ method: 'POST', url: '/v1/storage/backup/retry', payload: {}, headers: await auth() });
    assert.equal(all.json().retried, 1);
    s = (await t.app.inject({ method: 'GET', url: '/v1/storage', headers: await auth() })).json();
    assert.deepEqual(s.backup, { pending: 2, done: 0, failed: 0 });
    assert.equal(repo.attempts.get(a!.fileUuid), 0, '失敗次數歸零');
  });

  it('場景: 未設定 NAS 備份的環境', async () => {
    t = await buildTestApp(jwks);
    const s = (await t.app.inject({ method: 'GET', url: '/v1/storage', headers: await auth() })).json();
    assert.equal(s.backupEnabled, false);
    const res = await t.app.inject({ method: 'POST', url: '/v1/storage/backup/retry', payload: {}, headers: await auth() });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'FILE_BACKUP_DISABLED');
  });

  it('沒有內部 Token 回 401;fileUuids 格式錯誤回 400', async () => {
    t = await buildTestApp(jwks, { backup: {} });
    assert.equal((await t.app.inject({ method: 'POST', url: '/v1/storage/backup/retry', payload: {} })).statusCode, 401);
    const bad = await t.app.inject({ method: 'POST', url: '/v1/storage/backup/retry', payload: { fileUuids: ['../x'] }, headers: await auth() });
    assert.equal(bad.statusCode, 400);
  });
});

describe('從 NAS 還原', () => {
  beforeEach(async () => {
    t = await buildTestApp(jwks, { backup: {} });
    repo = t.repo as MemoryFileRepo;
  });

  it('場景: 刪除本機檔後以 CLI 還原且 SHA 相符(預設乾跑)', async () => {
    const [a, b] = await upload([
      { name: 'a.pdf', content: PDF },
      { name: 'b.txt', content: 'bbb' },
    ]);
    await t.backup!.service.runOnce();
    rmSync(localPath(a!.fileUuid));
    const opts = { repo, local: t.store, nas: t.backup!.nas };

    const dry = await restore({ ...opts, apply: false });
    assert.equal(dry.checked, 2);
    assert.deepEqual(
      dry.items.map((i) => [i.fileUuid, i.state, i.result]),
      [[a!.fileUuid, 'missing', 'dry-run']],
    );
    assert.ok(!existsSync(localPath(a!.fileUuid)), '乾跑不寫入');

    const done = await restore({ ...opts, apply: true });
    assert.equal(done.items[0]!.result, 'restored');
    assert.equal(sha(readFileSync(localPath(a!.fileUuid))), rec(a!.fileUuid).sha256);
    assert.equal((await restore({ ...opts, apply: false })).items.length, 0, '還原後無需處理');
    assert.ok(existsSync(localPath(b!.fileUuid)));
  });

  it('場景: 本機內容不符時保留壞檔再還原;NAS 也不符時不寫入', async () => {
    const [a, b] = await upload([
      { name: 'a.txt', content: 'aaa' },
      { name: 'b.txt', content: 'bbb' },
    ]);
    await t.backup!.service.runOnce();
    writeFileSync(localPath(a!.fileUuid), 'broken');
    rmSync(localPath(b!.fileUuid));
    writeFileSync(nasPath(b!.fileUuid), 'nas-broken');

    const r = await restore({ repo, local: t.store, nas: t.backup!.nas, apply: true });
    const by = Object.fromEntries(r.items.map((i) => [i.fileUuid, i]));
    assert.equal(by[a!.fileUuid]!.result, 'restored');
    assert.equal(readFileSync(localPath(a!.fileUuid), 'utf8'), 'aaa');
    assert.ok(
      readdirSync(path.dirname(localPath(a!.fileUuid))).some((n) => n.startsWith(`${a!.fileUuid}.corrupt-`)),
      '壞檔改名保留',
    );
    assert.equal(by[b!.fileUuid]!.result, 'nas-mismatch');
    assert.ok(!existsSync(localPath(b!.fileUuid)));
  });

  it('指定 UUID:未備份的檔案拒絕;NAS 未掛載拒絕', async () => {
    const [a] = await upload([{ name: 'a.pdf', content: PDF }]);
    await assert.rejects(restore({ repo, local: t.store, nas: t.backup!.nas, apply: true, fileUuids: [a!.fileUuid] }), /尚未備份/);
    rmSync(path.join(t.backup!.root, '.giga-files-backup'));
    await assert.rejects(restore({ repo, local: t.store, nas: t.backup!.nas, apply: true }), /標記檔/);
  });
});

describe('備份失敗告警(Gateway /api/notify/send)', () => {
  it('以 API Key 送出範本 FILE_BACKUP_FAILED,逐人寄 Email', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const alert = gatewayAlert({
      gatewayUrl: 'https://gw.example',
      apiKey: 'k',
      users: ['S112009'],
      gwEnv: 'test',
      fetchImpl: (async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response('{"queued":1}', { status: 202 });
      }) as typeof fetch,
    });
    const file = { fileUuid: '0a3d3afd-678f-4ac1-b61e-5bb0ff8a388a', originalName: '報價單.pdf' } as never;
    await alert([{ file, attempts: 5, error: 'EIO' }]);
    assert.equal(calls[0]!.url, 'https://gw.example/api/notify/send');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-api-key'], 'k');
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.templateCode, 'FILE_BACKUP_FAILED');
    assert.deepEqual(body.to, { users: ['S112009'] });
    assert.deepEqual(body.channels, ['email']);
    assert.match(body.data.items, /報價單\.pdf/);
    assert.match(body.idempotencyKey, /^file-backup-[0-9a-f]{32}$/);
  });

  it('Gateway 回錯誤時丟出例外(由排程記錄)', async () => {
    const alert = gatewayAlert({
      gatewayUrl: 'https://gw.example',
      apiKey: 'k',
      users: ['S112009'],
      gwEnv: 'test',
      fetchImpl: (async () => new Response('{"code":"PERMISSION_DENIED"}', { status: 403 })) as typeof fetch,
    });
    await assert.rejects(alert([{ file: { fileUuid: 'x', originalName: 'a' } as never, attempts: 1, error: 'e' }]), /HTTP 403/);
  });
});
