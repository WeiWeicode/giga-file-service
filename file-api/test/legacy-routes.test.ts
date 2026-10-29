/**
 * 舊系統匯入檔案 API(「舊系統」Tab;API.md §2 /api/file/legacy;PRD §8)。
 * 以 F4 匯入工具把暫存目錄模擬的 NAS 檔匯入記憶體 repo,再經 API 查詢與下載。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { runImport, type ImportSourceSpec } from '../src/modules/legacy/legacy-import.js';
import { ReadonlySource } from '../src/modules/legacy/readonly-source.js';
import type { LegacyRow } from '../src/modules/legacy/webappdb.js';
import { buildTestApp, PDF, PNG, startJwks, user, type Jwks, type TestApp } from './helpers.js';

let jwks: Jwks;
let t: TestApp;
let nas: string;
let auth: Record<string, string>;

const row = (o: Partial<LegacyRow> & { id: number }): LegacyRow => ({
  filename: null,
  originalName: null,
  filesize: null,
  mimetype: 'application/pdf',
  path: null,
  destination: null,
  Description: null,
  SourcePlatform: 'Web',
  SourceApplication: 'BPM系統',
  SourceNumber: null,
  userAgent: null,
  userNumber: 'S100001',
  Effective: true,
  storageType: 'Local',
  ip: null,
  version: null,
  nasPath: null,
  uploadDate: '2026-08-04T16:58:44.780',
  ...o,
});

async function importSmb(rows: LegacyRow[]) {
  const spec: ImportSourceSpec = {
    ns: 'smb',
    legacySource: 'smbbackend',
    table: 'smbFileUpload',
    nas: new ReadonlySource('smb', path.join(nas, 'CP')),
    scanDirs: [''],
  };
  return runImport({ spec, rows, repo: t.compat!.repo, store: t.store, apply: true });
}

before(async () => {
  jwks = await startJwks();
});
after(() => jwks.close());
beforeEach(async () => {
  t = await buildTestApp(jwks, { compat: true });
  auth = { 'x-internal-token': await jwks.sign(user('S112009')) };
  nas = mkdtempSync(path.join(tmpdir(), 'file-legacy-routes-'));
  mkdirSync(path.join(nas, 'CP'));
  writeFileSync(path.join(nas, 'CP', '電子發票設定.pdf'), PDF);
  writeFileSync(path.join(nas, 'CP', 'b.png'), PNG);
  await importSmb([
    row({ id: 31, path: '電子發票設定.pdf', filename: '電子發票設定.pdf', originalName: '電子發票設定.pdf', SourceNumber: 'SP-1' }),
    row({ id: 32, path: 'b.png', filename: 'b.png', originalName: 'b.png', SourceNumber: 'SP-10' }),
  ]);
});

describe('舊系統匯入檔案 API(/v1/legacy)', () => {
  it('匯入摘要:兩個來源都列出,沒有匯入的為 0', async () => {
    const res = await t.app.inject({ url: '/v1/legacy/summary', headers: auth });
    assert.equal(res.statusCode, 200);
    const items = res.json().items;
    assert.deepEqual(
      items.map((s: { source: string; files: number }) => [s.source, s.files]),
      [
        ['filebackend', 0],
        ['smbbackend', 2],
      ],
    );
    assert.equal(items[1].bytes, PDF.length + PNG.length);
    assert.equal(items[1].backup.pending, 2);
  });

  it('依單號關鍵字查詢', async () => {
    const res = await t.app.inject({ url: '/v1/legacy/files?source=smbbackend&q=SP-10', headers: auth });
    assert.equal(res.json().total, 1);
    const f = res.json().items[0];
    assert.equal(f.legacyKey, '32');
    assert.equal(f.storageKey, undefined, '不回實體路徑');
    assert.equal(f.deleted, false);
    assert.equal((await t.app.inject({ url: '/v1/legacy/files?q=電子', headers: auth })).json().total, 1);
  });

  it('下載匯入的舊檔:UTF-8 檔名、寫操作紀錄;不是舊檔的 UUID 回 404;沒有 Token 回 401', async () => {
    const f = (await t.app.inject({ url: '/v1/legacy/files?q=SP-1', headers: auth })).json().items.find((x: { legacyKey: string }) => x.legacyKey === '31');
    const dl = await t.app.inject({ url: `/v1/legacy/files/${f.fileUuid}/content`, headers: auth });
    assert.equal(dl.statusCode, 200);
    assert.match(String(dl.headers['content-disposition']), /filename\*=UTF-8''%E9%9B%BB%E5%AD%90/);
    assert.ok(
      (t.repo as unknown as { logs: { action: string; userId: string; detail?: string }[] }).logs.some(
        (l) => l.action === 'download' && l.userId === 'S112009' && /legacy smbbackend 31/.test(l.detail ?? ''),
      ),
    );
    assert.equal((await t.app.inject({ url: '/v1/legacy/files/00000000-0000-4000-8000-000000000000/content', headers: auth })).statusCode, 404);
    assert.equal((await t.app.inject({ url: '/v1/legacy/summary' })).statusCode, 401);
  });

  it('OpenAPI 宣告 file.legacy.read', async () => {
    const doc = (await t.app.inject('/openapi.json')).json();
    assert.ok(doc['x-permissions'].some((p: { code: string }) => p.code === 'file.legacy.read'));
    assert.equal(doc.paths['/v1/legacy/files'].get['x-permission'], 'file.legacy.read');
  });
});
