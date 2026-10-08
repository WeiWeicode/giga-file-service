/**
 * 舊來源盤點(F0;LEGACY-INVENTORY.md;docs/Gherkin/legacy/inventory.feature):只讀,產出統計報告。
 *   - 每個目錄:檔案數、大小、副檔名分布、UUID 檔名 / 其他檔名、最新 / 最舊修改時間
 *   - 同一檔名出現在多個目錄、(選用)內容相同的檔案
 *   - 來源連不到:status = unavailable(未查詢),不可回報 0
 */
import path from 'node:path';
import { ReadonlySource, SourceUnavailableError, type ReadonlyFs } from './readonly-source.js';

export interface SourceSpec {
  /** filebackend / smbbackend / portalsolar(對應 legacy_file_map.legacy_source) */
  name: string;
  root: string;
  /** 只盤點這些第一層目錄;未指定 = 整個根目錄 */
  include?: string[];
  /** 不列入的副檔名(小寫,不含點) */
  excludeExts?: string[];
}

export interface DirSummary {
  dir: string;
  files: number;
  bytes: number;
  uuidNamed: number;
  otherNamed: number;
  exts: Record<string, number>;
  newest: string | null;
  oldest: string | null;
}

export interface SourceReport {
  name: string;
  root: string;
  status: 'ok' | 'unavailable';
  error?: string;
  scannedAt: string;
  durationMs: number;
  hashed: boolean;
  totals: { files: number; bytes: number; uuidNamed: number; otherNamed: number };
  dirs: DirSummary[];
  /** 同一檔名出現在多個目錄(最多 100 組) */
  sameNameInDirs: { name: string; paths: string[] }[];
  /** 內容相同的檔案(hash 時才有,最多 100 組) */
  duplicateContent: { sha256: string; size: number; paths: string[] }[];
  errors: { path: string; message: string }[];
}

export const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[^.\\/]+)?$/i;
const ROOT_DIR = '(根目錄)';
const LIMIT = 100;

export interface ScanOptions {
  hash?: boolean;
  fs?: ReadonlyFs;
  onProgress?: (msg: string) => void;
}

export async function scanSource(spec: SourceSpec, opts: ScanOptions = {}): Promise<SourceReport> {
  const t0 = Date.now();
  const source = new ReadonlySource(spec.name, spec.root, opts.fs);
  const report: SourceReport = {
    name: spec.name,
    root: source.root,
    status: 'ok',
    scannedAt: new Date().toISOString(),
    durationMs: 0,
    hashed: !!opts.hash,
    totals: { files: 0, bytes: 0, uuidNamed: 0, otherNamed: 0 },
    dirs: [],
    sameNameInDirs: [],
    duplicateContent: [],
    errors: [],
  };
  try {
    await source.check();
  } catch (err) {
    if (!(err instanceof SourceUnavailableError)) throw err;
    report.status = 'unavailable';
    report.error = err.message;
    report.durationMs = Date.now() - t0;
    return report;
  }

  const exclude = new Set((spec.excludeExts ?? []).map((e) => e.toLowerCase()));
  const dirs = new Map<string, DirSummary>();
  const byName = new Map<string, string[]>();
  const byHash = new Map<string, { size: number; paths: string[] }>();
  const summary = (dir: string) => {
    let d = dirs.get(dir);
    if (!d) dirs.set(dir, (d = { dir, files: 0, bytes: 0, uuidNamed: 0, otherNamed: 0, exts: {}, newest: null, oldest: null }));
    return d;
  };

  const starts = spec.include?.length ? spec.include : [''];
  for (const start of starts) {
    // 指定的目錄不存在也要列出(檔案數 0 並記錄錯誤),與「有讀到但是空的」區分
    if (start) summary(start);
    let n = 0;
    for await (const e of source.walk(start)) {
      if (e.kind === 'error') {
        report.errors.push({ path: e.rel, message: e.message });
        continue;
      }
      const base = path.basename(e.rel);
      const ext = path.extname(base).slice(1).toLowerCase();
      if (exclude.has(ext)) continue;
      const top = e.rel.includes(path.sep) ? e.rel.split(path.sep)[0]! : start || ROOT_DIR;
      const d = summary(top);
      const uuid = UUID_NAME.test(base);
      d.files++;
      d.bytes += e.size;
      d[uuid ? 'uuidNamed' : 'otherNamed']++;
      d.exts[ext || '(無)'] = (d.exts[ext || '(無)'] ?? 0) + 1;
      const m = e.mtime.toISOString();
      if (!d.newest || m > d.newest) d.newest = m;
      if (!d.oldest || m < d.oldest) d.oldest = m;
      const key = base.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), e.rel]);
      if (opts.hash) {
        try {
          const h = await source.sha256(e.rel);
          const g = byHash.get(h) ?? { size: e.size, paths: [] };
          g.paths.push(e.rel);
          byHash.set(h, g);
        } catch (err) {
          report.errors.push({ path: e.rel, message: `SHA-256 失敗:${(err as Error).message}` });
        }
      }
      if (++n % 1000 === 0) opts.onProgress?.(`${spec.name} ${start || ROOT_DIR}:已掃描 ${n} 個檔案`);
    }
  }

  report.dirs = [...dirs.values()].sort((a, b) => a.dir.localeCompare(b.dir));
  for (const d of report.dirs) {
    report.totals.files += d.files;
    report.totals.bytes += d.bytes;
    report.totals.uuidNamed += d.uuidNamed;
    report.totals.otherNamed += d.otherNamed;
  }
  report.sameNameInDirs = [...byName.entries()]
    .filter(([, paths]) => paths.length > 1)
    .slice(0, LIMIT)
    .map(([, paths]) => ({ name: path.basename(paths[0]!), paths }));
  report.duplicateContent = [...byHash.entries()]
    .filter(([, g]) => g.paths.length > 1)
    .slice(0, LIMIT)
    .map(([sha256, g]) => ({ sha256, size: g.size, paths: g.paths }));
  report.durationMs = Date.now() - t0;
  return report;
}

const mb = (b: number) => (b / 1024 / 1024).toFixed(1);

export function toMarkdown(reports: SourceReport[]): string {
  const out: string[] = ['# 舊來源盤點報告', '', `> 產生時間:${new Date().toISOString()}(唯讀掃描,未修改任何來源)`, ''];
  for (const r of reports) {
    out.push(`## ${r.name}`, '', `- 根目錄:\`${r.root}\``);
    if (r.status === 'unavailable') {
      out.push(`- **未查詢**:${r.error}`, '');
      continue;
    }
    out.push(
      `- 合計:${r.totals.files} 個檔案、${mb(r.totals.bytes)} MB(UUID 檔名 ${r.totals.uuidNamed}、其他 ${r.totals.otherNamed});耗時 ${(r.durationMs / 1000).toFixed(1)} 秒${r.hashed ? ';含 SHA-256' : ''}`,
      '',
      '| 目錄 | 檔案數 | MB | UUID 檔名 | 其他檔名 | 主要副檔名 | 最舊 | 最新 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const d of r.dirs) {
      const exts = Object.entries(d.exts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([e, n]) => `${e} ${n}`)
        .join('、');
      out.push(
        `| ${d.dir} | ${d.files} | ${mb(d.bytes)} | ${d.uuidNamed} | ${d.otherNamed} | ${exts || '—'} | ${d.oldest?.slice(0, 10) ?? '—'} | ${d.newest?.slice(0, 10) ?? '—'} |`,
      );
    }
    out.push('');
    if (r.sameNameInDirs.length)
      out.push(
        `- 同一檔名出現在多個目錄:${r.sameNameInDirs.length} 組(前 5:${r.sameNameInDirs
          .slice(0, 5)
          .map((g) => g.paths.join(' / '))
          .join(';')})`,
      );
    if (r.hashed) out.push(`- 內容相同的檔案:${r.duplicateContent.length} 組`);
    out.push(
      `- 讀取錯誤:${r.errors.length} 筆${
        r.errors.length
          ? `(前 5:${r.errors
              .slice(0, 5)
              .map((e) => `${e.path} ${e.message}`)
              .join(';')})`
          : ''
      }`,
      '',
    );
  }
  return out.join('\n');
}
