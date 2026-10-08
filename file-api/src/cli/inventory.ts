/**
 * 舊來源唯讀盤點(F0;LEGACY-INVENTORY.md):npm run inventory -- [--source filebackend,smbbackend,portalsolar] [--dirs A,B] [--hash] [--out data/inventory]
 *   - 只讀:列目錄、取屬性、(--hash)以唯讀模式開檔計算 SHA-256;不寫入、改名或刪除來源(AGENT.md §7.1)
 *   - 報告(JSON + Markdown)寫到 --out(預設 data/inventory,已在 .gitignore);輸出目錄不可位於來源根目錄之下
 *   - 根目錄:LEGACY_NAS_ROOT(預設 \\10.10.130.31\docker-folder)、LEGACY_PORTAL_ROOT(預設 \\10.10.130.166\PortalSolar);
 *     容器內改指向唯讀掛載點(DEPLOYMENT.md §3)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scanSource, toMarkdown, type SourceSpec } from '../modules/legacy/inventory.js';

const NAS = process.env.LEGACY_NAS_ROOT ?? '\\\\10.10.130.31\\docker-folder';
const PORTAL = process.env.LEGACY_PORTAL_ROOT ?? '\\\\10.10.130.166\\PortalSolar';

/** 盤點範圍(LEGACY-INVENTORY §1–§3、MIGRATION §2–§3) */
export const PRESETS: Record<string, SourceSpec> = {
  // filebackend 備份在 NAS 根目錄,依平台分目錄(robocopy /is /e,不刪除)
  filebackend: { name: 'filebackend', root: NAS, include: ['BPM', 'CRM', 'ERP', 'MES', 'OTHER'] },
  smbbackend: { name: 'smbbackend', root: path.join(NAS, 'CP') },
  // 166 只掃資料目錄,不掃程式(Bin、App_Code、Scripts…)與原始碼
  portalsolar: {
    name: 'portalsolar',
    root: PORTAL,
    // Book、QA 只有 .aspx / .cs(2026-10-08 盤點確認),不列入
    include: ['Document', 'EHS', 'PersonalPic', 'PropertyFile', 'SignFile', 'UploadFiles', 'WordFiles', 'html'],
    excludeExts: ['aspx', 'cs', 'config', 'dll', 'pdb'],
  },
};

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'filebackend,smbbackend,portalsolar' },
    dirs: { type: 'string' },
    hash: { type: 'boolean', default: false },
    out: { type: 'string', default: 'data/inventory' },
  },
});

const names = values.source.split(',').map((s) => s.trim());
const specs = names.map((n) => {
  const spec = PRESETS[n];
  if (!spec) throw new Error(`未知的來源 ${n}(可用:${Object.keys(PRESETS).join(', ')})`);
  return values.dirs ? { ...spec, include: values.dirs.split(',').map((s) => s.trim()) } : spec;
});

// 輸出目錄不可在任何來源之下(Windows 不分大小寫比對)
const outDir = path.resolve(values.out);
const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
for (const s of specs) {
  const root = norm(path.resolve(s.root));
  if (norm(outDir) === root || norm(outDir).startsWith(root + path.sep)) throw new Error(`輸出目錄 ${outDir} 位於來源 ${s.name} 之下,拒絕執行`);
}

const reports = [];
for (const spec of specs) {
  console.error(`盤點 ${spec.name}:${spec.root}${spec.include ? `(${spec.include.join(', ')})` : ''}${values.hash ? ',含 SHA-256' : ''}`);
  const r = await scanSource(spec, { hash: values.hash, onProgress: (m) => console.error(`  ${m}`) });
  console.error(r.status === 'ok' ? `  完成:${r.totals.files} 個檔案,${r.errors.length} 筆讀取錯誤` : `  未查詢:${r.error}`);
  reports.push(r);
}

await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const base = path.join(outDir, `inventory-${stamp}-${names.join('+')}`);
await writeFile(`${base}.json`, JSON.stringify(reports, null, 2));
const md = toMarkdown(reports);
await writeFile(`${base}.md`, md);
console.log(md);
console.error(`報告:${base}.json、${base}.md`);
