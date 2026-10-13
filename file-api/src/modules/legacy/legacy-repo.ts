/** LegacyRepo 的 SQL Server 實作(Drizzle;DATABASE.md §1、§3):legacy_file_map 與 file_object 合併查詢,只讀(log 除外) */
import { and, count, desc, eq, isNotNull, like, max, or, sql, sum, type SQL } from 'drizzle-orm';
import type { FileDatabase } from '../../db/client.js';
import { fileAccessLog, fileObject, legacyFileMap } from '../../db/schema.js';
import { logRow } from '../files/drizzle-repo.js';
import type { AccessLog } from '../files/types.js';
import type { LegacyFilter, LegacyItem, LegacyRepo, LegacySource, LegacySummary } from './legacy-service.js';

const columns = {
  fileUuid: legacyFileMap.fileUuid,
  legacySource: legacyFileMap.legacySource,
  legacyKey: legacyFileMap.legacyKey,
  legacyDir: legacyFileMap.legacyDir,
  legacyName: legacyFileMap.legacyName,
  isCurrent: legacyFileMap.isCurrent,
  syncState: legacyFileMap.syncState,
  importedAt: legacyFileMap.firstSeenAt,
  originalName: fileObject.originalName,
  mime: fileObject.mime,
  refNo: fileObject.refNo,
  sourceSystem: fileObject.sourceSystem,
  sourceApp: fileObject.sourceApp,
  sizeBytes: fileObject.sizeBytes,
  sha256: fileObject.sha256,
  uploadedBy: fileObject.uploadedBy,
  createdAt: fileObject.createdAt,
  deletedAt: fileObject.deletedAt,
  backupStatus: fileObject.backupStatus,
  storageKey: fileObject.storageKey,
};

type Row = { [K in keyof typeof columns]: unknown };
const toItem = (r: Row): LegacyItem => ({ ...r, sizeBytes: Number(r.sizeBytes), isCurrent: Boolean(r.isCurrent) }) as LegacyItem;

/** LIKE 的萬用字元以 [] 跳脫(SQL Server,不需 ESCAPE 子句) */
const likeEscape = (s: string) => s.replace(/[[%_]/g, (c) => `[${c}]`);

export class DrizzleLegacyRepo implements LegacyRepo {
  constructor(private readonly db: FileDatabase) {}

  private base() {
    return this.db.select(columns).from(legacyFileMap).innerJoin(fileObject, eq(fileObject.fileUuid, legacyFileMap.fileUuid));
  }

  async list(f: LegacyFilter): Promise<{ items: LegacyItem[]; total: number }> {
    const conds: SQL[] = [];
    if (f.source) conds.push(eq(legacyFileMap.legacySource, f.source));
    const q = f.q?.trim();
    if (q) {
      const p = `%${likeEscape(q)}%`;
      conds.push(or(like(legacyFileMap.legacyKey, p), like(legacyFileMap.legacyName, p), like(fileObject.originalName, p), like(fileObject.refNo, p))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [totalRow] = await this.db
      .select({ n: count() })
      .from(legacyFileMap)
      .innerJoin(fileObject, eq(fileObject.fileUuid, legacyFileMap.fileUuid))
      .where(where);
    const rows = await this.base()
      .where(where)
      .orderBy(desc(fileObject.createdAt), desc(legacyFileMap.id))
      .offset((f.page - 1) * f.pageSize)
      .fetch(f.pageSize);
    return { items: rows.map(toItem), total: Number(totalRow?.n ?? 0) };
  }

  async summary(): Promise<LegacySummary[]> {
    const rows = await this.db
      .select({
        source: legacyFileMap.legacySource,
        files: count(),
        bytes: sum(fileObject.sizeBytes),
        deleted: sql<number>`sum(case when ${fileObject.deletedAt} is null then 0 else 1 end)`,
        pending: sql<number>`sum(case when ${fileObject.backupStatus} = 'pending' then 1 else 0 end)`,
        done: sql<number>`sum(case when ${fileObject.backupStatus} = 'done' then 1 else 0 end)`,
        failed: sql<number>`sum(case when ${fileObject.backupStatus} = 'failed' then 1 else 0 end)`,
        lastImportedAt: max(legacyFileMap.firstSeenAt),
      })
      .from(legacyFileMap)
      .innerJoin(fileObject, eq(fileObject.fileUuid, legacyFileMap.fileUuid))
      .where(isNotNull(legacyFileMap.legacySource))
      .groupBy(legacyFileMap.legacySource);
    return rows.map((r) => ({
      source: r.source as LegacySource,
      files: Number(r.files),
      bytes: Number(r.bytes ?? 0),
      deleted: Number(r.deleted ?? 0),
      backup: { pending: Number(r.pending ?? 0), done: Number(r.done ?? 0), failed: Number(r.failed ?? 0) },
      lastImportedAt: r.lastImportedAt ?? null,
    }));
  }

  async find(fileUuid: string): Promise<LegacyItem | null> {
    const rows = await this.base().where(eq(legacyFileMap.fileUuid, fileUuid));
    return rows[0] ? toItem(rows[0]) : null;
  }

  async log(entry: AccessLog): Promise<void> {
    await this.db.insert(fileAccessLog).values(logRow(entry));
  }
}
