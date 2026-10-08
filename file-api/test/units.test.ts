/** 純函式與元件:檔案類型、Content-Disposition、LocalStore、設定(AGENT.md §6、§7.3) */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { checkFileType, contentDisposition, sanitizeOriginalName } from '../src/modules/files/file-types.js';
import { withSep } from '../src/modules/legacy/readonly-source.js';
import { LocalStore, PathEscapeError } from '../src/modules/storage/local-store.js';
import { EXE, PDF, PNG, SVG, ZIP } from './helpers.js';

describe('檔案類型(SECURITY-CHECKLIST S9)', () => {
  it('副檔名與檔頭相符才通過', () => {
    assert.deepEqual(checkFileType('a.PDF', PDF), { ok: true, ext: 'pdf', mime: 'application/pdf' });
    assert.equal(checkFileType('a.png', PNG).ok, true);
    assert.equal(checkFileType('a.docx', ZIP).ok, true);
    assert.equal(checkFileType('a.svg', SVG).ok, true);
    assert.equal(checkFileType('a.txt', Buffer.from('純文字')).ok, true);
    assert.equal(checkFileType('a.csv', Buffer.alloc(0)).ok, true, '空的文字檔可以');
  });
  it('拒絕與原因代碼', () => {
    const r = (name: string, head: Buffer) => {
      const c = checkFileType(name, head);
      return c.ok ? 'ok' : c.code;
    };
    assert.equal(r('a.exe', EXE), 'FILE_TYPE_NOT_ALLOWED');
    assert.equal(r('a.js', Buffer.from('x')), 'FILE_TYPE_NOT_ALLOWED');
    assert.equal(r('noext', PDF), 'FILE_TYPE_NOT_ALLOWED');
    assert.equal(r('a.mp4', Buffer.alloc(8)), 'FILE_TYPE_NOT_ALLOWED', '不在暫定白名單');
    assert.equal(r('a.pdf', EXE), 'FILE_CONTENT_MISMATCH');
    assert.equal(r('a.png', PDF), 'FILE_CONTENT_MISMATCH');
    assert.equal(r('a.txt', Buffer.from('#!/bin/sh\nrm -rf /')), 'FILE_CONTENT_MISMATCH', 'shebang 視為腳本');
    assert.equal(r('a.pdf', Buffer.alloc(0)), 'FILE_CONTENT_MISMATCH', '空的 PDF');
  });
  it('FILE_ALLOWED_EXTS 覆寫白名單,但執行檔仍拒絕', () => {
    assert.equal(checkFileType('a.pdf', PDF, ['png']).ok, false);
    assert.equal(checkFileType('a.exe', EXE, ['exe']).ok, false);
  });
  it('原檔名只留最後一段並去掉控制字元', () => {
    assert.equal(sanitizeOriginalName('C:\\Users\\x\\報價.pdf'), '報價.pdf');
    assert.equal(sanitizeOriginalName('../../a\u0000b.pdf'), 'ab.pdf');
  });
  it('Content-Disposition:ASCII 後備 + RFC 5987', () => {
    assert.equal(contentDisposition("a b'(1).pdf", false), `attachment; filename="a b'(1).pdf"; filename*=UTF-8''a%20b%27%281%29.pdf`);
    assert.equal(contentDisposition('報價.pdf', true), `inline; filename="__.pdf"; filename*=UTF-8''%E5%A0%B1%E5%83%B9.pdf`);
    assert.match(contentDisposition('a"b\\c.pdf', false), /filename="a_b_c\.pdf"/);
  });
});

describe('LocalStore(STORAGE.md §1)', () => {
  const root = () => mkdtempSync(path.join(tmpdir(), 'store-'));
  it('storage_key 不可逃出根目錄,也不可指向 tmp', () => {
    const s = new LocalStore(root());
    assert.throws(() => s.resolveKey('../x'), PathEscapeError);
    assert.throws(() => s.resolveKey('/etc/passwd'), PathEscapeError);
    assert.throws(() => s.resolveKey('tmp/abc.part'), PathEscapeError);
    assert.throws(() => s.resolveKey(''), PathEscapeError);
    assert.ok(s.resolveKey('2026/10/abc').endsWith(path.join('2026', '10', 'abc')));
  });
  it('寫入暫存:計算 SHA-256、保留檔頭;超過上限標記 truncated', async () => {
    const s = new LocalStore(root());
    await s.init();
    const ok = await s.writeTemp(Readable.from([PDF]), 1000);
    assert.equal(ok.size, PDF.length);
    assert.equal(ok.truncated, false);
    assert.deepEqual(ok.head, PDF);
    const big = await s.writeTemp(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000);
    assert.equal(big.truncated, true);
    assert.equal(big.size, 600);
    await s.discard(big.tmpPath);
    await s.commit(ok.tmpPath, LocalStore.keyFor('11111111-1111-4111-8111-111111111111', new Date('2026-03-05T00:00:00Z')));
    assert.ok(await s.exists('2026/03/11111111-1111-4111-8111-111111111111'));
    assert.deepEqual(readdirSync(path.join(s.root, 'tmp')), []);
  });
  it('UNC 分享根目錄與磁碟根目錄不重複加分隔符(Windows 盤點 \\server\share 時發現)', () => {
    assert.equal(withSep(`x${path.sep}`), `x${path.sep}`);
    assert.equal(withSep('x'), `x${path.sep}`);
  });
  it('容量:有主機磁碟目錄時以主機為準,取不到則退回檔案系統', async () => {
    const r = root();
    const fsOnly = await new LocalStore(r).capacity();
    assert.equal(fsOnly?.basis, 'filesystem');
    const host = await new LocalStore(r, tmpdir()).capacity();
    assert.equal(host?.basis, 'host');
    assert.ok(host!.freeBytes <= host!.filesystem.freeBytes);
    const missing = await new LocalStore(r, path.join(tmpdir(), 'no-such-host-disk')).capacity();
    assert.equal(missing?.basis, 'filesystem');
  });
  it('discard 只能刪 tmp 內的檔案', async () => {
    const s = new LocalStore(root());
    await assert.rejects(s.discard(path.join(s.root, '2026/10/x')), PathEscapeError);
  });
});

describe('設定(AGENT.md §6)', () => {
  const base = {
    SERVICE_CODE: 'file-api',
    GW_JWKS_URL: 'http://127.0.0.1/jwks',
    FILE_ROOT: '/data/files',
    FILE_DB_HOST: 'h',
    FILE_DB_NAME: 'n',
    FILE_DB_USER: 'u',
  };
  it('dev 預設 port 51272、host 127.0.0.1、30 MB', () => {
    const c = loadConfig({ ...base, GW_ENV: 'dev', FILE_DB_PASSWORD: 'p' });
    assert.equal(c.port, 51272);
    assert.equal(c.host, '127.0.0.1');
    assert.equal(c.maxFileBytes, 30 * 1024 * 1024);
    assert.equal(c.hostDiskPath, null);
    assert.equal(c.allowedExts, null);
  });
  it('test / prod 不可設 DEV_SKIP_TOKEN,密碼只接受 _FILE', () => {
    const testEnv = { ...base, GW_ENV: 'test', GW_BASE_URL: 'https://gw', GW_API_KEY: 'k', SERVICE_ADVERTISE_URL: 'http://file-api:51272' };
    assert.throws(() => loadConfig({ ...testEnv, DEV_SKIP_TOKEN: '1', FILE_DB_PASSWORD: 'p' }), ConfigError);
    assert.throws(() => loadConfig({ ...testEnv, FILE_DB_PASSWORD: 'p' }), /只接受 FILE_DB_PASSWORD_FILE/);
  });
  it('缺少 FILE_ROOT 啟動失敗', () => {
    assert.throws(() => loadConfig({ ...base, FILE_ROOT: '', GW_ENV: 'dev', FILE_DB_PASSWORD: 'p' }), /FILE_ROOT 未設定/);
  });
  it('NAS 備份:未設定 BACKUP_ROOT 不備份;有設定時預設每 5 分鐘、失敗 5 次告警', () => {
    const dev = { ...base, GW_ENV: 'dev', FILE_DB_PASSWORD: 'p' };
    assert.equal(loadConfig(dev).backup, null);
    assert.deepEqual(loadConfig({ ...dev, BACKUP_ROOT: '/data/backup', BACKUP_ALERT_USERS: 'S112009, S200001,' }).backup, {
      root: '/data/backup',
      intervalMinutes: 5,
      maxAttempts: 5,
      alertUsers: ['S112009', 'S200001'],
    });
    assert.throws(() => loadConfig({ ...dev, BACKUP_ROOT: '/b', BACKUP_MAX_ATTEMPTS: '0' }), /BACKUP_MAX_ATTEMPTS 必須為正整數/);
    assert.throws(() => loadConfig({ ...dev, BACKUP_ROOT: '/b', BACKUP_INTERVAL_MINUTES: '1.5' }), /BACKUP_INTERVAL_MINUTES/);
  });
});
