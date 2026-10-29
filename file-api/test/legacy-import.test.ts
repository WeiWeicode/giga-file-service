/**
 * filebackend / SMBbackend 舊檔匯入(F4;LEGACY-SWITCH-PLAN.md §3 A1、§4.1;docs/Gherkin/legacy/import.feature)。
 * NAS 以暫存目錄模擬、WebAppDb 以假資料列模擬,記憶體 repo;不碰真實 NAS 與 WebAppDb(AGENT.md §9)。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { FB_SPEC_DIRS, legacyRel, runImport, taipeiDate, type ImportSourceSpec } from '../src/modules/legacy/legacy-import.js';
import { ReadonlySource } from '../src/modules/legacy/readonly-source.js';
import type { LegacyRow } from '../src/modules/legacy/webappdb.js';
import { buildTestApp, EXE, listStored, MemoryFileRepo, PDF, PNG, startJwks, type Jwks, type TestApp } from './helpers.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let jwks: Jwks;
let t: TestApp;
let nasRoot: string;

const row = (o: Partial<LegacyRow> & { id: number }): LegacyRow => ({
  filename: null,
  originalName: null,
  filesize: null,
  mimetype: 'application/pdf',
  path: null,
  destination: null,
  Description: null,
  SourcePlatform: 'BPM',
  SourceApplication: '太陽能ECRECN_內容說明',
  SourceNumber: 'ECR-1',
  userAgent: 'Mozilla/5.0',
  userNumber: 'S100001',
  Effective: true,
  storageType: 'local',
  ip: '::ffff:172.19.0.1',
  version: null,
  nasPath: null,
  uploadDate: '2026-08-04T16:58:44.780',
  ...o,
});

const put = (rel: string, content: Buffer) => {
  const p = path.join(nasRoot, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
};

const fbSpec = (): ImportSourceSpec => ({
  ns: 'fb',
  legacySource: 'filebackend',
  table: 'webFileUpload',
  nas: new ReadonlySource('filebackend', nasRoot),
  scanDirs: FB_SPEC_DIRS,
});
const smbSpec = (): ImportSourceSpec => ({
  ns: 'smb',
  legacySource: 'smbbackend',
  table: 'smbFileUpload',
  nas: new ReadonlySource('smbbackend', path.join(nasRoot, 'CP')),
  scanDirs: [''],
});

const run = (spec: ImportSourceSpec, rows: LegacyRow[], apply: boolean) => runImport({ spec, rows, repo: t.compat!.repo, store: t.store, apply });

before(async () => {
  jwks = await startJwks();
});
after(() => jwks.close());
beforeEach(async () => {
  t = await buildTestApp(jwks, { compat: true });
  nasRoot = mkdtempSync(path.join(tmpdir(), 'file-legacy-nas-'));
});

describe('路徑與時間', () => {
  it('filebackend 的容器絕對路徑取 files/ 之後;SMB 用 path;含 .. 視為異常', () => {
    assert.equal(legacyRel({ ns: 'fb' }, row({ id: 1, path: '/usr/src/app/files/BPM/a.png' })), 'BPM/a.png');
    assert.equal(legacyRel({ ns: 'fb' }, row({ id: 1, path: null, filename: 'a.png', SourcePlatform: 'OTHER' })), 'OTHER/a.png');
    assert.equal(legacyRel({ ns: 'smb' }, row({ id: 1, path: '電子發票設定.docx' })), '電子發票設定.docx');
    assert.equal(legacyRel({ ns: 'smb' }, row({ id: 1, path: '../etc/passwd' })), null);
  });
  it('uploadDate(台灣時間,無時區)轉 UTC;毫秒為 0 時 CONVERT 126 不帶小數也可解析', () => {
    assert.equal(taipeiDate('2026-08-04T16:58:44.780').toISOString(), '2026-08-04T08:58:44.780Z');
    assert.equal(taipeiDate('2026-08-04T16:58:44').toISOString(), '2026-08-04T08:58:44.000Z');
  });
});

describe('filebackend 乾跑與匯入(MIGRATION.md §2)', () => {
  it('乾跑分類:可匯入、斷鏈、無效列、執行檔;孤兒檔;重複內容;不寫入任何東西', async () => {
    put('BPM/a.pdf', PDF);
    put('OTHER/b.pdf', PDF); // 與 a 內容相同
    put('BPM/orphan.png', PNG);
    put('OTHER/x.exe', EXE);
    const rows = [
      row({ id: 1, path: '/usr/src/app/files/BPM/a.pdf', filename: 'a.pdf', originalName: '報價單.pdf' }),
      row({ id: 2, path: '/usr/src/app/files/OTHER/b.pdf', filename: 'b.pdf', SourcePlatform: 'OTHER' }),
      row({ id: 3, path: '/usr/src/app/files/BPM/gone.pdf', filename: 'gone.pdf' }),
      row({ id: 4, path: '/usr/src/app/files/BPM/old.pdf', filename: 'old.pdf', Effective: false }),
      row({ id: 5, path: '/usr/src/app/files/OTHER/x.exe', filename: 'x.exe' }),
    ];
    const r = await run(fbSpec(), rows, false);
    assert.deepEqual(
      r.items.map((i) => [i.legacyId, i.status]),
      [
        [1, 'import'],
        [2, 'import'],
        [3, 'missing'],
        [4, 'inactive'],
        [5, 'blocked'],
      ],
    );
    assert.deepEqual(
      r.orphans.map((o) => o.rel),
      ['BPM/orphan.png'],
    );
    assert.deepEqual(r.duplicates, [{ sha256: sha(PDF), legacyIds: [1, 2] }]);
    assert.equal((t.repo as MemoryFileRepo).files.length, 0);
  });

  it('--apply:複製到本機、SHA-256 相符,寫 file_object + legacy_file_map;舊來源檔案不變;重跑不重複', async () => {
    put('BPM/a.pdf', PDF);
    const before = statSync(path.join(nasRoot, 'BPM/a.pdf')).mtimeMs;
    const rows = [row({ id: 140, path: '/usr/src/app/files/BPM/a.pdf', filename: 'a.pdf', originalName: '電子發票設定.pdf', Description: '說明' })];
    const r = await run(fbSpec(), rows, true);
    assert.equal(r.items[0]!.result, 'imported');
    const f = (t.repo as MemoryFileRepo).files[0]!;
    assert.equal(f.sha256, sha(PDF));
    assert.equal(f.originalName, '電子發票設定.pdf');
    assert.equal(f.refNo, 'ECR-1');
    assert.equal(f.sourceSystem, 'BPM');
    assert.equal(f.createdAt.toISOString(), '2026-08-04T08:58:44.780Z');
    assert.equal(f.backupStatus, 'pending');
    assert.equal(sha(readFileSync(path.join(t.root, f.storageKey))), sha(PDF));
    const m = t.compat!.repo.maps[0]!;
    assert.deepEqual([m.legacySource, m.legacyDir, m.legacyName, m.legacyKey, m.legacyTable], ['filebackend', 'BPM', 'a.pdf', '140', 'webFileUpload']);
    assert.equal(statSync(path.join(nasRoot, 'BPM/a.pdf')).mtimeMs, before);

    // 經相容層以舊 id 下載
    const dl = await t.app.inject('/compat/fb/sql-download/140');
    assert.equal(dl.statusCode, 200);
    assert.equal(sha(dl.rawPayload), sha(PDF));

    const again = await run(fbSpec(), rows, true);
    assert.equal(again.items[0]!.status, 'imported');
    assert.equal(again.items[0]!.result, undefined);
    assert.equal((t.repo as MemoryFileRepo).files.length, 1);
  });

  it('已匯入、之後舊表改為無效(切換前舊服務刪除):--apply 軟刪除新服務的檔案', async () => {
    put('BPM/a.pdf', PDF);
    await run(fbSpec(), [row({ id: 9, path: '/usr/src/app/files/BPM/a.pdf', filename: 'a.pdf' })], true);
    const dry = await run(fbSpec(), [row({ id: 9, path: '/usr/src/app/files/BPM/a.pdf', filename: 'a.pdf', Effective: false })], false);
    assert.equal(dry.items[0]!.status, 'delete');
    await run(fbSpec(), [row({ id: 9, path: '/usr/src/app/files/BPM/a.pdf', filename: 'a.pdf', Effective: false })], true);
    assert.ok((t.repo as MemoryFileRepo).files[0]!.deletedAt);
    assert.equal((await t.app.inject('/compat/fb/sql-download/9')).statusCode, 404);
  });

  it('NAS 根目錄不存在時停止(未查詢),不當作 0 個檔案', async () => {
    const spec = { ...fbSpec(), nas: new ReadonlySource('filebackend', path.join(nasRoot, 'nope')) };
    await assert.rejects(run(spec, [], false), /無法存取/);
  });
});

describe('SMBbackend 匯入(規則 12)', () => {
  it('同一 path 被兩張表單引用(實例 smbFileUpload 58 / 65):兩筆都匯入,兩個單號都查得到;較舊的對照列為非現行', async () => {
    put('CP/管制計劃.pdf', PDF);
    const rows = [10, 12].map((id) =>
      row({ id, path: '管制計劃.pdf', filename: '管制計劃.pdf', originalName: '管制計劃.pdf', SourcePlatform: 'Web', SourceNumber: `SP-${id}` }),
    );
    const r = await run(smbSpec(), rows, true);
    assert.deepEqual(
      r.items.map((i) => [i.legacyId, i.result, i.sharedPath ?? false]),
      [
        [10, 'imported', true],
        [12, 'imported', false],
      ],
    );
    assert.deepEqual(
      t.compat!.repo.maps.map((m) => [m.legacyKey, m.isCurrent ?? true]),
      [
        ['10', false],
        ['12', true],
      ],
    );
    for (const sn of ['SP-10', 'SP-12']) assert.equal((await t.app.inject(`/compat/smb/api/db/search?sourceNumber=${sn}&effective=true`)).json().count, 1);
    assert.equal((await t.app.inject(`/compat/smb/api/download?path=${encodeURIComponent('管制計劃.pdf')}`)).statusCode, 200);
  });

  it('寫入資料庫失敗:記為 error,已複製的本機檔移除(不留有檔無紀錄),其他筆照常', async () => {
    put('CP/a.pdf', PDF);
    put('CP/b.pdf', PNG);
    const repo = t.compat!.repo;
    const failing = Object.assign(Object.create(Object.getPrototypeOf(repo)), repo, {
      insertLegacy: async (f: Parameters<typeof repo.insertLegacy>[0], m: Parameters<typeof repo.insertLegacy>[1]) => {
        if (m.legacyKey === '1') throw new Error('模擬資料庫錯誤');
        return repo.insertLegacy(f, m);
      },
    });
    const rows = [row({ id: 1, path: 'a.pdf', filename: 'a.pdf' }), row({ id: 2, path: 'b.pdf', filename: 'b.pdf', originalName: 'b.png' })];
    const r = await runImport({ spec: smbSpec(), rows, repo: failing, store: t.store, apply: true });
    assert.equal(r.items[0]!.result, 'error');
    assert.match(r.items[0]!.error!, /模擬資料庫錯誤/);
    assert.equal(r.items[1]!.result, 'imported');
    const stored = listStored(t.root).stored;
    assert.equal(stored.length, 1, '只剩成功那一筆的本機檔');
    assert.equal(listStored(t.root).tmp, 0);
  });

  it('中文原檔名 path 匯入後,相容層以原 path 下載', async () => {
    put('CP/電子發票設定.pdf', PDF);
    const r = await run(
      smbSpec(),
      [
        row({
          id: 31,
          path: '電子發票設定.pdf',
          filename: '電子發票設定.pdf',
          originalName: '電子發票設定.pdf',
          SourcePlatform: 'Web',
          SourceApplication: 'BPM系統',
          SourceNumber: 'SP-1',
        }),
      ],
      true,
    );
    assert.equal(r.items[0]!.result, 'imported');
    const dl = await t.app.inject(`/compat/smb/api/download?path=${encodeURIComponent('電子發票設定.pdf')}`);
    assert.equal(dl.statusCode, 200);
    const row0 = (await t.app.inject('/compat/smb/api/db/search?sourceNumber=SP-1&effective=true')).json().data[0];
    assert.equal(row0.id, 31);
    assert.equal(row0.path, '電子發票設定.pdf');
    assert.equal(row0.SourcePlatform, 'Web');
  });
});
