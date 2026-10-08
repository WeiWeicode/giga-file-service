/** 舊來源唯讀盤點(docs/Gherkin/legacy/inventory.feature):以暫存目錄模擬來源,不碰真正的 166 / NAS */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { scanSource, toMarkdown } from '../src/modules/legacy/inventory.js';
import { nodeReadonlyFs, type ReadonlyFs } from '../src/modules/legacy/readonly-source.js';

const U1 = '015b13ca-1a1e-430b-b0aa-cf1e69526524';
const U2 = '0b7ee185-acd3-42ca-aed5-a8a43cbae31e';

/** 模擬 NAS docker-folder:BPM / OTHER 為 UUID 檔名、CRM 為空目錄、CP 為中文原檔名 */
function fakeNas(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'legacy-'));
  const w = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  w(`BPM/${U1}.png`, 'png-1');
  w(`BPM/${U2}.pdf`, 'pdf-2');
  w(`OTHER/${U1}.png`, 'png-1');
  mkdirSync(path.join(root, 'CRM'));
  w('CP/電子發票設定.docx', 'docx');
  w('CP/AP-6804A 管制計劃 (CP-AP0001)-20241018.pdf', 'pdf');
  w('CP/AP-6804A 管制計劃 (CP-AP0001)-20241018_1.pdf', 'pdf-v2');
  w('CP/sub/電子發票設定.docx', 'docx-other');
  return root;
}

/** 來源的 (路徑, 大小, 修改時間) 快照 */
function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      out.push(`${path.relative(root, p)}|${s.size}|${s.mtimeMs}`);
    }
  };
  walk(root);
  return out.sort();
}

describe('舊來源唯讀盤點(inventory.feature)', () => {
  it('盤點 NAS 上 filebackend 各平台目錄', async () => {
    const root = fakeNas();
    const r = await scanSource({ name: 'filebackend', root, include: ['BPM', 'CRM', 'ERP', 'OTHER'] });
    assert.equal(r.status, 'ok');
    const byDir = Object.fromEntries(r.dirs.map((d) => [d.dir, d]));
    assert.equal(byDir.BPM!.files, 2);
    assert.equal(byDir.BPM!.uuidNamed, 2);
    assert.deepEqual(byDir.BPM!.exts, { png: 1, pdf: 1 });
    assert.equal(byDir.CRM!.files, 0, '空目錄:有讀到,檔案數 0');
    assert.ok(!r.errors.some((e) => e.path === 'CRM'));
    assert.equal(byDir.ERP!.files, 0);
    assert.ok(
      r.errors.some((e) => e.path === 'ERP'),
      '不存在的目錄列入錯誤,與空目錄區分',
    );
    assert.deepEqual(r.totals, { files: 3, bytes: 15, uuidNamed: 3, otherNamed: 0 });
    assert.ok(
      r.sameNameInDirs.some((g) => g.paths.length === 2 && g.name === `${U1}.png`),
      '同一 UUID 檔名出現在 BPM 與 OTHER',
    );
  });

  it('盤點 SMB 備份(CP)辨識中文原檔名', async () => {
    const root = fakeNas();
    const r = await scanSource({ name: 'smbbackend', root: path.join(root, 'CP') }, { hash: true });
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.totals, { files: 4, bytes: 4 + 3 + 6 + 10, uuidNamed: 0, otherNamed: 4 });
    assert.deepEqual(
      r.dirs.map((d) => [d.dir, d.files]),
      [
        ['(根目錄)', 3],
        ['sub', 1],
      ],
    );
    assert.equal(r.sameNameInDirs.length, 1, '電子發票設定.docx 在根目錄與 sub 各一份');
    assert.equal(r.duplicateContent.length, 0);
    const md = toMarkdown([r]);
    assert.match(md, /UUID 檔名 0、其他 4/);
  });

  it('內容相同的檔案(含 SHA-256)', async () => {
    const root = fakeNas();
    const r = await scanSource({ name: 'filebackend', root, include: ['BPM', 'OTHER'] }, { hash: true });
    assert.equal(r.duplicateContent.length, 1);
    assert.equal(r.duplicateContent[0]!.paths.length, 2);
  });

  it('盤點 166 PortalSolar 只掃資料目錄', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'portal-'));
    mkdirSync(path.join(root, 'EHS', 'License'), { recursive: true });
    mkdirSync(path.join(root, 'Bin'));
    writeFileSync(path.join(root, 'EHS', 'License', '證照.pdf'), 'x');
    writeFileSync(path.join(root, 'EHS', 'EHLicense.aspx'), 'x');
    writeFileSync(path.join(root, 'Bin', 'App.dll'), 'x');
    writeFileSync(path.join(root, 'Default.aspx.cs'), 'x');
    const r = await scanSource({ name: 'portalsolar', root, include: ['EHS'], excludeExts: ['aspx', 'cs', 'dll'] });
    assert.deepEqual(r.totals.files, 1);
    assert.deepEqual(
      r.dirs.map((d) => d.dir),
      ['EHS'],
    );
  });

  it('來源連不到時明確標示未查詢', async () => {
    const r = await scanSource({ name: 'portalsolar', root: path.join(tmpdir(), 'not-exists-legacy-root') });
    assert.equal(r.status, 'unavailable');
    assert.match(r.error!, /無法存取/);
    assert.match(toMarkdown([r]), /\*\*未查詢\*\*/);
  });

  it('個別檔案讀不到屬性時列入錯誤清單', async () => {
    const root = fakeNas();
    const broken: ReadonlyFs = {
      ...nodeReadonlyFs,
      stat: async (p) => {
        if (p.endsWith('.pdf') && p.includes('BPM')) throw new Error('EACCES');
        return nodeReadonlyFs.stat(p);
      },
    };
    const r = await scanSource({ name: 'filebackend', root, include: ['BPM'] }, { fs: broken });
    assert.equal(r.totals.files, 1);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0]!.message, /EACCES/);
  });

  it('盤點絕不修改來源', async () => {
    const root = fakeNas();
    const before = snapshot(root);
    const calls = new Set<string>();
    // 只提供讀取類操作;記錄實際呼叫的方法
    const spy: ReadonlyFs = {
      readdir: (d) => (calls.add('readdir'), nodeReadonlyFs.readdir(d)),
      stat: (p) => (calls.add('stat'), nodeReadonlyFs.stat(p)),
      openRead: (p) => (calls.add('openRead'), nodeReadonlyFs.openRead(p)),
    };
    await scanSource({ name: 'filebackend', root }, { hash: true, fs: spy });
    assert.deepEqual([...calls].sort(), ['openRead', 'readdir', 'stat']);
    assert.deepEqual(snapshot(root), before, '檔案數、大小與修改時間不變');
  });
});
