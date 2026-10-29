/**
 * filebackend / SMBbackend 舊檔匯入(F4;MIGRATION.md §2;LEGACY-SWITCH-PLAN.md §3 A1、§4.1)。不依賴 Fastify(AGENT.md §9.1)。
 *   - 來源:WebAppDb 舊表(唯讀)+ NAS 備份目錄(唯讀;filebackend = docker-folder/{平台}/,SMBbackend = docker-folder/CP/)
 *   - 乾跑(預設)只產生對照報表:可匯入、已匯入、斷鏈(有資料列無檔)、孤兒(有檔無資料列)、無效列、重複內容
 *   - --apply:複製到 LocalStore(邊讀邊算 SHA-256,寫入後重讀比對)→ 寫 file_object + legacy_file_map(同一交易);
 *     任一步失敗清掉已寫入的檔案,記為 error,不影響其他筆;已匯入的舊 id 跳過(可重跑)
 *   - 已匯入、但舊表後來改為無效(切換前舊服務刪除)的檔案:--apply 時在新服務軟刪除(切換前的差異同步)
 *   - 只匯入 Effective = 1;舊檔不套用副檔名白名單(歷史檔照收),只擋執行檔與腳本(BLOCKED_EXTS)
 */
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BLOCKED_EXTS, extOf, MIME, sanitizeOriginalName } from '../files/file-types.js';
import type { CompatNs, CompatRepo, LegacyMapEntry, NewCompatFile } from '../compat/types.js';
import { LocalStore } from '../storage/local-store.js';
import type { ReadonlySource } from './readonly-source.js';
import type { LegacyRow, LegacyTable } from './webappdb.js';

export interface ImportSourceSpec {
  ns: CompatNs;
  legacySource: LegacyMapEntry['legacySource'];
  table: LegacyTable;
  /** filebackend:NAS docker-folder 根目錄;SMBbackend:NAS docker-folder/CP */
  nas: ReadonlySource;
  /** 孤兒檔掃描範圍(相對 nas 根目錄);'' = 整個根目錄 */
  scanDirs: string[];
}

export const FB_SPEC_DIRS = ['BPM', 'CRM', 'ERP', 'MES', 'OTHER'];

export type ItemStatus = 'import' | 'imported' | 'missing' | 'blocked' | 'bad-path' | 'unreadable' | 'inactive' | 'delete' | 'deleted';

export interface ImportItem {
  legacyId: number;
  status: ItemStatus;
  /** NAS 上的相對路徑(/ 分隔) */
  rel: string | null;
  originalName: string;
  sourceNumber: string | null;
  sizeDb: number | null;
  sizeNas?: number;
  /** 與 id 較大的有效列共用同一個 NAS 檔(不同表單引用同一檔):照樣匯入,legacy_file_map 標 is_current = 0 */
  sharedPath?: true;
  sha256?: string;
  fileUuid?: string;
  result?: 'imported' | 'deleted' | 'error';
  error?: string;
}

export interface ImportReport {
  source: ImportSourceSpec['legacySource'];
  table: LegacyTable;
  apply: boolean;
  startedAt: string;
  rows: { total: number; effective: number };
  items: ImportItem[];
  /** NAS 上沒有任何資料列引用的檔案 */
  orphans: { rel: string; size: number }[];
  /** 內容相同(SHA-256)的可匯入 / 已匯入檔案,各自一筆不合併(MIGRATION §1 第 4 點) */
  duplicates: { sha256: string; legacyIds: number[] }[];
  /** 副檔名統計(只算可匯入的),白名單外的需求方確認 */
  exts: Record<string, number>;
  errors: string[];
}

export interface ImportOptions {
  spec: ImportSourceSpec;
  rows: LegacyRow[];
  repo: CompatRepo;
  store: LocalStore;
  apply: boolean;
  /** 乾跑也計算 SHA-256(找重複內容);預設 true */
  hash?: boolean;
  now?: () => Date;
}

/** NAS 上的相對路徑;含 .. 或絕對路徑回 null */
export function legacyRel(spec: Pick<ImportSourceSpec, 'ns'>, row: LegacyRow): string | null {
  let rel: string;
  if (spec.ns === 'smb') {
    rel = (row.path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  } else {
    // filebackend path 為容器內絕對路徑(/usr/src/app/files/BPM/{uuid}.png);取 files/ 之後,取不到時用 平台/檔名
    const p = (row.path ?? '').replace(/\\/g, '/');
    const i = p.lastIndexOf('/files/');
    rel = i >= 0 ? p.slice(i + '/files/'.length) : row.SourcePlatform ? `${row.SourcePlatform}/${row.filename ?? ''}` : (row.filename ?? '');
  }
  if (!rel || rel.split('/').some((s) => !s || s === '.' || s === '..')) return null;
  return rel;
}

/** uploadDate 字串(台灣時間)→ UTC Date */
export const taipeiDate = (s: string) => {
  const d = new Date(`${s.trim().replace(' ', 'T')}+08:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`uploadDate 格式不正確:${s}`);
  return d;
};

const cut = (s: string | null | undefined, n: number) => (s === null || s === undefined ? null : s.slice(0, n));

/** 舊資料列 → 相容層的 file_object(不含 storage 相關欄位) */
export function toCompatFile(spec: ImportSourceSpec, row: LegacyRow, rel: string, fileUuid: string, sha256: string, size: number): NewCompatFile {
  const filename = path.posix.basename(rel);
  const originalName = sanitizeOriginalName(row.originalName || filename) || filename;
  const ext = extOf(originalName) || extOf(filename) || null;
  const createdAt = taipeiDate(row.uploadDate);
  return {
    fileUuid,
    originalName,
    ext: ext ? ext.slice(0, 20) : null,
    mime: (ext && MIME[ext]) || 'application/octet-stream',
    sizeBytes: size,
    sha256,
    storageKey: LocalStore.keyFor(fileUuid, createdAt),
    sourceSystem: cut(row.SourcePlatform, 50) ?? (spec.ns === 'fb' ? 'default' : 'Web'),
    sourceApp: cut(row.SourceApplication, 200),
    refType: null,
    refNo: cut(row.SourceNumber, 100) || null,
    companyId: null,
    uploadedBy: cut(row.userNumber, 64) ?? '',
    uploadedIp: cut(row.ip, 50),
    createdAt,
    boundAt: createdAt,
    compatNs: spec.ns,
    compatKey: spec.ns === 'fb' ? String(row.id) : rel,
    meta: {
      id: row.id,
      filename: row.filename ?? filename,
      path: spec.ns === 'fb' ? rel : (row.path ?? rel),
      destination: row.destination,
      description: cut(row.Description, 500),
      version: cut(row.version, 50),
      userAgent: cut(row.userAgent, 300),
      ip: cut(row.ip, 50),
      mimetype: cut(row.mimetype, 100),
      storageType: cut(row.storageType, 50),
      nasPath: cut(row.nasPath, 300),
    },
  };
}

async function sha256Of(store: LocalStore, storageKey: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(store.openRead(storageKey), h);
  return h.digest('hex');
}

/** 舊檔不受 30 MB 限制(SMB 舊上限 100 MB);這裡只防異常大的檔案 */
const IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export async function runImport(opts: ImportOptions): Promise<ImportReport> {
  const { spec, rows, repo, store, apply } = opts;
  const now = opts.now ?? (() => new Date());
  const hash = opts.hash ?? true;
  await spec.nas.check();
  const imported = await repo.importedKeys(spec.legacySource);
  const report: ImportReport = {
    source: spec.legacySource,
    table: spec.table,
    apply,
    startedAt: now().toISOString(),
    rows: { total: rows.length, effective: rows.filter((r) => r.Effective).length },
    items: [],
    orphans: [],
    duplicates: [],
    exts: {},
    errors: [],
  };

  // 1. 逐列分類
  // 同一個 NAS 檔被多筆有效列引用(不同表單上傳同名檔):每筆都匯入(各表單都要查得到附件),
  // id 最大的一筆在 legacy_file_map 為現行,其餘 is_current = 0(唯一鍵只約束現行列;MIGRATION §1 第 4 點)
  const winner = new Map<string, number>();
  for (const row of rows) {
    const rel = row.Effective ? legacyRel(spec, row) : null;
    if (rel) winner.set(rel.toLowerCase(), Math.max(winner.get(rel.toLowerCase()) ?? 0, row.id));
  }
  const referenced = new Set<string>();
  for (const row of rows) {
    const rel = legacyRel(spec, row);
    if (rel) referenced.add(rel.toLowerCase());
    const prev = imported.get(String(row.id));
    const item: ImportItem = {
      legacyId: row.id,
      status: 'import',
      rel,
      originalName: row.originalName ?? row.filename ?? '',
      sourceNumber: row.SourceNumber,
      sizeDb: row.filesize,
      fileUuid: prev?.fileUuid,
    };
    if (!row.Effective) item.status = prev ? (prev.deleted ? 'deleted' : 'delete') : 'inactive';
    else if (prev) item.status = 'imported';
    else if (!rel) item.status = 'bad-path';
    else if (BLOCKED_EXTS.has(extOf(rel)) || BLOCKED_EXTS.has(extOf(item.originalName))) item.status = 'blocked';
    else {
      // 單一檔案讀不到(鎖定、權限、NAS 斷線)不中止整批,標 unreadable 並列入報表(AGENT.md §5)
      try {
        const st = await spec.nas.fileStat(rel);
        if (!st) item.status = 'missing';
        else {
          item.sizeNas = st.size;
          if (hash) item.sha256 = await spec.nas.sha256(rel);
        }
      } catch (err) {
        item.status = 'unreadable';
        item.error = (err as Error).message;
        report.errors.push(`${rel}:${item.error}`);
      }
    }
    if (item.status === 'import') {
      const e = extOf(item.originalName) || extOf(rel!) || '(無)';
      report.exts[e] = (report.exts[e] ?? 0) + 1;
    }
    if (item.status === 'import' && winner.get(rel!.toLowerCase()) !== row.id) item.sharedPath = true;
    report.items.push(item);
  }

  // 2. 孤兒檔:NAS 上沒有任何資料列(含無效列)引用
  for (const dir of spec.scanDirs) {
    // 不存在的平台目錄(例 NAS 上沒有 ERP)略過,不算掃描錯誤(LEGACY-INVENTORY §6.1)
    if (dir && !(await spec.nas.isDir(dir))) continue;
    for await (const e of spec.nas.walk(dir)) {
      if (e.kind === 'error') report.errors.push(`${e.rel}:${e.message}`);
      else {
        const rel = e.rel.split(path.sep).join('/');
        if (!referenced.has(rel.toLowerCase())) report.orphans.push({ rel, size: e.size });
      }
    }
  }

  // 3. 重複內容
  const bySha = new Map<string, number[]>();
  for (const i of report.items) if (i.sha256) bySha.set(i.sha256, [...(bySha.get(i.sha256) ?? []), i.legacyId]);
  report.duplicates = [...bySha.entries()].filter(([, ids]) => ids.length > 1).map(([sha256, legacyIds]) => ({ sha256, legacyIds }));

  if (!apply) return report;

  // 4. 寫入
  const rowById = new Map(rows.map((r) => [r.id, r]));
  for (const item of report.items) {
    if (item.status === 'delete') {
      try {
        const changed = await repo.softDelete(item.fileUuid!, 'system:legacy-import', now(), {
          fileUuid: item.fileUuid!,
          action: 'delete',
          userId: 'system:legacy-import',
          ip: null,
          requestId: null,
          detail: `${spec.legacySource} ${item.legacyId} 舊表已無效`,
        });
        item.result = changed ? 'deleted' : undefined;
      } catch (err) {
        item.result = 'error';
        item.error = (err as Error).message;
      }
      continue;
    }
    if (item.status !== 'import') continue;
    const row = rowById.get(item.legacyId)!;
    const fileUuid = randomUUID();
    let storageKey: string | null = null;
    try {
      const st = await spec.nas.fileStat(item.rel!);
      if (!st) throw new Error('NAS 檔案已不存在');
      const temp = await store.writeTemp(spec.nas.openRead(item.rel!), IMPORT_MAX_BYTES);
      if (temp.truncated) {
        await store.discard(temp.tmpPath);
        throw new Error('檔案超過匯入上限');
      }
      if (temp.size !== st.size) {
        await store.discard(temp.tmpPath);
        throw new Error(`讀取大小 ${temp.size} 與 NAS ${st.size} 不符`);
      }
      if (item.sha256 && item.sha256 !== temp.sha256) {
        await store.discard(temp.tmpPath);
        throw new Error('讀取期間 NAS 檔案內容改變(SHA-256 與乾跑不同)');
      }
      const file = toCompatFile(spec, row, item.rel!, fileUuid, temp.sha256, temp.size);
      try {
        await store.commit(temp.tmpPath, file.storageKey);
      } catch (err) {
        await store.discard(temp.tmpPath);
        throw err;
      }
      storageKey = file.storageKey;
      // 寫入後重讀比對,確認本機副本完整(AGENT.md §5:SHA 不符不可回報成功)
      if ((await sha256Of(store, file.storageKey)) !== temp.sha256) throw new Error('寫入後 SHA-256 不符');
      await repo.insertLegacy(file, {
        fileUuid,
        legacySource: spec.legacySource,
        legacyDir: path.posix.dirname(item.rel!) === '.' ? null : path.posix.dirname(item.rel!),
        legacyName: path.posix.basename(item.rel!),
        legacyDb: 'WebAppDb',
        legacyTable: spec.table,
        legacyKey: String(row.id),
        sizeBytes: temp.size,
        mtimeUtc: st.mtime,
        sha256: temp.sha256,
        nasPath: item.rel!,
        isCurrent: !item.sharedPath,
        at: now(),
      });
      item.fileUuid = fileUuid;
      item.sha256 = temp.sha256;
      item.result = 'imported';
    } catch (err) {
      item.result = 'error';
      item.error = (err as Error).message;
      // 已寫入的本機檔要移除,不留「有檔無紀錄」;移除失敗也要讓人看到(AGENT.md §5)
      if (storageKey)
        await store.remove(storageKey).catch((e: unknown) => {
          item.error += `;另外本機檔 ${storageKey} 清除失敗:${(e as Error).message}`;
        });
    }
  }
  return report;
}

/** 報表摘要(CLI 輸出、DevelopmentProcess 紀錄用) */
export function summarize(r: ImportReport): string {
  const n = (s: ItemStatus) => r.items.filter((i) => i.status === s).length;
  const res = (x: ImportItem['result']) => r.items.filter((i) => i.result === x).length;
  const lines = [
    `${r.source}(${r.table}):資料列 ${r.rows.total} 筆,有效 ${r.rows.effective}`,
    `  可匯入 ${n('import')}、已匯入 ${n('imported')}、斷鏈(NAS 無檔)${n('missing')}、讀取失敗 ${n('unreadable')}、擋下(執行檔)${n('blocked')}、路徑異常 ${n('bad-path')}`,
    `  其中與其他表單共用同一 NAS 檔 ${r.items.filter((i) => i.sharedPath).length}(各自匯入,對照表標非現行)`,
    `  無效列 ${n('inactive')}、已匯入但舊表已無效 ${n('delete')}(已處理 ${n('deleted')})`,
    `  孤兒檔(NAS 有、資料列無)${r.orphans.length}、重複內容 ${r.duplicates.length} 組、掃描錯誤 ${r.errors.length}`,
    `  副檔名:${
      Object.entries(r.exts)
        .sort((a, b) => b[1] - a[1])
        .map(([e, c]) => `${e} ${c}`)
        .join('、') || '—'
    }`,
  ];
  if (r.apply) lines.push(`  已寫入:匯入 ${res('imported')}、軟刪除 ${res('deleted')}、失敗 ${res('error')}`);
  else lines.push('  (乾跑,未寫入;確認報表後加 --apply)');
  return lines.join('\n');
}
