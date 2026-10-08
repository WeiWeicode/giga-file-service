/** FileRepo 的 SQL Server 實作(Drizzle;DATABASE.md §1–§2)。只讀寫 schema file_svc */
import { and, count, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql, sum, type SQL } from 'drizzle-orm';
import type { FileDatabase } from '../../db/client.js';
import { fileAccessLog, fileObject } from '../../db/schema.js';
import type { AccessLog, FileRecord, FileRepo, ListFilter, NewFile, Scope, StorageStats } from './types.js';

type Row = typeof fileObject.$inferSelect;

const toRecord = (r: Row): FileRecord => ({
  fileUuid: r.fileUuid,
  originalName: r.originalName,
  ext: r.ext,
  mime: r.mime,
  sizeBytes: Number(r.sizeBytes),
  sha256: r.sha256,
  storageKey: r.storageKey,
  sourceSystem: r.sourceSystem,
  sourceApp: r.sourceApp,
  refType: r.refType,
  refNo: r.refNo,
  companyId: r.companyId,
  uploadedBy: r.uploadedBy,
  uploadedIp: r.uploadedIp,
  createdAt: r.createdAt,
  boundAt: r.boundAt,
  deletedAt: r.deletedAt,
  deletedBy: r.deletedBy,
  backupStatus: r.backupStatus as FileRecord['backupStatus'],
  backupAt: r.backupAt,
});

const logRow = (l: AccessLog) => ({
  fileUuid: l.fileUuid,
  action: l.action,
  userId: l.userId,
  ip: l.ip,
  requestId: l.requestId,
  detail: l.detail ?? null,
});

function scopeCondition(scope: Scope): SQL {
  const own = eq(fileObject.uploadedBy, scope.userId);
  if (scope.kind === 'system' || scope.companies.length === 0) return own;
  return or(own, inArray(fileObject.companyId, scope.companies))!;
}

export class DrizzleFileRepo implements FileRepo {
  constructor(private readonly db: FileDatabase) {}

  async insertMany(files: NewFile[], logs: AccessLog[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const f of files) await tx.insert(fileObject).values({ ...f, backupStatus: 'pending' });
      for (const l of logs) await tx.insert(fileAccessLog).values(logRow(l));
    });
  }

  async findActive(fileUuid: string): Promise<FileRecord | null> {
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(and(eq(fileObject.fileUuid, fileUuid), isNull(fileObject.deletedAt)));
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async list(filter: ListFilter, scope: Scope): Promise<{ items: FileRecord[]; total: number }> {
    const conds: SQL[] = [isNull(fileObject.deletedAt), scopeCondition(scope)];
    if (filter.sourceSystem) conds.push(eq(fileObject.sourceSystem, filter.sourceSystem));
    if (filter.refType) conds.push(eq(fileObject.refType, filter.refType));
    if (filter.refNo) conds.push(eq(fileObject.refNo, filter.refNo));
    if (filter.uploadedBy) conds.push(eq(fileObject.uploadedBy, filter.uploadedBy));
    if (filter.createdFrom) conds.push(gte(fileObject.createdAt, filter.createdFrom));
    if (filter.createdTo) conds.push(lte(fileObject.createdAt, filter.createdTo));
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(fileObject).where(where);
    // OFFSET … FETCH(2012 支援);排序必須唯一才能穩定分頁
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(where)
      .orderBy(desc(fileObject.createdAt), desc(fileObject.id))
      .offset((filter.page - 1) * filter.pageSize)
      .fetch(filter.pageSize);
    return { items: rows.map(toRecord), total: Number(totalRow?.n ?? 0) };
  }

  async bind(fileUuids: string[], refType: string | null, refNo: string, at: Date, log: Omit<AccessLog, 'fileUuid'>): Promise<number> {
    return this.db.transaction(async (tx) => {
      // OUTPUT inserted.* 取得實際更新的列(只為已綁定的檔案寫紀錄)
      const updated = await tx
        .update(fileObject)
        .set({ refType, refNo, boundAt: at })
        .output({ inserted: { fileUuid: fileObject.fileUuid } })
        .where(and(inArray(fileObject.fileUuid, fileUuids), isNull(fileObject.deletedAt)));
      for (const r of updated) await tx.insert(fileAccessLog).values(logRow({ ...log, fileUuid: r.inserted.fileUuid }));
      return updated.length;
    });
  }

  async softDelete(fileUuid: string, by: string, at: Date, log: AccessLog | null): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(fileObject)
        .set({ deletedAt: at, deletedBy: by })
        .output({ inserted: { fileUuid: fileObject.fileUuid } })
        .where(and(eq(fileObject.fileUuid, fileUuid), isNull(fileObject.deletedAt)));
      const changed = updated.length > 0;
      if (changed && log) await tx.insert(fileAccessLog).values(logRow(log));
      return changed;
    });
  }

  async log(entry: AccessLog): Promise<void> {
    await this.db.insert(fileAccessLog).values(logRow(entry));
  }

  async expiredTemps(before: Date, limit: number): Promise<FileRecord[]> {
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(and(isNull(fileObject.refNo), isNull(fileObject.deletedAt), lt(fileObject.createdAt, before)))
      .orderBy(fileObject.id)
      .offset(0)
      .fetch(limit);
    return rows.map(toRecord);
  }

  async pendingBackups(limit: number): Promise<FileRecord[]> {
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(and(eq(fileObject.backupStatus, 'pending'), isNull(fileObject.deletedAt)))
      .orderBy(fileObject.id)
      .offset(0)
      .fetch(limit);
    return rows.map(toRecord);
  }

  async markBackupDone(fileUuid: string, at: Date): Promise<void> {
    await this.db.update(fileObject).set({ backupStatus: 'done', backupAt: at }).where(eq(fileObject.fileUuid, fileUuid));
  }

  async markBackupAttempt(fileUuid: string, maxAttempts: number): Promise<{ status: FileRecord['backupStatus']; attempts: number }> {
    // 單一 UPDATE 累加並判斷門檻(多個 worker 同時執行也不會少算)
    const [r] = await this.db
      .update(fileObject)
      .set({
        backupAttempts: sql`${fileObject.backupAttempts} + 1`,
        backupStatus: sql`case when ${fileObject.backupAttempts} + 1 >= ${maxAttempts} then 'failed' else 'pending' end`,
      })
      .output({ inserted: { status: fileObject.backupStatus, attempts: fileObject.backupAttempts } })
      .where(eq(fileObject.fileUuid, fileUuid));
    if (!r) throw new Error(`找不到檔案:${fileUuid}`);
    return { status: r.inserted.status as FileRecord['backupStatus'], attempts: r.inserted.attempts };
  }

  async retryBackups(fileUuids: string[] | null): Promise<number> {
    const conds: SQL[] = [eq(fileObject.backupStatus, 'failed'), isNull(fileObject.deletedAt)];
    if (fileUuids) conds.push(inArray(fileObject.fileUuid, fileUuids));
    const updated = await this.db
      .update(fileObject)
      .set({ backupStatus: 'pending', backupAttempts: 0 })
      .output({ inserted: { fileUuid: fileObject.fileUuid } })
      .where(and(...conds));
    return updated.length;
  }

  async backedUp(afterId: number, limit: number): Promise<(FileRecord & { id: number })[]> {
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(and(eq(fileObject.backupStatus, 'done'), isNull(fileObject.deletedAt), gt(fileObject.id, afterId)))
      .orderBy(fileObject.id)
      .offset(0)
      .fetch(limit);
    return rows.map((r) => ({ ...toRecord(r), id: Number(r.id) }));
  }

  async stats(): Promise<StorageStats> {
    const active = isNull(fileObject.deletedAt);
    const [totals] = await this.db
      .select({
        files: count(),
        bytes: sum(fileObject.sizeBytes),
        temp: sql<number>`sum(case when ${fileObject.refNo} is null then 1 else 0 end)`,
      })
      .from(fileObject)
      .where(active);
    const byStatus = await this.db.select({ status: fileObject.backupStatus, n: count() }).from(fileObject).where(active).groupBy(fileObject.backupStatus);
    const failed = await this.db
      .select({ fileUuid: fileObject.fileUuid, originalName: fileObject.originalName, createdAt: fileObject.createdAt })
      .from(fileObject)
      .where(and(active, eq(fileObject.backupStatus, 'failed')))
      .orderBy(desc(fileObject.createdAt))
      .offset(0)
      .fetch(50);
    const backup = { pending: 0, done: 0, failed: 0 };
    for (const r of byStatus) if (r.status in backup) backup[r.status as keyof typeof backup] = Number(r.n);
    return {
      files: Number(totals?.files ?? 0),
      bytes: Number(totals?.bytes ?? 0),
      temp: Number(totals?.temp ?? 0),
      backup,
      failedItems: failed,
    };
  }
}
