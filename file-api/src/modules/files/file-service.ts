/**
 * 檔案核心邏輯(API.md §2;不依賴 Fastify,I/O 由 repo / store 注入,AGENT.md §9.1)。
 *   上傳:暫存檔全部通過檢查後才 commit 到正式路徑,再寫資料庫;任何一個不合格整批拒絕並清掉暫存(file-safety.feature)
 *   下載:只用 UUID;資料範圍不符回 403;不刪實體檔(軟刪除)
 */
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AppError, accessDenied, notFound } from '../../errors.js';
import { LocalStore, type Capacity, type TempFile } from '../storage/local-store.js';
import { canInline, checkFileType, contentDisposition, DEFAULT_ALLOWED_EXTS, sanitizeOriginalName } from './file-types.js';
import { inScope, type FileRecord, type FileRepo, type ListFilter, type NewFile, type Scope, type StorageStats } from './types.js';

export interface Actor {
  scope: Scope;
  ip: string | null;
  requestId: string | null;
  /** 上傳時寫入 company_id(使用者的第一個所屬公司;系統身分為 null) */
  companyId: string | null;
}

export interface UploadPart {
  originalName: string;
  temp: TempFile;
}

export interface UploadFields {
  sourceSystem?: string;
  sourceApp?: string;
  refType?: string;
  refNo?: string;
}

export interface FileServiceOptions {
  repo: FileRepo;
  store: LocalStore;
  allowedExts?: readonly string[] | null;
  tempRetentionHours: number;
  now?: () => Date;
}

/** 系統代碼 / 單據類型:小寫英數與 - _(對應 Gateway 系統代碼) */
const CODE_RE = /^[a-z][a-z0-9_-]{0,49}$/;

export class FileService {
  private readonly repo: FileRepo;
  readonly store: LocalStore;
  private readonly allowed: readonly string[];
  private readonly retentionMs: number;
  private readonly now: () => Date;

  constructor(opts: FileServiceOptions) {
    this.repo = opts.repo;
    this.store = opts.store;
    this.allowed = opts.allowedExts ?? DEFAULT_ALLOWED_EXTS;
    this.retentionMs = opts.tempRetentionHours * 3600_000;
    this.now = opts.now ?? (() => new Date());
  }

  /** 檢查並保存一批暫存檔;失敗時清掉這批所有暫存與已搬移的檔案 */
  async upload(parts: UploadPart[], fields: UploadFields, actor: Actor): Promise<FileRecord[]> {
    const committed: string[] = [];
    try {
      if (parts.length === 0) throw new AppError(400, 'FILE_NO_FILE', '請選擇要上傳的檔案(multipart 欄位 file)');
      const sourceSystem = fields.sourceSystem?.trim() || (actor.scope.kind === 'system' ? systemCode(actor.scope.userId) : 'file');
      if (!CODE_RE.test(sourceSystem)) throw new AppError(400, 'VALIDATION_FAILED', 'sourceSystem 格式錯誤(小寫英數、- _,50 字內)');
      if (fields.refType && !CODE_RE.test(fields.refType)) throw new AppError(400, 'VALIDATION_FAILED', 'refType 格式錯誤(小寫英數、- _,50 字內)');
      const refNo = fields.refNo?.trim() || null;
      if (refNo && refNo.length > 100) throw new AppError(400, 'VALIDATION_FAILED', 'refNo 長度上限 100');
      const sourceApp = fields.sourceApp?.trim() || null;
      if (sourceApp && sourceApp.length > 200) throw new AppError(400, 'VALIDATION_FAILED', 'sourceApp 長度上限 200');

      const at = this.now();
      const files: NewFile[] = [];
      for (const p of parts) {
        if (p.temp.truncated) throw new AppError(413, 'FILE_TOO_LARGE', `檔案超過上限:${p.originalName}`);
        const name = sanitizeOriginalName(p.originalName);
        if (!name) throw new AppError(400, 'VALIDATION_FAILED', '檔名空白');
        const type = checkFileType(name, p.temp.head, this.allowed);
        if (!type.ok) throw new AppError(415, type.code, `${type.reason}:${name}`);
        const fileUuid = randomUUID();
        files.push({
          fileUuid,
          originalName: name,
          ext: type.ext,
          mime: type.mime,
          sizeBytes: p.temp.size,
          sha256: p.temp.sha256,
          storageKey: LocalStore.keyFor(fileUuid, at),
          sourceSystem,
          sourceApp,
          refType: fields.refType ?? null,
          refNo,
          companyId: actor.companyId,
          uploadedBy: actor.scope.userId,
          uploadedIp: actor.ip,
          createdAt: at,
          boundAt: refNo ? at : null,
        });
      }

      for (const [i, f] of files.entries()) {
        await this.store.commit(parts[i]!.temp.tmpPath, f.storageKey);
        committed.push(f.storageKey);
      }
      await this.repo.insertMany(
        files,
        files.map((f) => ({ fileUuid: f.fileUuid, action: 'upload' as const, userId: actor.scope.userId, ip: actor.ip, requestId: actor.requestId })),
      );
      return files.map((f) => ({ ...f, deletedAt: null, deletedBy: null, backupStatus: 'pending' as const, backupAt: null }));
    } catch (err) {
      // 資料庫寫入失敗時,已搬到正式路徑的檔案也要移除,不留「有檔無紀錄」(AGENT.md §7.3)
      await Promise.all([...parts.map((p) => this.store.discard(p.temp.tmpPath)), ...committed.map((k) => this.store.remove(k))]);
      throw err;
    }
  }

  async get(fileUuid: string, actor: Actor): Promise<FileRecord> {
    const f = await this.repo.findActive(fileUuid);
    if (!f) throw notFound();
    if (!inScope(f, actor.scope)) throw accessDenied();
    return f;
  }

  async list(filter: ListFilter, actor: Actor) {
    return this.repo.list(filter, actor.scope);
  }

  /** 下載:先確認實體檔存在再寫紀錄;storage_key 異常(逃出根目錄)由 LocalStore 擋下 */
  async open(fileUuid: string, inline: boolean, actor: Actor): Promise<{ file: FileRecord; stream: Readable; disposition: string }> {
    const file = await this.get(fileUuid, actor);
    if (!(await this.store.exists(file.storageKey))) throw new AppError(500, 'FILE_STORAGE_MISSING', '檔案實體不存在,請通知管理員');
    await this.repo.log({ fileUuid, action: 'download', userId: actor.scope.userId, ip: actor.ip, requestId: actor.requestId });
    const stream = this.store.openRead(file.storageKey);
    return { file, stream, disposition: contentDisposition(file.originalName, inline && canInline(file.ext)) };
  }

  /** 綁定:每個 UUID 都必須存在且在範圍內,否則整批不綁定 */
  async bind(fileUuids: string[], refType: string | null, refNo: string, actor: Actor): Promise<number> {
    if (refType && !CODE_RE.test(refType)) throw new AppError(400, 'VALIDATION_FAILED', 'refType 格式錯誤(小寫英數、- _,50 字內)');
    const unique = [...new Set(fileUuids.map((u) => u.toLowerCase()))];
    for (const u of unique) {
      const f = await this.repo.findActive(u);
      if (!f) throw notFound();
      // 綁定會改變檔案歸屬的單據:只限上傳者本人(同公司的人也不行)
      if (f.uploadedBy !== actor.scope.userId) throw accessDenied();
    }
    return this.repo.bind(unique, refType, refNo, this.now(), {
      action: 'bind',
      userId: actor.scope.userId,
      ip: actor.ip,
      requestId: actor.requestId,
      detail: refNo,
    });
  }

  async remove(fileUuid: string, actor: Actor): Promise<void> {
    await this.get(fileUuid, actor);
    const changed = await this.repo.softDelete(fileUuid, actor.scope.userId, this.now(), {
      fileUuid,
      action: 'delete',
      userId: actor.scope.userId,
      ip: actor.ip,
      requestId: actor.requestId,
    });
    if (!changed) throw notFound();
  }

  /** 清除超過保留時數仍未綁定的暫存檔:標記刪除後移除實體檔;回傳處理筆數 */
  async cleanupTemps(limit = 500): Promise<number> {
    const before = new Date(this.now().getTime() - this.retentionMs);
    const expired = await this.repo.expiredTemps(before, limit);
    let n = 0;
    for (const f of expired) {
      const changed = await this.repo.softDelete(f.fileUuid, 'system:temp-cleanup', this.now(), null);
      if (!changed) continue;
      await this.store.remove(f.storageKey);
      n++;
    }
    return n;
  }

  async stats(): Promise<StorageStats & { capacity: Capacity | null }> {
    const [s, capacity] = await Promise.all([this.repo.stats(), this.store.capacity()]);
    return { ...s, capacity };
  }
}

/** client:{code} / webhook:{source} → 系統代碼(轉小寫、非法字元換成 -) */
function systemCode(sub: string): string {
  const code = sub
    .replace(/^(client|webhook):/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  return /^[a-z]/.test(code) ? code.slice(0, 50) : `sys-${code}`.slice(0, 50);
}
