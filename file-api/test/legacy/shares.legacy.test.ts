/**
 * 真實舊來源冒煙測試(唯讀;npm run test:legacy):在連得到 NAS / 166 的電腦上執行,確認找得到檔案,
 * 並比對掃描(含 SHA-256)前後的「路徑 / 大小 / 修改時間」完全相同。不寫入、改名或刪除任何來源檔案(AGENT.md §7.1)。
 * 根目錄:LEGACY_NAS_ROOT、LEGACY_PORTAL_ROOT(預設 UNC 路徑);連不到時該測試失敗並說明「未查詢」,不當作沒有檔案。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { scanSource, UUID_NAME } from '../../src/modules/legacy/inventory.js';
import { ReadonlySource } from '../../src/modules/legacy/readonly-source.js';

const NAS = process.env.LEGACY_NAS_ROOT ?? '\\\\10.10.130.31\\docker-folder';
const PORTAL = process.env.LEGACY_PORTAL_ROOT ?? '\\\\10.10.130.166\\PortalSolar';

/** 以唯讀 API 取快照(與盤點同一套 ReadonlySource) */
async function snapshot(root: string, start = ''): Promise<string[]> {
  const out: string[] = [];
  for await (const e of new ReadonlySource('snapshot', root).walk(start)) if (e.kind === 'file') out.push(`${e.rel}|${e.size}|${e.mtime.getTime()}`);
  return out.sort();
}

describe('真實舊來源(唯讀)', () => {
  it('NAS CP(SMBbackend 備份):找得到檔案,含 SHA-256 掃描前後不變', async () => {
    const root = path.join(NAS, 'CP');
    const before = await snapshot(root);
    const r = await scanSource({ name: 'smbbackend', root }, { hash: true });
    assert.equal(r.status, 'ok', `未查詢:${r.error}`);
    assert.ok(r.totals.files > 0, 'CP 應有檔案');
    assert.ok(r.totals.otherNamed > 0, 'CP 應有中文原檔名的檔案(LEGACY-INVENTORY §4.3)');
    assert.deepEqual(await snapshot(root), before);
  });

  it('NAS filebackend 平台目錄:BPM 有 UUID 檔名的檔案,含 SHA-256 掃描前後不變', async () => {
    const before = await snapshot(NAS, 'BPM');
    const r = await scanSource({ name: 'filebackend', root: NAS, include: ['BPM', 'OTHER'] }, { hash: true });
    assert.equal(r.status, 'ok', `未查詢:${r.error}`);
    const bpm = r.dirs.find((d) => d.dir === 'BPM');
    assert.ok(bpm && bpm.uuidNamed > 0, 'BPM 應有 {uuid}{副檔名} 的檔案');
    assert.ok(before.length > 0 && before.some((l) => UUID_NAME.test(path.basename(l.split('|')[0]!))));
    assert.deepEqual(await snapshot(NAS, 'BPM'), before);
  });

  it('166 PortalSolar:找得到 EHS 的檔案(只列目錄與屬性)', async () => {
    const before = await snapshot(PORTAL, 'QA');
    const r = await scanSource({ name: 'portalsolar', root: PORTAL, include: ['EHS', 'QA'] });
    assert.equal(r.status, 'ok', `未查詢:${r.error}`);
    assert.ok((r.dirs.find((d) => d.dir === 'EHS')?.files ?? 0) > 0, 'EHS 應有檔案');
    assert.deepEqual(await snapshot(PORTAL, 'QA'), before);
  });
});
