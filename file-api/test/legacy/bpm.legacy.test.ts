/**
 * BPM 附件真實來源冒煙測試(唯讀;npm run test:legacy):測試區 191 的 NaNa(BPM_TEST_DB_*,未設定沿用 BPM_DB_*;唯讀帳號 file_bpm_ro)
 * 與 5144(BPM_TEST_FILE_URL、BPM_TEST_FILE_API_KEY)。
 *   - 只執行 SELECT 與 GET;不寫入 NaNa、不改 5144 上的檔案
 *   - 未設定 DB_HOST 時明確失敗並說明「未查詢」,不當作沒有附件
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { BpmDocServer, chunks } from '../../src/modules/bpm/doc-server.js';
import { NanaBpmRepo } from '../../src/modules/bpm/nana-repo.js';

/** 測試區設定:BPM_TEST_* 優先,沿用最初的 BPM_*(同 config.ts) */
const v = (k: string) => process.env[`BPM_TEST_${k}`] || process.env[`BPM_${k}`];
const host = v('DB_HOST');
if (!host) throw new Error('BPM_TEST_DB_HOST 未設定(NaNa 唯讀帳號,file-api/.env);未查詢');
const repo = new NanaBpmRepo({
  server: host,
  port: Number(v('DB_PORT') ?? 1433),
  database: v('DB_NAME') || 'NaNa',
  user: v('DB_USER')!,
  password: v('DB_PASSWORD')!,
});
after(() => repo.close());

/** 2026-10-08 在 191 確認存在、有 3 個附件(physicalName 25 字元)的單號 */
const SERIAL = 'CustomerComplaintProcess00000014';

describe('BPM NaNa(唯讀)', () => {
  it('依單號完全比對:有附件,前綴相同的單號不會混入', async () => {
    const list = await repo.bySerialNumber(SERIAL);
    assert.ok(list.length > 0, `${SERIAL} 應有附件`);
    assert.ok(list.every((a) => a.serialNumber === SERIAL));
    assert.ok(list.every((a) => /^[0-9a-f]{32}$/.test(a.doid)));
    assert.equal((await repo.bySerialNumber(SERIAL.slice(0, -1))).length, 0, '不用 LIKE');
  });

  it('依 Doid 取得附件與所屬單號', async () => {
    const [first] = await repo.bySerialNumber(SERIAL);
    const one = await repo.byDoid(first!.doid);
    assert.equal(one?.serialNumber, SERIAL);
    assert.equal(one?.originalName, first!.originalName);
  });
});

describe('BPM 取檔服務 5144(唯讀)', { skip: !v('FILE_API_KEY') && 'BPM_TEST_FILE_API_KEY 未設定' }, () => {
  it('依預測段數第一次就取到附件,內容非空', async () => {
    const docs = new BpmDocServer({ baseUrl: v('FILE_URL')!, apiKey: v('FILE_API_KEY')! });
    const [a] = await repo.bySerialNumber(SERIAL);
    const { stream, size, segments } = await docs.open(a!.physicalName, a!.ext);
    let bytes = 0;
    for await (const c of stream) bytes += (c as Buffer).length;
    assert.ok(bytes > 0);
    if (size !== null) assert.equal(bytes, size);
    assert.equal(segments, chunks(a!.physicalName).length - 2, '目錄 = 去掉第一段與最後一段');
  });
});
