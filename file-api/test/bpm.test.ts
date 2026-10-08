/**
 * BPM 表單附件(F6;docs/Gherkin/bpm/attachments.feature、API.md §3)。
 * NaNa 以記憶體 repo 模擬;5144 以本機 HTTP 伺服器模擬(檔案放在依目錄規則推算的路徑,驗證 X-API-Key)。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { candidateSegments, chunks, dirFor } from '../src/modules/bpm/doc-server.js';
import type { BpmAttachment, BpmRepo } from '../src/modules/bpm/types.js';
import { buildTestApp, MemoryFileRepo, startJwks, user, type Jwks, type TestApp } from './helpers.js';

const KEY = 'test-5144-key';

class MemoryBpmRepo implements BpmRepo {
  constructor(readonly items: BpmAttachment[]) {}
  async bySerialNumber(sn: string) {
    return this.items.filter((a) => a.serialNumber === sn);
  }
  async byDoid(doid: string) {
    return this.items.find((a) => a.doid === doid) ?? null;
  }
}

const att = (over: Partial<BpmAttachment>): BpmAttachment => ({
  doid: 'e33374b8000000000000000000000001',
  originalName: '客戶反應mail.xlsx',
  ext: 'xlsx',
  physicalName: 'x5491d50x140f277331dx1005',
  createdAt: new Date('2026-07-13T07:30:40Z'),
  serialNumber: 'CustomerComplaintProcess00000014',
  formName: '客訴抱怨單',
  subject: '客訴抱怨單GCCF2026070002',
  ...over,
});

/** 模擬 5144:files 的 key 為 /download/ 之後的路徑 */
interface Fake5144 {
  url: string;
  files: Map<string, Buffer>;
  requests: string[];
  close: () => void;
}
async function start5144(): Promise<Fake5144> {
  const files = new Map<string, Buffer>();
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url!);
    if (req.headers['x-api-key'] !== KEY) return res.writeHead(403, { 'content-type': 'application/json' }).end('{"detail":"Could not validate credentials"}');
    const body = files.get(decodeURIComponent(req.url!.replace(/^\/download\//, '')));
    if (!body) return res.writeHead(404, { 'content-type': 'application/json' }).end('{"detail":"File not found"}');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, files, requests, close: () => server.close() };
}

const place = (f: Fake5144, a: BpmAttachment, segments: number, body: Buffer) =>
  f.files.set(`${dirFor(a.physicalName, segments)}/${a.physicalName}${a.ext ? `.${a.ext}` : ''}`, body);

let jwks: Jwks;
let fake: Fake5144;
let t: TestApp;
const auth = async () => ({ 'x-internal-token': await jwks.sign(user('S112009')) });
const get = async (url: string) => t.app.inject({ method: 'GET', url, headers: await auth() });

before(async () => {
  jwks = await startJwks();
  fake = await start5144();
});
after(() => {
  jwks.close();
  fake.close();
});

describe('目錄規則(LEGACY-INVENTORY §5)', () => {
  it('與 BPMbackend 註解範例相同:x5491d50x140f277331dx1005 → 11 段反向', () => {
    assert.equal(dirFor('x5491d50x140f277331dx1005', 11), '00/x1/1d/33/77/f2/40/x1/50/1d/49');
  });
  it('預測段數(段數 − 2)優先,再補 11 / 10 / 12,相同目錄只試一次', () => {
    assert.deepEqual(candidateSegments('a'.repeat(25)), [11, 10, 12]);
    assert.deepEqual(candidateSegments('a'.repeat(24)), [10, 11], '24 字元只有 12 段,11 與 12 組出相同目錄');
    assert.deepEqual(candidateSegments('a'.repeat(27)), [12, 11, 10]);
    assert.deepEqual(candidateSegments('a'.repeat(21)), [9, 11], '21 字元只有 11 段,10 與 11 組出相同目錄');
    assert.deepEqual(candidateSegments('a'.repeat(32)), [14, 11, 10, 12]);
    assert.equal(chunks('abcde').length, 3);
  });
});

describe('BPM 附件 API', () => {
  let repo: MemoryFileRepo;
  let bpm: MemoryBpmRepo;
  beforeEach(async () => {
    fake.files.clear();
    fake.requests.length = 0;
    bpm = new MemoryBpmRepo([
      att({}),
      att({ doid: 'e4876108000000000000000000000002', originalName: 'IT11150520 黏度過低異常', ext: 'xls', physicalName: 'abcdefghijklmnopqrstuvwx' }),
      att({ doid: 'f0000000000000000000000000000003', serialNumber: 'CustomerComplaintProcess000000140', originalName: '別張單.pdf', ext: 'pdf' }),
      att({
        doid: 'a0000000000000000000000000000004',
        originalName: '../../etc/passwd',
        ext: 'pdf',
        physicalName: '../../../etc/passwd',
        serialNumber: 'BAD_1',
      }),
    ]);
    t = await buildTestApp(jwks, { bpm: { repo: bpm, fileUrl: fake.url, apiKey: KEY } });
    repo = t.repo as MemoryFileRepo;
  });

  it('場景: 依單號完全比對', async () => {
    const res = await get('/v1/bpm/forms/CustomerComplaintProcess00000014/attachments');
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.source, '10.10.130.191');
    assert.deepEqual(
      body.items.map((i: { doid: string }) => i.doid),
      ['e33374b8000000000000000000000001', 'e4876108000000000000000000000002'],
      '不含 CustomerComplaintProcess000000140',
    );
    assert.ok(!res.body.includes('physicalName') && !res.body.includes('x5491d50'), '不回傳 physicalName');
    assert.equal(body.items[0].createdAt, '2026-07-13T07:30:40.000Z');
  });

  it('單號格式錯誤回 400;查無附件回空清單', async () => {
    assert.equal((await get('/v1/bpm/forms/abc%25/attachments')).statusCode, 400);
    assert.equal((await get('/v1/bpm/forms/THR005.00000519/attachments')).statusCode, 400);
    const empty = await get('/v1/bpm/forms/NOPE_1/attachments');
    assert.deepEqual(empty.json().items, []);
  });

  it('場景: 查詢單一附件;Doid 不是 32 碼十六進位回 400,不存在回 404', async () => {
    const res = await get('/v1/bpm/attachments/E33374B8000000000000000000000001');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().serialNumber, 'CustomerComplaintProcess00000014');
    assert.equal((await get('/v1/bpm/attachments/xyz')).statusCode, 400);
    const missing = await get('/v1/bpm/attachments/00000000000000000000000000000000');
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().code, 'FILE_BPM_NOT_FOUND');
  });

  it('場景: 下載 BPM 附件並帶 UTF-8 檔名,寫入操作紀錄', async () => {
    const a = bpm.items[0]!;
    place(fake, a, 11, Buffer.from('xlsx-content'));
    const res = await get(`/v1/bpm/attachments/${a.doid}/content`);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.body, 'xlsx-content');
    assert.equal(res.headers['content-length'], '12');
    assert.match(String(res.headers['content-disposition']), /^attachment; .*filename\*=UTF-8''%E5%AE%A2%E6%88%B6/);
    assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(repo.logs.at(-1), {
      fileUuid: null,
      action: 'bpm_download',
      userId: 'S112009',
      ip: '127.0.0.1',
      requestId: repo.logs.at(-1)!.requestId,
      detail: `${a.doid} CustomerComplaintProcess00000014 test`,
    });
    assert.equal(fake.requests.length, 1, '預測段數第一次就命中');
  });

  it('預測段數找不到時改試 11 / 10 / 12,找到的段數快取,下次只打一次', async () => {
    const a = bpm.items[0]!; // 25 字元:預測 11
    place(fake, a, 12, Buffer.from('v12'));
    assert.equal((await get(`/v1/bpm/attachments/${a.doid}/content`)).body, 'v12');
    assert.equal(fake.requests.length, 3, '11 → 10 → 12');
    fake.requests.length = 0;
    assert.equal((await get(`/v1/bpm/attachments/${a.doid}/content`)).body, 'v12');
    assert.equal(fake.requests.length, 1, '快取命中');
  });

  it('原檔名沒有副檔名時補上;?inline=1 只對 PDF / 圖片', async () => {
    const a = bpm.items[1]!;
    place(fake, a, 10, Buffer.from('xls'));
    const res = await get(`/v1/bpm/attachments/${a.doid}/content?inline=1`);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-disposition']), /^attachment; /, 'xls 不 inline');
    assert.match(String(res.headers['content-disposition']), /%E7%95%B0%E5%B8%B8\.xls$/, '補上 .xls');
  });

  it('實體檔找不到回 404 FILE_BPM_NOT_FOUND,不寫操作紀錄', async () => {
    const before = repo.logs.length;
    const res = await get(`/v1/bpm/attachments/${bpm.items[0]!.doid}/content`);
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().code, 'FILE_BPM_NOT_FOUND');
    assert.equal(repo.logs.length, before);
  });

  it('5144 金鑰錯誤回 502 FILE_BPM_UPSTREAM', async () => {
    t = await buildTestApp(jwks, { bpm: { repo: bpm, fileUrl: fake.url, apiKey: 'wrong' } });
    const res = await get(`/v1/bpm/attachments/${bpm.items[0]!.doid}/content`);
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().code, 'FILE_BPM_UPSTREAM');
    assert.match(res.json().message, /403/);
  });

  it('5144 連不上回 502', async () => {
    t = await buildTestApp(jwks, { bpm: { repo: bpm, fileUrl: 'http://127.0.0.1:1', apiKey: KEY } });
    const res = await get(`/v1/bpm/attachments/${bpm.items[0]!.doid}/content`);
    assert.equal(res.statusCode, 502);
  });

  it('資料庫的 physicalName 含路徑字元時拒絕,不送到 5144', async () => {
    const res = await get(`/v1/bpm/attachments/${bpm.items[3]!.doid}/content`);
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().code, 'FILE_BPM_BAD_RECORD');
    assert.equal(fake.requests.length, 0);
  });

  it('沒有內部 Token 回 401', async () => {
    assert.equal((await t.app.inject('/v1/bpm/forms/CustomerComplaintProcess00000014/attachments')).statusCode, 401);
  });
});

describe('測試區 191 / 正式區 190 兩個來源', () => {
  const testRepo = new MemoryBpmRepo([att({ doid: '11111111111111111111111111111111', originalName: '測試區.pdf', ext: 'pdf' })]);
  const prodRepo = new MemoryBpmRepo([att({ doid: '22222222222222222222222222222222', originalName: '正式區.pdf', ext: 'pdf' })]);

  it('場景: 列出 BPM 來源;?env= 切換來源,未指定用預設來源', async () => {
    t = await buildTestApp(jwks, {
      bpm: [
        { repo: testRepo, fileUrl: fake.url, apiKey: KEY, env: 'test' },
        { repo: prodRepo, fileUrl: fake.url, apiKey: KEY, env: 'prod' },
      ],
    });
    const src = (await get('/v1/bpm/sources')).json();
    assert.equal(src.defaultEnv, 'test');
    assert.deepEqual(src.items, [
      { env: 'test', label: '測試區', source: '10.10.130.191' },
      { env: 'prod', label: '正式區', source: '10.10.130.190' },
    ]);
    const sn = 'CustomerComplaintProcess00000014';
    const dflt = (await get(`/v1/bpm/forms/${sn}/attachments`)).json();
    assert.deepEqual([dflt.env, dflt.label, dflt.items[0].originalName], ['test', '測試區', '測試區.pdf']);
    const prod = (await get(`/v1/bpm/forms/${sn}/attachments?env=prod`)).json();
    assert.deepEqual([prod.env, prod.source, prod.items[0].originalName], ['prod', '10.10.130.190', '正式區.pdf']);
    assert.equal((await get(`/v1/bpm/attachments/22222222222222222222222222222222`)).statusCode, 404, 'Doid 要搭配查到它的 env');
    assert.equal((await get(`/v1/bpm/attachments/22222222222222222222222222222222?env=prod`)).statusCode, 200);
    assert.equal((await get(`/v1/bpm/forms/${sn}/attachments?env=dev`)).statusCode, 400);
  });

  it('下載紀錄含來源 env', async () => {
    t = await buildTestApp(jwks, { bpm: [{ repo: prodRepo, fileUrl: fake.url, apiKey: KEY, env: 'prod' }] });
    const a = prodRepo.items[0]!;
    place(fake, a, 11, Buffer.from('prod'));
    const res = await get(`/v1/bpm/attachments/${a.doid}/content?env=prod`);
    assert.equal(res.body, 'prod');
    assert.match((t.repo as MemoryFileRepo).logs.at(-1)!.detail!, / prod$/);
  });

  it('只設定其中一個來源時,另一個回 409', async () => {
    t = await buildTestApp(jwks, { bpm: { repo: testRepo, fileUrl: fake.url, apiKey: KEY } });
    const res = await get('/v1/bpm/forms/CustomerComplaintProcess00000014/attachments?env=prod');
    assert.equal(res.statusCode, 409);
    assert.match(res.json().message, /正式區/);
    assert.deepEqual(
      (await get('/v1/bpm/sources')).json().items.map((i: { env: string }) => i.env),
      ['test'],
    );
  });
});

describe('未設定 BPM 的環境', () => {
  it('回 409 FILE_BPM_DISABLED;路由仍在 OpenAPI(自動註冊到 Gateway)', async () => {
    t = await buildTestApp(jwks);
    const res = await get('/v1/bpm/forms/CustomerComplaintProcess00000014/attachments');
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'FILE_BPM_DISABLED');
    assert.deepEqual((await get('/v1/bpm/sources')).json(), { defaultEnv: null, items: [] });
    const doc = (await t.app.inject('/openapi.json')).json();
    assert.equal(doc.paths['/v1/bpm/attachments/{doid}/content'].get['x-permission'], 'file.bpm.read');
    assert.ok(doc['x-permissions'].some((p: { code: string }) => p.code === 'file.bpm.read'));
  });
});
