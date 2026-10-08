/** 檔案模組的資料型別與儲存介面(核心不依賴 Fastify / Drizzle;AGENT.md §9.1) */

export interface FileRecord {
  fileUuid: string;
  originalName: string;
  ext: string | null;
  mime: string | null;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  sourceSystem: string;
  sourceApp: string | null;
  refType: string | null;
  refNo: string | null;
  companyId: string | null;
  uploadedBy: string;
  uploadedIp: string | null;
  createdAt: Date;
  boundAt: Date | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  backupStatus: 'pending' | 'done' | 'failed';
  backupAt: Date | null;
}

export type NewFile = Omit<FileRecord, 'deletedAt' | 'deletedBy' | 'backupStatus' | 'backupAt'>;

export type AccessAction = 'upload' | 'download' | 'delete' | 'bind' | 'bpm_download';

export interface AccessLog {
  fileUuid: string | null;
  action: AccessAction;
  userId: string;
  ip: string | null;
  requestId: string | null;
  detail?: string | null;
}

/**
 * 資料範圍(第一版,PRD §11 #5 待定;SECURITY-CHECKLIST S4):
 *   - 使用者:自己上傳的,或 company_id 在 Token cos(所屬公司,含兼任)之內
 *   - 系統身分(amr api_key / webhook):只看自己上傳的
 */
export type Scope = { kind: 'user'; userId: string; companies: string[] } | { kind: 'system'; userId: string };

export interface ListFilter {
  sourceSystem?: string;
  refType?: string;
  refNo?: string;
  uploadedBy?: string;
  createdFrom?: Date;
  createdTo?: Date;
  page: number;
  pageSize: number;
}

export interface StorageStats {
  files: number;
  bytes: number;
  temp: number;
  backup: { pending: number; done: number; failed: number };
  failedItems: { fileUuid: string; originalName: string; createdAt: Date }[];
}

export interface FileRepo {
  /** 一次新增多筆(同一交易)並寫入操作紀錄 */
  insertMany(files: NewFile[], logs: AccessLog[]): Promise<void>;
  /** 未刪除的檔案(不套用資料範圍;範圍判斷在 service) */
  findActive(fileUuid: string): Promise<FileRecord | null>;
  list(filter: ListFilter, scope: Scope): Promise<{ items: FileRecord[]; total: number }>;
  /** 綁定單據;回傳實際更新筆數 */
  bind(fileUuids: string[], refType: string | null, refNo: string, at: Date, log: Omit<AccessLog, 'fileUuid'>): Promise<number>;
  /** 軟刪除;回傳是否有更新 */
  softDelete(fileUuid: string, by: string, at: Date, log: AccessLog | null): Promise<boolean>;
  log(entry: AccessLog): Promise<void>;
  /** 建立早於 before、仍未綁定且未刪除的暫存檔 */
  expiredTemps(before: Date, limit: number): Promise<FileRecord[]>;
  stats(): Promise<StorageStats>;
  /** 待備份(pending)且未刪除,依建立順序 */
  pendingBackups(limit: number): Promise<FileRecord[]>;
  markBackupDone(fileUuid: string, at: Date): Promise<void>;
  /** 備份失敗:累計次數,達 maxAttempts 改為 failed;回傳更新後的狀態與次數 */
  markBackupAttempt(fileUuid: string, maxAttempts: number): Promise<{ status: FileRecord['backupStatus']; attempts: number }>;
  /** failed → pending、次數歸零;fileUuids 為 null 時重試全部;回傳筆數 */
  retryBackups(fileUuids: string[] | null): Promise<number>;
  /** 已備份(done)且未刪除,從 afterId 之後依序取(還原 CLI 逐批掃描) */
  backedUp(afterId: number, limit: number): Promise<(FileRecord & { id: number })[]>;
}

export function inScope(f: Pick<FileRecord, 'uploadedBy' | 'companyId'>, scope: Scope): boolean {
  if (f.uploadedBy === scope.userId) return true;
  return scope.kind === 'user' && f.companyId !== null && scope.companies.includes(f.companyId);
}
