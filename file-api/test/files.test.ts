/**
 * 檔案 API(docs/Gherkin/files/upload-download.feature、file-safety.feature;API.md §2)。
 * 以記憶體 repo + 暫存目錄執行;SQL Server 版 repo 見 test/int。場景名稱與 feature 一致,對照 docs/Gherkin/TEST-MAP.md。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { MAX_FILE_BYTES } from '../src/config.js';
import {
  buildTestApp,
  EXE,
  listStored,
  MemoryFileRepo,
  multipart,
  PDF,
  PNG,
  startJwks,
  SVG,
  system,
  user,
  ZIP,
  type Jwks,
  type Part,
  type TestApp,
} from './helpers.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+){2,}$/;

let jwks: Jwks;
let t: TestApp;
let app: FastifyInstance;
let repo: MemoryFileRepo;
let me: string;

const auth = async (claims: Record<string, unknown>) => ({ 'x-internal-token': await jwks.sign(claims) });

async function upload(files: Part[], fields: Record<string, string> = {}, who: Record<string, unknown> = user('S112009')) {
  const body = await multipart(files, fields);
  return app.inject({ method: 'POST', url: '/v1/files', payload: body.payload, headers: { ...body.headers, ...(await auth(who)) } });
}
const get = async (url: string, who: Record<string, unknown> = user('S112009')) => app.inject({ method: 'GET', url, headers: await auth(who) });

before(async () => {
  jwks = await startJwks();
  me = await jwks.sign(user('S112009'));
});
after(() => jwks.close());
beforeEach(async () => {
  t = await buildTestApp(jwks);
  app = t.app;
  repo = t.repo as MemoryFileRepo;
});

describe('OpenAPI(BACKEND-GUIDE.md §6.1)', () => {
  it('根層有 x-gateway 與 x-permissions;每個 operation 都有必填欄位、description 與 x-gherkin,權限都已宣告', async () => {
    const doc = (await app.inject('/openapi.json')).json();
    assert.deepEqual(doc['x-gateway'], { upstream: 'file-api', system: 'file', project: 'giga-file-service' });
    const declared = new Set(doc['x-permissions'].map((p: { code: string }) => p.code));
    const ops = Object.values(doc.paths as Record<string, Record<string, Record<string, unknown>>>).flatMap((p) => Object.values(p));
    assert.ok(ops.length >= 7);
    for (const op of ops) {
      const id = String(op.operationId);
      assert.match(id, CODE, `operationId 格式:${id}`);
      assert.ok(op.summary, `${id} 缺 summary`);
      assert.ok(String(op.description ?? '').length >= 10, `${id} 缺 description`);
      assert.match(String(op['x-gherkin'] ?? ''), /場景:/, `${id} 缺 x-gherkin`);
      assert.ok(declared.has(String(op['x-permission'])), `${id} 的 x-permission 未宣告:${op['x-permission']}`);
    }
    assert.ok(!JSON.stringify(doc).includes('storageKey'), '不可對外暴露 storage_key');
  });

  it('/healthz 不需 Token', async () => {
    assert.equal((await app.inject('/healthz')).statusCode, 200);
  });
});

describe('上傳與下載(upload-download.feature)', () => {
  it('上傳單一檔案後取得 UUID,狀態為暫存', async () => {
    const res = await upload([{ name: '報價單.pdf', content: PDF }]);
    assert.equal(res.statusCode, 201, res.body);
    const [f] = res.json().items;
    assert.match(f.fileUuid, UUID_V4);
    assert.equal(f.originalName, '報價單.pdf');
    assert.equal(f.refNo, null);
    assert.equal(f.boundAt, null);
    assert.equal(f.backupStatus, 'pending');
    assert.equal(f.sourceSystem, 'file');
    assert.equal(f.companyId, '碩禾');
    const rec = repo.files[0]!;
    assert.match(rec.storageKey, new RegExp(`^\\d{4}/\\d{2}/${f.fileUuid}$`), '實體路徑 {yyyy}/{mm}/{uuid},不含副檔名與原檔名');
    const full = path.join(t.root, rec.storageKey);
    assert.ok(existsSync(full));
    assert.equal(rec.sha256, createHash('sha256').update(PDF).digest('hex'));
    assert.equal(f.sha256, rec.sha256);
    assert.deepEqual(readFileSync(full), PDF);
    assert.deepEqual(
      repo.logs.map((l) => l.action),
      ['upload'],
    );
    assert.equal(listStored(t.root).tmp, 0, '暫存目錄已清空');
  });

  it('一次上傳多個檔案', async () => {
    const res = await upload([
      { name: 'a.png', content: PNG },
      { name: 'b.xlsx', content: ZIP },
    ]);
    assert.equal(res.statusCode, 201, res.body);
    const items = res.json().items;
    assert.equal(items.length, 2);
    assert.notEqual(items[0].fileUuid, items[1].fileUuid);
    assert.equal(items[1].mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('上傳時一併指定單號', async () => {
    const res = await upload([{ name: '規格.pdf', content: PDF }], {
      refType: 'ecr',
      refNo: 'ECR-2026-001',
      sourceSystem: 'bpm',
      sourceApp: '太陽能ECRECN_規格',
    });
    assert.equal(res.statusCode, 201, res.body);
    const [f] = res.json().items;
    assert.equal(f.refNo, 'ECR-2026-001');
    assert.ok(f.boundAt);
    assert.equal(f.sourceSystem, 'bpm');
    assert.equal(f.sourceApp, '太陽能ECRECN_規格', 'sourceApp 原樣保存,不拆');
  });

  it('單據存檔時綁定暫存檔', async () => {
    const a = (await upload([{ name: 'a.pdf', content: PDF }])).json().items[0];
    const b = (await upload([{ name: 'b.pdf', content: PDF }])).json().items[0];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/files/bind',
      headers: { 'x-internal-token': me },
      payload: { uuids: [a.fileUuid, b.fileUuid.toUpperCase()], refType: 'ecr', refNo: 'ECR-2026-002' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().bound, 2);
    assert.deepEqual(
      repo.files.map((f) => f.refNo),
      ['ECR-2026-002', 'ECR-2026-002'],
    );
    assert.equal(repo.logs.filter((l) => l.action === 'bind').length, 2);
  });

  it('不可綁定他人上傳的暫存檔', async () => {
    const other = (await upload([{ name: 'x.pdf', content: PDF }], {}, user('S100001'))).json().items[0];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/files/bind',
      headers: { 'x-internal-token': me },
      payload: { uuids: [other.fileUuid], refNo: 'ECR-1' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, 'DATA_ACCESS_DENIED');
    assert.equal(repo.files[0]!.refNo, null, '該檔案仍為暫存');
  });

  it('下載時帶 UTF-8 檔名', async () => {
    const content = Buffer.concat([ZIP, Buffer.from('內容')]);
    const f = (await upload([{ name: '電子發票設定.docx', content }])).json().items[0];
    const res = await get(`/v1/files/${f.fileUuid}/content`);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.rawPayload, content);
    const cd = String(res.headers['content-disposition']);
    assert.match(cd, /^attachment; filename="[^"]*\.docx"; filename\*=UTF-8''%E9%9B%BB/);
    assert.equal(decodeURIComponent(cd.split("UTF-8''")[1]!), '電子發票設定.docx');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-length'], String(content.length));
    assert.ok(repo.logs.some((l) => l.action === 'download' && l.fileUuid === f.fileUuid));
  });

  it('圖片與 PDF 可以 inline 預覽', async () => {
    const f = (await upload([{ name: '照片.png', content: PNG }])).json().items[0];
    const res = await get(`/v1/files/${f.fileUuid}/content?inline=1`);
    assert.match(String(res.headers['content-disposition']), /^inline;/);
    assert.equal(res.headers['content-type'], 'image/png');
  });

  it('其他類型即使要求 inline 仍以附件下載', async () => {
    const f = (await upload([{ name: '清單.xlsx', content: ZIP }])).json().items[0];
    assert.match(String((await get(`/v1/files/${f.fileUuid}/content?inline=1`)).headers['content-disposition']), /^attachment;/);
  });

  it('查詢清單依單號篩選並分頁', async () => {
    await upload([{ name: '1.pdf', content: PDF }], { refNo: 'ECR-2026-003' });
    await upload([{ name: '2.pdf', content: PDF }], { refNo: 'ECR-2026-003' });
    await upload([{ name: '3.pdf', content: PDF }]);
    const res = await get('/v1/files?refNo=ECR-2026-003&page=1&pageSize=1');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.total, 2);
    assert.equal(body.items.length, 1);
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 1);
  });

  it('軟刪除後清單與下載都看不到,但實體檔保留', async () => {
    const f = (await upload([{ name: '待刪.pdf', content: PDF }])).json().items[0];
    const del = await app.inject({ method: 'DELETE', url: `/v1/files/${f.fileUuid}`, headers: { 'x-internal-token': me } });
    assert.equal(del.statusCode, 204);
    const res = await get(`/v1/files/${f.fileUuid}`);
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().code, 'FILE_NOT_FOUND');
    assert.equal((await get(`/v1/files/${f.fileUuid}/content`)).statusCode, 404);
    assert.equal((await get('/v1/files')).json().total, 0);
    assert.ok(existsSync(path.join(t.root, repo.files[0]!.storageKey)), '實體檔仍存在');
    assert.ok(repo.logs.some((l) => l.action === 'delete'));
  });

  it('已刪除的檔案再刪除回 404', async () => {
    const f = (await upload([{ name: '待刪.pdf', content: PDF }])).json().items[0];
    await app.inject({ method: 'DELETE', url: `/v1/files/${f.fileUuid}`, headers: { 'x-internal-token': me } });
    const again = await app.inject({ method: 'DELETE', url: `/v1/files/${f.fileUuid}`, headers: { 'x-internal-token': me } });
    assert.equal(again.statusCode, 404);
    assert.equal(again.json().code, 'FILE_NOT_FOUND');
  });

  it('超過 24 小時未綁定的暫存檔由排程清除', async () => {
    const start = new Date('2026-10-01T00:00:00Z');
    t.clock.now = start;
    const oldTemp = (await upload([{ name: 'old.pdf', content: PDF }])).json().items[0];
    const oldBound = (await upload([{ name: 'bound.pdf', content: PDF }], { refNo: 'ECR-9' })).json().items[0];
    t.clock.now = new Date(start.getTime() + 24 * 3600_000);
    const freshTemp = (await upload([{ name: 'fresh.pdf', content: PDF }])).json().items[0];
    t.clock.now = new Date(start.getTime() + 25 * 3600_000);
    assert.equal(await t.service.cleanupTemps(), 1);
    const byUuid = (u: string) => repo.files.find((f) => f.fileUuid === u)!;
    assert.equal(byUuid(oldTemp.fileUuid).deletedBy, 'system:temp-cleanup');
    assert.ok(!existsSync(path.join(t.root, byUuid(oldTemp.fileUuid).storageKey)), '逾期暫存檔的實體檔被移除');
    for (const u of [oldBound.fileUuid, freshTemp.fileUuid]) {
      assert.equal(byUuid(u).deletedAt, null);
      assert.ok(existsSync(path.join(t.root, byUuid(u).storageKey)));
    }
  });

  it('儲存與備份統計', async () => {
    await upload([
      { name: 'a.pdf', content: PDF },
      { name: 'b.png', content: PNG },
    ]);
    const res = await get('/v1/storage');
    assert.equal(res.statusCode, 200, res.body);
    const s = res.json();
    assert.equal(s.files, 2);
    assert.equal(s.bytes, PDF.length + PNG.length);
    assert.equal(s.temp, 2);
    assert.deepEqual(s.backup, { pending: 2, done: 0, failed: 0 });
    assert.ok(s.capacity === null || s.capacity.totalBytes > 0);
  });
});

describe('檔案安全(file-safety.feature)', () => {
  it('沒有內部 Token 一律拒絕', async () => {
    const res = await app.inject('/v1/files');
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'FILE_INTERNAL_TOKEN_INVALID');
  });

  it('Token 的 audience 不是 file-api 時拒絕', async () => {
    const res = await app.inject({ url: '/v1/files', headers: { 'x-internal-token': await jwks.sign(user('S112009'), 'go-mes') } });
    assert.equal(res.statusCode, 401);
  });

  for (const name of ['setup.exe', 'run.bat', 'script.ps1', 'macro.vbs', 'page.html', '無副檔名']) {
    it(`拒絕執行檔與腳本:${name}`, async () => {
      const res = await upload([{ name, content: 'echo hi' }]);
      assert.equal(res.statusCode, 415, res.body);
      assert.equal(res.json().code, 'FILE_TYPE_NOT_ALLOWED');
      assert.deepEqual(listStored(t.root), { stored: [], tmp: 0 });
      assert.equal(repo.files.length, 0);
    });
  }

  it('副檔名與檔頭不符時拒絕', async () => {
    const res = await upload([{ name: '偽裝.pdf', content: EXE }]);
    assert.equal(res.statusCode, 415);
    assert.equal(res.json().code, 'FILE_CONTENT_MISMATCH');
    assert.deepEqual(listStored(t.root), { stored: [], tmp: 0 });
    assert.equal(repo.files.length, 0);
  });

  it('多檔上傳其中一個不合格時整批拒絕', async () => {
    const res = await upload([
      { name: 'ok.pdf', content: PDF },
      { name: 'bad.exe', content: EXE },
    ]);
    assert.equal(res.statusCode, 415);
    assert.deepEqual(listStored(t.root), { stored: [], tmp: 0 });
    assert.equal(repo.files.length, 0);
  });

  it('超過 50 MB 拒絕', async () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1, 0x41);
    PDF.copy(big);
    const res = await upload([{ name: '大檔.pdf', content: big }]);
    assert.equal(res.statusCode, 413, res.body);
    assert.equal(res.json().code, 'FILE_TOO_LARGE');
    assert.deepEqual(listStored(t.root), { stored: [], tmp: 0 });
  });

  it('剛好 50 MB 可以上傳', async () => {
    const exact = Buffer.alloc(MAX_FILE_BYTES, 0x41);
    PDF.copy(exact);
    const res = await upload([{ name: '剛好.pdf', content: exact }]);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().items[0].sizeBytes, MAX_FILE_BYTES);
  });

  it('沒有選擇檔案時回 400', async () => {
    const res = await upload([], { refNo: 'X' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'FILE_NO_FILE');
  });

  it('SVG 不 inline', async () => {
    const f = (await upload([{ name: '圖.svg', content: SVG }])).json().items[0];
    assert.match(String((await get(`/v1/files/${f.fileUuid}/content?inline=1`)).headers['content-disposition']), /^attachment;/);
  });

  it('不接受非 UUID 的檔案識別', async () => {
    const res = await get('/v1/files/123/content');
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'VALIDATION_FAILED');
  });

  it('實體路徑不可逃出檔案根目錄', async () => {
    const f = (await upload([{ name: 'a.pdf', content: PDF }])).json().items[0];
    repo.files[0]!.storageKey = '../../etc/passwd';
    const res = await get(`/v1/files/${f.fileUuid}/content`);
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().code, 'INTERNAL_ERROR');
    assert.ok(!repo.logs.some((l) => l.action === 'download'), '沒有讀取檔案也不寫下載紀錄');
  });

  it('只能看到自己公司的檔案(第一版資料範圍)', async () => {
    const f = (await upload([{ name: 'a.pdf', content: PDF }])).json().items[0];
    const other = user('S200001', ['禾迅']);
    const res = await get(`/v1/files/${f.fileUuid}`, other);
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, 'DATA_ACCESS_DENIED');
    assert.equal((await get('/v1/files', other)).json().total, 0);
    // 同公司的其他人看得到(兼任多公司也算)
    assert.equal((await get(`/v1/files/${f.fileUuid}`, user('S100001', ['禾迅', '碩禾']))).statusCode, 200);
  });

  it('系統身分只能存取自己上傳的檔案', async () => {
    const f = (await upload([{ name: 'a.pdf', content: PDF }], {}, system('bpm'))).json().items[0];
    assert.equal(f.sourceSystem, 'bpm', '系統身分未指定 sourceSystem 時取自 client 代碼');
    assert.equal(f.companyId, null);
    assert.equal((await get(`/v1/files/${f.fileUuid}`, system('bpm'))).statusCode, 200);
    const res = await get(`/v1/files/${f.fileUuid}`, system('crm'));
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, 'DATA_ACCESS_DENIED');
  });

  it('原檔名的路徑片段被移除', async () => {
    const res = await upload([{ name: '..\\..\\evil.pdf', content: PDF }]);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().items[0].originalName, 'evil.pdf');
  });
});
