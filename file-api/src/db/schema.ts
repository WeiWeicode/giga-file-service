/**
 * 資料表(DATABASE.md §1–§3):Gateway 的 giganexus_gw[_test] 內獨立 schema file_svc(D7)。
 * schema 由 DBA 建立(db/dba/01-create-schema.sql),migration 不建立;本服務不讀寫 gw.*,也不與 gw.* 建 FK(§0.2)。
 */
import { sql } from 'drizzle-orm';
import { bigint, bit, char, customType, datetime2, index, int, mssqlSchema, nvarchar, uniqueIndex, varchar } from 'drizzle-orm/mssql-core';

export const fileSvc = mssqlSchema('file_svc').existing();

/** UNIQUEIDENTIFIER:應用端產生 v4(crypto.randomUUID),驅動回傳大寫,統一轉小寫對外 */
export const uniqueidentifier = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'uniqueidentifier';
  },
  fromDriver(value) {
    return value.toLowerCase();
  },
});

/** 時間一律以 UTC 儲存(DATABASE.md §0) */
export const utcNow = sql`sysutcdatetime()`;
const ts = (name: string) => datetime2(name, { precision: 3 });

/** 檔案主表(DATABASE.md §1) */
export const fileObject = fileSvc.table(
  'file_object',
  {
    id: bigint('id', { mode: 'number' }).identity().primaryKey(),
    fileUuid: uniqueidentifier('file_uuid').notNull(),
    originalName: nvarchar('original_name', { length: 255 }).notNull(),
    ext: nvarchar('ext', { length: 20 }),
    mime: nvarchar('mime', { length: 100 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: nvarchar('storage_key', { length: 200 }).notNull(),
    sourceSystem: nvarchar('source_system', { length: 50 }).notNull(),
    sourceApp: nvarchar('source_app', { length: 200 }),
    refType: nvarchar('ref_type', { length: 50 }),
    refNo: nvarchar('ref_no', { length: 100 }),
    companyId: nvarchar('company_id', { length: 50 }),
    uploadedBy: nvarchar('uploaded_by', { length: 64 }).notNull(),
    uploadedIp: nvarchar('uploaded_ip', { length: 50 }),
    createdAt: ts('created_at').notNull().default(utcNow),
    boundAt: ts('bound_at'),
    deletedAt: ts('deleted_at'),
    deletedBy: nvarchar('deleted_by', { length: 64 }),
    backupStatus: varchar('backup_status', { length: 10 }).notNull().default('pending'),
    backupAt: ts('backup_at'),
    backupAttempts: int('backup_attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_file_object_uuid').on(t.fileUuid),
    index('ix_file_object_ref').on(t.refType, t.refNo),
    index('ix_file_object_created_at').on(t.createdAt),
    index('ix_file_object_backup').on(t.backupStatus),
  ],
);

/** 操作紀錄(DATABASE.md §2):upload / download / delete / bind / bpm_download */
export const fileAccessLog = fileSvc.table(
  'file_access_log',
  {
    id: bigint('id', { mode: 'number' }).identity().primaryKey(),
    fileUuid: uniqueidentifier('file_uuid'),
    action: varchar('action', { length: 20 }).notNull(),
    userId: nvarchar('user_id', { length: 64 }).notNull(),
    ip: nvarchar('ip', { length: 50 }),
    requestId: nvarchar('request_id', { length: 100 }),
    detail: nvarchar('detail', { length: 500 }),
    createdAt: ts('created_at').notNull().default(utcNow),
  },
  (t) => [index('ix_file_access_log_uuid').on(t.fileUuid), index('ix_file_access_log_created_at').on(t.createdAt)],
);

/** 舊系統對照(DATABASE.md §3;F4 才寫入,F1 先建表) */
export const legacyFileMap = fileSvc.table(
  'legacy_file_map',
  {
    id: bigint('id', { mode: 'number' }).identity().primaryKey(),
    fileUuid: uniqueidentifier('file_uuid').notNull(),
    legacySource: varchar('legacy_source', { length: 30 }).notNull(),
    legacyDir: nvarchar('legacy_dir', { length: 300 }),
    legacyName: nvarchar('legacy_name', { length: 255 }).notNull(),
    legacyDb: nvarchar('legacy_db', { length: 100 }),
    legacyTable: nvarchar('legacy_table', { length: 100 }),
    legacyKey: nvarchar('legacy_key', { length: 200 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mtimeUtc: ts('mtime_utc').notNull(),
    sha256: char('sha256', { length: 64 }),
    isCurrent: bit('is_current').notNull().default(true),
    nasPath: nvarchar('nas_path', { length: 500 }),
    nasCopiedAt: ts('nas_copied_at'),
    wslCopiedAt: ts('wsl_copied_at'),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    sourceMissingAt: ts('source_missing_at'),
    syncState: varchar('sync_state', { length: 20 }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_legacy_file_map_uuid').on(t.fileUuid),
    uniqueIndex('uq_legacy_file_map_current')
      .on(t.legacySource, t.legacyDir, t.legacyName)
      .where(sql`[is_current] = 1`),
    index('ix_legacy_file_map_key').on(t.legacySource, t.legacyKey),
  ],
);
