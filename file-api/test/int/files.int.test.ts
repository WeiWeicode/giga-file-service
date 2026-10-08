/**
 * 整合測試(npm run test:int):SQL Server 2012 的 giganexus_gw_poc_test(FILE_TEST_DB_NAME),schema file_svc。
 *   - 每次清空 file_svc 的資料表與 migration 紀錄後重新 migrate(以 file_migrate;DATABASE.md §0.2 規則 4)
 *   - 驗證 DrizzleFileRepo(OUTPUT 子句、OFFSET FETCH、資料範圍)與完整 API(上傳 → 綁定 → 下載 → 刪除)
 *   - Drizzle 產生的每一句 SQL 經 SQL 2012 語法檢查(createDb guard)
 * 不可指向 giganexus_gw_test(開發與測試區共用);也不碰 gw.*。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type sql from 'mssql';
import { createDb, openPool } from '../../src/db/client.js';
import { migrateSqlConfig, runMigrations } from '../../src/migrate.js';
import { DrizzleFileRepo } from '../../src/modules/files/drizzle-repo.js';
import type { NewFile } from '../../src/modules/files/types.js';
import { buildTestApp, multipart, PDF, startJwks, user, type Jwks, type TestApp } from '../helpers.js';

const database = process.env.FILE_TEST_DB_NAME;
if (!database) throw new Error('FILE_TEST_DB_NAME 未設定(整合測試專用庫,例 giganexus_gw_poc_test);未查詢');
if (database === process.env.FILE_DB_NAME || database === 'giganexus_gw_test' || database === 'giganexus_gw')
  throw new Error(`FILE_TEST_DB_NAME 不可指向 ${database}(會清空 file_svc)`);

const migrateCfg = migrateSqlConfig(process.env, database);
let pool: sql.ConnectionPool;
let repo: DrizzleFileRepo;
let jwks: Jwks;
let t: TestApp;

/** 清空 file_svc 的資料表(含 migration 紀錄);2012 語法,不用 DROP … IF EXISTS */
async function resetSchema(): Promise<void> {
  const admin = await openPool(migrateCfg, { appName: 'giganexus-file-int-reset', poolMax: 1 });
  try {
    await admin.request().batch(`
      DECLARE @stmt NVARCHAR(MAX) = N'';
      SELECT @stmt = @stmt + N'DROP TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N';' + CHAR(10)
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'file_svc';
      EXEC sp_executesql @stmt;`);
  } finally {
    await admin.close();
  }
}

const file = (over: Partial<NewFile>): NewFile => ({
  fileUuid: crypto.randomUUID(),
  originalName: '報價單.pdf',
  ext: 'pdf',
  mime: 'application/pdf',
  sizeBytes: 10,
  sha256: 'a'.repeat(64),
  storageKey: '2026/10/x',
  sourceSystem: 'file',
  sourceApp: null,
  refType: null,
  refNo: null,
  companyId: '碩禾',
  uploadedBy: 'S112009',
  uploadedIp: '10.10.112.13',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  boundAt: null,
  ...over,
});

before(async () => {
  await resetSchema();
  await runMigrations(migrateCfg);
  // 以 app 帳號連線(只有 file_svc 讀寫權限)
  pool = await openPool(
    { ...migrateCfg, user: process.env.FILE_DB_USER!, password: process.env.FILE_DB_PASSWORD! },
    { appName: 'giganexus-file-int', poolMax: 4 },
  );
  repo = new DrizzleFileRepo(createDb(pool, true));
  jwks = await startJwks();
  t = await buildTestApp(jwks, { repo });
});

after(async () => {
  await t?.app.close();
  jwks?.close();
  await pool?.close();
});

describe('DrizzleFileRepo(SQL Server 2012,schema file_svc)', () => {
  const me = { kind: 'user' as const, userId: 'S112009', companies: ['碩禾'] };

  it('migration 紀錄在 file_svc.__file_migrations,app 帳號讀不到 gw.*', async () => {
    const r = await pool.request().query(`SELECT COUNT(*) AS n FROM file_svc.__file_migrations`);
    assert.equal(r.recordset[0].n, 1);
    await assert.rejects(pool.request().query('SELECT TOP 1 * FROM gw.api_route'), /permission|權限|Invalid object/i);
  });

  it('新增、查詢(UUID 轉小寫)、資料範圍與分頁', async () => {
    const a = file({ createdAt: new Date('2026-10-01T01:00:00Z'), refNo: 'ECR-1', boundAt: new Date() });
    const b = file({ createdAt: new Date('2026-10-01T02:00:00Z'), refNo: 'ECR-1', boundAt: new Date(), originalName: '中文檔名.xlsx' });
    const other = file({ uploadedBy: 'S200001', companyId: '禾迅' });
    await repo.insertMany([a, b, other], [{ fileUuid: a.fileUuid, action: 'upload', userId: 'S112009', ip: null, requestId: 'r1' }]);
    const got = await repo.findActive(b.fileUuid.toUpperCase().toLowerCase());
    assert.equal(got?.originalName, '中文檔名.xlsx');
    assert.equal(got?.fileUuid, b.fileUuid);
    assert.equal(got?.backupStatus, 'pending');
    const page1 = await repo.list({ refNo: 'ECR-1', page: 1, pageSize: 1 }, me);
    assert.equal(page1.total, 2);
    assert.equal(page1.items[0]?.fileUuid, b.fileUuid, '依建立時間新到舊');
    const page2 = await repo.list({ refNo: 'ECR-1', page: 2, pageSize: 1 }, me);
    assert.equal(page2.items[0]?.fileUuid, a.fileUuid);
    const all = await repo.list({ page: 1, pageSize: 100 }, me);
    assert.ok(!all.items.some((f) => f.fileUuid === other.fileUuid), '他公司的檔案不在範圍內');
    const sys = await repo.list({ page: 1, pageSize: 100 }, { kind: 'system', userId: 'client:bpm' });
    assert.equal(sys.total, 0);
  });

  it('綁定與軟刪除以 OUTPUT 回報實際筆數', async () => {
    const a = file({});
    const gone = file({});
    await repo.insertMany([a, gone], []);
    assert.equal(await repo.softDelete(gone.fileUuid, 'S112009', new Date(), null), true);
    assert.equal(await repo.softDelete(gone.fileUuid, 'S112009', new Date(), null), false, '已刪除不再更新');
    const n = await repo.bind([a.fileUuid, gone.fileUuid], 'ecr', 'ECR-2', new Date(), { action: 'bind', userId: 'S112009', ip: null, requestId: 'r2' });
    assert.equal(n, 1, '已刪除的不綁定');
    const logs = await pool.request().input('u', a.fileUuid).query(`SELECT action, detail FROM file_svc.file_access_log WHERE file_uuid = @u`);
    assert.deepEqual(logs.recordset, [{ action: 'bind', detail: null }]);
  });

  it('逾期暫存檔與統計', async () => {
    const stale = file({ createdAt: new Date('2020-01-01T00:00:00Z') });
    await repo.insertMany([stale], []);
    const expired = await repo.expiredTemps(new Date('2021-01-01T00:00:00Z'), 10);
    assert.deepEqual(
      expired.map((f) => f.fileUuid),
      [stale.fileUuid],
    );
    const s = await repo.stats();
    assert.ok(s.files >= 4);
    assert.equal(s.backup.pending, s.files);
    assert.ok(s.bytes >= 40);
  });

  it('NAS 備份狀態:累計失敗達門檻改 failed、重試歸零、已備份逐批掃描', async () => {
    const a = file({});
    const b = file({});
    const gone = file({});
    await repo.insertMany([a, b, gone], []);
    await repo.softDelete(gone.fileUuid, 'S112009', new Date(), null);
    const pending = (await repo.pendingBackups(1000)).map((f) => f.fileUuid);
    assert.ok(pending.includes(a.fileUuid) && pending.includes(b.fileUuid));
    assert.ok(!pending.includes(gone.fileUuid), '已刪除的不備份');

    assert.deepEqual(await repo.markBackupAttempt(a.fileUuid, 2), { status: 'pending', attempts: 1 });
    assert.deepEqual(await repo.markBackupAttempt(a.fileUuid, 2), { status: 'failed', attempts: 2 });
    const at = new Date('2026-10-08T06:00:00Z');
    await repo.markBackupDone(b.fileUuid, at);
    const gotB = await repo.findActive(b.fileUuid);
    assert.equal(gotB?.backupStatus, 'done');
    assert.equal(gotB?.backupAt?.toISOString(), at.toISOString());
    assert.equal((await repo.stats()).failedItems[0]?.fileUuid, a.fileUuid);

    assert.equal(await repo.retryBackups([b.fileUuid]), 0, 'done 的不受重試影響');
    assert.equal(await repo.retryBackups(null), 1);
    assert.equal((await repo.findActive(a.fileUuid))?.backupStatus, 'pending');
    assert.deepEqual(await repo.markBackupAttempt(a.fileUuid, 2), { status: 'pending', attempts: 1 }, '重試後次數歸零');

    const first = await repo.backedUp(0, 1);
    assert.equal(first[0]?.fileUuid, b.fileUuid);
    assert.equal((await repo.backedUp(first[0]!.id, 10)).length, 0);
  });
});

describe('完整 API 經 SQL Server(上傳 → 綁定 → 下載 → 刪除)', () => {
  it('流程與操作紀錄', async () => {
    const auth = { 'x-internal-token': await jwks.sign(user('S112009')) };
    const body = await multipart([{ name: '報價單.pdf', content: PDF }]);
    const up = await t.app.inject({ method: 'POST', url: '/v1/files', payload: body.payload, headers: { ...body.headers, ...auth } });
    assert.equal(up.statusCode, 201, up.body);
    const uuid = up.json().items[0].fileUuid;
    const bind = await t.app.inject({ method: 'POST', url: '/v1/files/bind', headers: auth, payload: { uuids: [uuid], refType: 'ecr', refNo: 'ECR-INT-1' } });
    assert.equal(bind.json().bound, 1);
    const dl = await t.app.inject({ url: `/v1/files/${uuid}/content`, headers: auth });
    assert.equal(dl.statusCode, 200);
    assert.deepEqual(dl.rawPayload, PDF);
    assert.equal((await t.app.inject({ method: 'DELETE', url: `/v1/files/${uuid}`, headers: auth })).statusCode, 204);
    assert.equal((await t.app.inject({ url: `/v1/files/${uuid}`, headers: auth })).statusCode, 404);
    const logs = await pool.request().input('u', uuid).query(`SELECT action FROM file_svc.file_access_log WHERE file_uuid = @u ORDER BY id`);
    assert.deepEqual(
      logs.recordset.map((r: { action: string }) => r.action),
      ['upload', 'bind', 'download', 'delete'],
    );
  });
});
