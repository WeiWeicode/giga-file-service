/**
 * 舊格式相容層(API.md §4、規則 1–12;LEGACY-SWITCH-PLAN.md §4.2;docs/Gherkin/compat/compat.feature)。
 * 欄位以舊程式為 golden 樣本:filebackend sqlFileController.js、SMBbackend smbFileUploadController.js / SPSmbController.downloadFile,
 * 以及舊前端 BPM bpmcomonent FileUpload.vue、SPfileUpload.vue 實際解析的欄位。記憶體 repo + 暫存目錄,不碰舊來源。
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { FB_LIST_MAX } from '../src/modules/compat/compat-service.js';
import type { NewCompatFile } from '../src/modules/compat/types.js';
import { LocalStore } from '../src/modules/storage/local-store.js';
import { buildTestApp, EXE, MemoryFileRepo, multipart, PDF, PNG, startJwks, user, type Jwks, type Part, type TestApp } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 舊 FileUpload.vue 送的欄位(網址參數 + 表單) */
const FB_FIELDS = {
  platform: 'BPM',
  sourceApplication: '太陽能ECRECN_內容說明',
  sourceNumber: 'ECR-2026-001',
  userNumber: 'S112009',
  role: 'edit',
  class: '內容說明',
};
/** 舊 SPfileUpload.vue 送的欄位 */
const SMB_FIELDS = { sourcePlatform: 'Web', sourceApplication: 'BPM系統', sourceNumber: 'SP-2026-010', userNumber: 'S112009' };

let jwks: Jwks;
let t: TestApp;
let app: FastifyInstance;

before(async () => {
  jwks = await startJwks();
});
after(() => jwks.close());
beforeEach(async () => {
  t = await buildTestApp(jwks, { compat: true });
  app = t.app;
});

async function post(url: string, files: Part[], fields: Record<string, string>, fileField = 'file') {
  const body = await multipart(files, fields, fileField);
  return app.inject({ method: 'POST', url, payload: body.payload, headers: body.headers });
}

/** 模擬 F4 匯入的舊檔:實體寫進 LocalStore,file_object + legacy_file_map */
async function seedLegacy(
  ns: 'fb' | 'smb',
  o: { id: number; path: string; originalName: string; content: Buffer; refNo: string; platform?: string; createdAt?: Date },
) {
  const fileUuid = randomUUID();
  const at = o.createdAt ?? new Date('2026-08-04T08:58:44Z');
  const storageKey = LocalStore.keyFor(fileUuid, at);
  const tmp = await t.store.writeTemp(Readable.from([o.content]), 1 << 30);
  await t.store.commit(tmp.tmpPath, storageKey);
  const filename = o.path.split('/').pop()!;
  const file: NewCompatFile = {
    fileUuid,
    originalName: o.originalName,
    ext: 'pdf',
    mime: 'application/pdf',
    sizeBytes: o.content.length,
    sha256: tmp.sha256,
    storageKey,
    sourceSystem: ns === 'fb' ? (o.platform ?? 'BPM') : 'Web',
    sourceApp: ns === 'fb' ? '太陽能ECRECN_規格' : 'BPM系統',
    refType: null,
    refNo: o.refNo,
    companyId: null,
    uploadedBy: 'S100001',
    uploadedIp: null,
    createdAt: at,
    boundAt: at,
    compatNs: ns,
    compatKey: ns === 'fb' ? String(o.id) : o.path,
    meta: {
      id: o.id,
      filename,
      path: o.path,
      destination: ns === 'fb' ? (o.platform ?? 'BPM') : '根目錄',
      description: null,
      version: null,
      userAgent: null,
      ip: null,
      mimetype: 'application/pdf',
      storageType: 'local',
      nasPath: null,
    },
  };
  await t.compat!.repo.insertLegacy(file, {
    fileUuid,
    legacySource: ns === 'fb' ? 'filebackend' : 'smbbackend',
    legacyDir: ns === 'fb' ? (o.platform ?? 'BPM') : null,
    legacyName: filename,
    legacyDb: 'WebAppDb',
    legacyTable: ns === 'fb' ? 'webFileUpload' : 'smbFileUpload',
    legacyKey: String(o.id),
    sizeBytes: o.content.length,
    mtimeUtc: at,
    sha256: tmp.sha256,
    nasPath: o.path,
    at,
  });
  return fileUuid;
}

describe('相容層路由不需 Gateway 內部 Token、不進 OpenAPI(規則 4;LEGACY-SWITCH-PLAN §5 Q2)', () => {
  it('沒有 X-Internal-Token 也能呼叫;新 API 仍要 Token', async () => {
    assert.equal((await app.inject('/compat/fb/sql-files')).statusCode, 200);
    assert.equal((await app.inject('/v1/files')).statusCode, 401);
  });
  it('OpenAPI 不含 /compat/*(不自動註冊到 Gateway 路由表)', async () => {
    const doc = (await app.inject('/openapi.json')).json();
    assert.deepEqual(
      Object.keys(doc.paths).filter((p) => p.startsWith('/compat')),
      [],
    );
  });
});

describe('filebackend 相容 /compat/fb(API.md §4.1)', () => {
  it('/sql-upload:回應欄位與舊 uploadSingleFileWithDB 相同,id 為新檔 UUID', async () => {
    const res = await post('/compat/fb/sql-upload', [{ name: '報價單.pdf', content: PDF }], { ...FB_FIELDS, description: '說明', version: 'v1' });
    assert.equal(res.statusCode, 200);
    const b = res.json();
    assert.equal(b.success, true);
    assert.equal(b.message, '檔案上傳成功並記錄到資料庫');
    assert.equal(b.databaseLogged, true);
    assert.deepEqual(Object.keys(b.file), ['id', 'filename', 'originalName', 'size', 'mimetype', 'path', 'destination', 'platform', 'uploadDate']);
    assert.match(b.file.id, UUID);
    assert.equal(b.file.filename, `${b.file.id}.pdf`);
    assert.equal(b.file.originalName, '報價單.pdf');
    assert.equal(b.file.size, PDF.length);
    assert.equal(b.file.mimetype, 'application/pdf');
    assert.equal(b.file.platform, 'BPM');
    assert.match(b.file.uploadDate, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    // 不是暫存檔:24 小時清除不可刪掉(沒有單號的也一樣)
    const stored = (t.repo as MemoryFileRepo).files[0]!;
    assert.equal(stored.refNo, 'ECR-2026-001');
    assert.equal(stored.uploadedBy, 'S112009');
    assert.equal(stored.sourceApp, '太陽能ECRECN_內容說明');
  });

  it('/sql-upload-multiple:欄位 files[],一次多檔', async () => {
    const res = await post(
      '/compat/fb/sql-upload-multiple',
      [
        { name: 'a.pdf', content: PDF },
        { name: 'b.png', content: PNG },
      ],
      FB_FIELDS,
      'files',
    );
    assert.equal(res.statusCode, 200);
    const b = res.json();
    assert.equal(b.message, '2 個檔案上傳成功並記錄到資料庫');
    assert.deepEqual(Object.keys(b.files[0]), ['id', 'filename', 'originalName', 'size', 'mimetype', 'path', 'platform', 'uploadDate']);
    assert.equal(b.files[1].mimetype, 'image/png');
  });

  it('無效的平台名稱回 400 舊式錯誤(規則 10);執行檔回 415,不是 Gateway 格式(規則 1)', async () => {
    const bad = await post('/compat/fb/sql-upload', [{ name: 'a.pdf', content: PDF }], { ...FB_FIELDS, platform: 'HRM' });
    assert.equal(bad.statusCode, 400);
    assert.deepEqual(bad.json(), { success: false, message: '無效的平台名稱' });
    const exe = await post('/compat/fb/sql-upload', [{ name: 'setup.exe', content: EXE }], FB_FIELDS);
    assert.equal(exe.statusCode, 415);
    assert.equal(exe.json().success, false);
    assert.equal(exe.json().code, undefined);
    assert.equal((t.repo as MemoryFileRepo).files.length, 0);
  });

  it('platform 不分大小寫並轉大寫;原值寫入,同一應用 BPM / OTHER 不正規化(規則 10、11)', async () => {
    await post('/compat/fb/sql-upload', [{ name: 'a.pdf', content: PDF }], { ...FB_FIELDS, platform: 'other' });
    const b = (await app.inject('/compat/fb/sql-files')).json();
    assert.equal(b.files[0].platform, 'OTHER');
    assert.equal(b.files[0].sourceApplication, '太陽能ECRECN_內容說明');
  });

  it('/sql-files 沒帶 limit 回全部有效檔(修正舊 50 筆缺陷,規則 8);帶 limit / offset 照舊', async () => {
    for (let i = 0; i < 55; i++)
      await seedLegacy('fb', { id: 100 + i, path: `BPM/${randomUUID()}.pdf`, originalName: `${i}.pdf`, content: PDF, refNo: `ECR-${i}` });
    const all = (await app.inject('/compat/fb/sql-files')).json();
    assert.equal(all.total, 55);
    assert.equal(all.files.length, 55);
    const page = (await app.inject('/compat/fb/sql-files?limit=10&offset=50')).json();
    assert.equal(page.total, 55);
    assert.equal(page.files.length, 5);
    assert.ok(FB_LIST_MAX >= 1000);
  });

  it('/sql-files 的 files[] 欄位與舊 getFilesListFromDB 相同;舊檔 id 為舊整數 id', async () => {
    await seedLegacy('fb', {
      id: 140,
      path: 'BPM/5aab33ac-7d26-482d-9abc-3159ee49f887.pdf',
      originalName: '20260312-KQ09.pdf',
      content: PDF,
      refNo: 'ECR-140',
    });
    const f = (await app.inject('/compat/fb/sql-files?platform=BPM')).json().files[0];
    assert.deepEqual(Object.keys(f), [
      'id',
      'filename',
      'originalName',
      'size',
      'mimetype',
      'platform',
      'uploadDate',
      'description',
      'sourceApplication',
      'sourceNumber',
      'version',
    ]);
    assert.equal(f.id, 140);
    assert.equal(f.filename, '5aab33ac-7d26-482d-9abc-3159ee49f887.pdf');
    assert.equal(f.sourceNumber, 'ECR-140');
    // 舊服務格式:台灣時間 16:58 + Z(規則 15)
    assert.equal(f.uploadDate, '2026-08-04T16:58:44.000Z');
    assert.equal((await app.inject('/compat/fb/sql-files?platform=OTHER')).json().total, 0);
  });

  it('/sql-download/:id 同時接受舊整數 id 與 UUID,帶 UTF-8 檔名;不存在回舊式 404', async () => {
    await seedLegacy('fb', { id: 140, path: 'BPM/x.pdf', originalName: '電子發票設定.pdf', content: PDF, refNo: 'ECR-140' });
    const old = await app.inject('/compat/fb/sql-download/140');
    assert.equal(old.statusCode, 200);
    assert.equal(old.rawPayload.toString(), PDF.toString());
    assert.match(String(old.headers['content-disposition']), /filename\*=UTF-8''%E9%9B%BB%E5%AD%90/);
    const up = (await post('/compat/fb/sql-upload', [{ name: 'b.png', content: PNG }], FB_FIELDS)).json();
    assert.equal((await app.inject(`/compat/fb/sql-download/${up.file.id}`)).statusCode, 200);
    const miss = await app.inject('/compat/fb/sql-download/999');
    assert.equal(miss.statusCode, 404);
    assert.deepEqual(miss.json(), { success: false, message: '檔案記錄不存在或已被刪除' });
    assert.equal((await app.inject('/compat/fb/sql-download/abc')).statusCode, 404);
  });

  it('/sql-delete/:id 軟刪除(實體檔保留);再刪一次仍回成功(與舊服務相同),之後清單與下載都看不到', async () => {
    const uuid = await seedLegacy('fb', { id: 7, path: 'BPM/x.pdf', originalName: 'x.pdf', content: PDF, refNo: 'ECR-7' });
    for (let i = 0; i < 2; i++)
      assert.deepEqual((await app.inject({ method: 'DELETE', url: '/compat/fb/sql-delete/7' })).json(), { success: true, message: '檔案刪除成功' });
    assert.equal((await app.inject('/compat/fb/sql-files')).json().total, 0);
    assert.equal((await app.inject('/compat/fb/sql-download/7')).statusCode, 404);
    const f = (t.repo as MemoryFileRepo).files.find((x) => x.fileUuid === uuid)!;
    assert.ok(f.deletedAt);
    assert.equal(await t.store.exists(f.storageKey), true);
    assert.equal((await app.inject({ method: 'DELETE', url: '/compat/fb/sql-delete/8' })).statusCode, 404);
  });

  it('/sql-files-by-source 沒帶單號回 400;依單號完全比對', async () => {
    assert.deepEqual((await app.inject('/compat/fb/sql-files-by-source')).json(), { success: false, message: '請提供單號 (sourceNumber)' });
    await seedLegacy('fb', { id: 1, path: 'BPM/1.pdf', originalName: '1.pdf', content: PDF, refNo: 'ECR-1' });
    await seedLegacy('fb', { id: 2, path: 'BPM/2.pdf', originalName: '2.pdf', content: PDF, refNo: 'ECR-10' });
    const b = (await app.inject('/compat/fb/sql-files-by-source?sourceNumber=ECR-1')).json();
    assert.equal(b.total, 1);
    assert.equal(b.files[0].id, 1);
  });

  it('/sql-stats 欄位與舊 getFileStatsFromDB 相同', async () => {
    await post('/compat/fb/sql-upload', [{ name: 'a.pdf', content: PDF }], FB_FIELDS);
    const s = (await app.inject('/compat/fb/sql-stats')).json();
    assert.deepEqual(Object.keys(s.stats), ['totalFiles', 'totalSize', 'averageSize', 'platforms', 'fileTypes']);
    assert.deepEqual(s.stats.platforms, [{ platform: 'BPM', count: 1, totalSize: PDF.length }]);
  });

  it('沒帶 platform:上傳回應 platform "default",清單回 null(舊表為 NULL),統計歸在 default', async () => {
    const { platform: _p, ...noPlatform } = FB_FIELDS;
    const up = (await post('/compat/fb/sql-upload', [{ name: 'a.pdf', content: PDF }], noPlatform)).json();
    assert.equal(up.file.platform, 'default');
    assert.equal((await app.inject('/compat/fb/sql-files')).json().files[0].platform, null);
    assert.equal((await app.inject('/compat/fb/sql-stats')).json().stats.platforms[0].platform, 'default');
  });

  it('/sql-upload 一次多檔回 400,不留下任何檔案', async () => {
    const res = await post(
      '/compat/fb/sql-upload',
      [
        { name: 'a.pdf', content: PDF },
        { name: 'b.pdf', content: PDF },
      ],
      FB_FIELDS,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
    assert.equal((t.repo as MemoryFileRepo).files.length, 0);
  });

  it('新 API 看不到相容層的檔案(上傳者工號未經驗證,不可當成本人的檔案)', async () => {
    const up = (await post('/compat/fb/sql-upload', [{ name: 'a.pdf', content: PDF }], FB_FIELDS)).json();
    const token = { 'x-internal-token': await jwks.sign(user('S112009')) };
    assert.equal((await app.inject({ url: '/v1/files', headers: token })).json().total, 0);
    assert.equal((await app.inject({ url: `/v1/files/${up.file.id}`, headers: token })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/files/${up.file.id}`, headers: token })).statusCode, 404);
  });

  it('相容層上傳的檔案(沒有單號也一樣)不會被 24 小時暫存清除', async () => {
    const { sourceNumber: _drop, ...noRef } = FB_FIELDS;
    await post('/compat/fb/sql-upload', [{ name: 'a.pdf', content: PDF }], noRef);
    t.clock.now = new Date(t.clock.now.getTime() + 48 * 3600_000);
    assert.equal(await t.service.cleanupTemps(), 0);
  });
});

describe('SMBbackend 相容 /compat/smb/api(API.md §4.2)', () => {
  it('/api/db/upload:回應 data 欄位與舊服務相同,path = {uuid}{副檔名};預設值與舊服務相同', async () => {
    const res = await post('/compat/smb/api/db/upload', [{ name: '管制計劃.pdf', content: PDF }], SMB_FIELDS);
    assert.equal(res.statusCode, 200);
    const b = res.json();
    assert.equal(b.message, '檔案上傳並記錄到資料庫成功');
    assert.deepEqual(Object.keys(b.data), [
      'id',
      'fileName',
      'originalFileName',
      'path',
      'size',
      'mimetype',
      'uploadDate',
      'description',
      'userNumber',
      'ip',
      'effective',
    ]);
    assert.equal(b.data.path, `${b.data.id}.pdf`);
    assert.equal(b.data.effective, true);
    const row = (await app.inject(`/compat/smb/api/db/search?sourceNumber=${SMB_FIELDS.sourceNumber}&effective=true`)).json().data[0];
    assert.equal(row.storageType, 'Local');
    assert.equal(row.version, '1.0');
    assert.equal(row.destination, '根目錄');
  });

  it('上傳的 path 含 .. 回 400,不寫入任何檔案(不重現舊 localdownload 穿越問題)', async () => {
    const res = await post('/compat/smb/api/db/upload', [{ name: 'a.pdf', content: PDF }], { ...SMB_FIELDS, path: '../etc' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
    assert.equal((t.repo as MemoryFileRepo).files.length, 0);
  });

  it('/api/db/search:依單號完全比對 + effective;data[] 為 smbFileUpload 全欄位', async () => {
    await seedLegacy('smb', { id: 31, path: '電子發票設定.pdf', originalName: '電子發票設定.pdf', content: PDF, refNo: 'SP-1' });
    await seedLegacy('smb', { id: 32, path: 'x.pdf', originalName: 'x.pdf', content: PDF, refNo: 'SP-10' });
    const b = (await app.inject('/compat/smb/api/db/search?sourceNumber=SP-1&effective=true')).json();
    assert.equal(b.success, true);
    assert.equal(b.count, 1);
    assert.deepEqual(Object.keys(b.data[0]), [
      'id', 'filename', 'originalName', 'filesize', 'mimetype', 'path', 'destination', 'Description', 'SourcePlatform', 'SourceApplication',
      'SourceNumber', 'userAgent', 'userNumber', 'Effective', 'storageType', 'ip', 'version', 'nasPath', 'uploadDate',
    ]); // prettier-ignore
    assert.equal(b.data[0].id, 31);
    assert.equal(b.data[0].Effective, true);
  });

  it('/api/download:舊中文原檔名 path 與新 UUID path 都查得到(規則 12);缺 path 回 400、找不到回 404,錯誤欄位為 error', async () => {
    await seedLegacy('smb', { id: 31, path: '電子發票設定.pdf', originalName: '電子發票設定.pdf', content: PDF, refNo: 'SP-1' });
    const old = await app.inject({ method: 'GET', url: `/compat/smb/api/download?path=${encodeURIComponent('電子發票設定.pdf')}` });
    assert.equal(old.statusCode, 200);
    assert.equal(old.headers['content-type'], 'application/octet-stream');
    const up = (await post('/compat/smb/api/db/upload', [{ name: 'b.png', content: PNG }], SMB_FIELDS)).json();
    const neu = await app.inject(`/compat/smb/api/download?path=${up.data.path}`);
    assert.equal(createHash('sha256').update(neu.rawPayload).digest('hex'), createHash('sha256').update(PNG).digest('hex'));
    assert.deepEqual((await app.inject('/compat/smb/api/download')).json(), { success: false, error: '請提供檔案路徑參數 (path)' });
    assert.deepEqual((await app.inject('/compat/smb/api/download?path=nope.pdf')).json(), { success: false, error: '檔案不存在: nope.pdf' });
  });

  it('/api/db/delete?path= 軟刪除並回 databaseId;找不到的 path 照舊回成功(not_found)', async () => {
    await seedLegacy('smb', { id: 31, path: '電子發票設定.pdf', originalName: '電子發票設定.pdf', content: PDF, refNo: 'SP-1' });
    const del = (await app.inject({ method: 'DELETE', url: `/compat/smb/api/db/delete?path=${encodeURIComponent('電子發票設定.pdf')}` })).json();
    assert.deepEqual(del, {
      success: true,
      message: '檔案刪除成功並更新資料庫狀態',
      data: { path: '電子發票設定.pdf', type: 'file', databaseId: 31, effectiveStatus: false },
    });
    assert.equal((await app.inject('/compat/smb/api/db/search?sourceNumber=SP-1&effective=true')).json().count, 0);
    assert.equal((await app.inject('/compat/smb/api/db/search?sourceNumber=SP-1&effective=false')).json().count, 1);
    const miss = (await app.inject({ method: 'DELETE', url: '/compat/smb/api/db/delete?path=nope.pdf' })).json();
    assert.equal(miss.data.databaseRecord, 'not_found');
    assert.equal((await app.inject({ method: 'DELETE', url: '/compat/smb/api/db/delete' })).statusCode, 400);
  });

  it('uploadDate 與舊服務同格式(台灣時間 + Z),SPfileUpload.vue 的 formatDate 解析得到台灣時間', async () => {
    t.clock.now = new Date('2026-10-07T10:31:00.000Z'); // 台灣 18:31
    await post('/compat/smb/api/db/upload', [{ name: 'a.pdf', content: PDF }], SMB_FIELDS);
    const d: string = (await app.inject(`/compat/smb/api/db/search?sourceNumber=${SMB_FIELDS.sourceNumber}`)).json().data[0].uploadDate;
    // 照抄舊前端:去掉 Z 補 +00:00,取 UTC 欄位顯示
    const date = new Date(d.replace('Z', '') + '+00:00');
    assert.equal(`${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()} ${date.getUTCHours()}:${date.getUTCMinutes()}`, '2026/10/7 18:31');
  });

  it('/api/db/files/:id 以舊整數 id 查(含已刪除)', async () => {
    await seedLegacy('smb', { id: 31, path: 'a.pdf', originalName: 'a.pdf', content: PDF, refNo: 'SP-1' });
    assert.equal((await app.inject('/compat/smb/api/db/files/31')).json().data.path, 'a.pdf');
    assert.equal((await app.inject('/compat/smb/api/db/files/32')).statusCode, 404);
  });
});
