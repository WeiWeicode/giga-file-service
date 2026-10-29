/** CompatRepo 的 SQL Server 實作(Drizzle;DATABASE.md §1、§3)。只讀寫 schema file_svc */
import { and, count, desc, eq, gte, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';
import type { FileDatabase } from '../../db/client.js';
import { fileAccessLog, fileObject, legacyFileMap } from '../../db/schema.js';
import { logRow, toRecord } from '../files/drizzle-repo.js';
import type { AccessLog } from '../files/types.js';
import type { CompatListFilter, CompatNs, CompatRecord, CompatRepo, LegacyMapEntry, LegacyMeta, NewCompatFile } from './types.js';

type Row = typeof fileObject.$inferSelect;

const toCompat = (r: Row): CompatRecord => ({
  ...toRecord(r),
  compatNs: r.compatNs as CompatNs,
  compatKey: r.compatKey ?? '',
  meta: JSON.parse(r.legacyMeta ?? '{}') as LegacyMeta,
});

const fileRow = (f: NewCompatFile) => {
  const { meta, ...rest } = f;
  return { ...rest, legacyMeta: JSON.stringify(meta), backupStatus: 'pending' };
};

export class DrizzleCompatRepo implements CompatRepo {
  constructor(private readonly db: FileDatabase) {}

  async insert(files: NewCompatFile[], logs: AccessLog[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const f of files) await tx.insert(fileObject).values(fileRow(f));
      for (const l of logs) await tx.insert(fileAccessLog).values(logRow(l));
    });
  }

  async insertLegacy(file: NewCompatFile, m: LegacyMapEntry): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(fileObject).values(fileRow(file));
      await tx.insert(legacyFileMap).values({
        fileUuid: m.fileUuid,
        legacySource: m.legacySource,
        legacyDir: m.legacyDir,
        legacyName: m.legacyName,
        legacyDb: m.legacyDb,
        legacyTable: m.legacyTable,
        legacyKey: m.legacyKey,
        sizeBytes: m.sizeBytes,
        mtimeUtc: m.mtimeUtc,
        sha256: m.sha256,
        isCurrent: m.isCurrent ?? true,
        nasPath: m.nasPath,
        wslCopiedAt: m.at,
        firstSeenAt: m.at,
        lastSeenAt: m.at,
        syncState: 'done',
      });
      await tx.insert(fileAccessLog).values(
        logRow({
          fileUuid: m.fileUuid,
          action: 'upload',
          userId: 'system:legacy-import',
          ip: null,
          requestId: null,
          detail: `${m.legacySource} ${m.legacyKey}`,
        }),
      );
    });
  }

  async findByKey(ns: CompatNs, key: string, includeDeleted = false): Promise<CompatRecord | null> {
    const conds: SQL[] = [eq(fileObject.compatNs, ns), eq(fileObject.compatKey, key)];
    if (!includeDeleted) conds.push(isNull(fileObject.deletedAt));
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(and(...conds))
      .orderBy(desc(fileObject.id))
      .offset(0)
      .fetch(1);
    return rows[0] ? toCompat(rows[0]) : null;
  }

  async findByUuid(ns: CompatNs, fileUuid: string): Promise<CompatRecord | null> {
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(and(eq(fileObject.compatNs, ns), eq(fileObject.fileUuid, fileUuid)));
    return rows[0] ? toCompat(rows[0]) : null;
  }

  async findByLegacyId(ns: CompatNs, legacyId: string): Promise<CompatRecord | null> {
    const rows = await this.db
      .select({ f: fileObject })
      .from(legacyFileMap)
      .innerJoin(fileObject, eq(fileObject.fileUuid, legacyFileMap.fileUuid))
      .where(
        and(eq(legacyFileMap.legacySource, ns === 'fb' ? 'filebackend' : 'smbbackend'), eq(legacyFileMap.legacyKey, legacyId), eq(fileObject.compatNs, ns)),
      )
      .orderBy(desc(fileObject.id))
      .offset(0)
      .fetch(1);
    return rows[0] ? toCompat(rows[0].f) : null;
  }

  async list(filter: CompatListFilter): Promise<{ items: CompatRecord[]; total: number }> {
    const conds: SQL[] = [eq(fileObject.compatNs, filter.ns)];
    if (filter.effective === true) conds.push(isNull(fileObject.deletedAt));
    if (filter.effective === false) conds.push(isNotNull(fileObject.deletedAt));
    if (filter.sourceSystem !== undefined) conds.push(eq(fileObject.sourceSystem, filter.sourceSystem));
    if (filter.refNo !== undefined) conds.push(eq(fileObject.refNo, filter.refNo));
    if (filter.createdFrom) conds.push(gte(fileObject.createdAt, filter.createdFrom));
    if (filter.createdTo) conds.push(lte(fileObject.createdAt, filter.createdTo));
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(fileObject).where(where);
    const rows = await this.db
      .select()
      .from(fileObject)
      .where(where)
      .orderBy(desc(fileObject.createdAt), desc(fileObject.id))
      .offset(filter.offset)
      .fetch(filter.limit);
    return { items: rows.map(toCompat), total: Number(totalRow?.n ?? 0) };
  }

  async importedKeys(source: LegacyMapEntry['legacySource']): Promise<Map<string, { fileUuid: string; deleted: boolean }>> {
    const rows = await this.db
      .select({ key: legacyFileMap.legacyKey, fileUuid: legacyFileMap.fileUuid, deletedAt: fileObject.deletedAt })
      .from(legacyFileMap)
      .innerJoin(fileObject, eq(fileObject.fileUuid, legacyFileMap.fileUuid))
      .where(eq(legacyFileMap.legacySource, source));
    return new Map(rows.filter((r) => r.key !== null).map((r) => [r.key!, { fileUuid: r.fileUuid, deleted: r.deletedAt !== null }]));
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
}
