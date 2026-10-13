/**
 * 舊格式相容層的核心邏輯(API.md §4;LEGACY-SWITCH-PLAN.md §4.2)。不依賴 Fastify(AGENT.md §9.1)。
 *   - 檔案一律存成新服務的 UUID 檔(LocalStore、file_object),compat_ns 區分 fb / smb,清單只回自己命名空間的檔案
 *   - 上傳沿用新服務的檢查(大小、副檔名白名單、檔頭);全部通過才 commit 並寫資料庫,失敗清掉暫存(與 FileService 相同)
 *   - 舊前端沒有 Gateway 登入:身分只有網址參數的工號(規則 4),記入 uploaded_by / 操作紀錄,不做資料範圍過濾
 *   - 錯誤以 CompatError 丟出,由路由轉成舊式 { success:false, message, error? }(規則 1)
 */
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { checkFileType, contentDisposition, DEFAULT_ALLOWED_EXTS, MIME, extOf, sanitizeOriginalName } from '../files/file-types.js';
import type { AccessLog } from '../files/types.js';
import { LocalStore, type TempFile } from '../storage/local-store.js';
import { fbMime, fbPlatform, smbDir, smbMime } from './legacy-format.js';
import type { CompatListFilter, CompatNs, CompatRecord, CompatRepo, NewCompatFile } from './types.js';

/** 舊式錯誤;body 照舊服務的欄位(message 或 error) */
export class CompatError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.message ?? body.error ?? 'compat error'));
  }
}

export interface CompatCaller {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface CompatPart {
  originalName: string;
  temp: TempFile;
}

/** 舊前端送來的表單欄位(兩個舊服務的欄位聯集,未知欄位忽略) */
export type CompatFields = Partial<
  Record<
    'platform' | 'sourceApplication' | 'sourceNumber' | 'userNumber' | 'description' | 'version' | 'userAgent' | 'path' | 'sourcePlatform' | 'storageType',
    string
  >
>;

export const COMPAT_FIELD_NAMES = new Set<string>([
  'platform',
  'sourceApplication',
  'sourceNumber',
  'userNumber',
  'description',
  'version',
  'userAgent',
  'path',
  'sourcePlatform',
  'storageType',
]);

/** 相容層 /sql-files 沒帶 limit 時的上限(規則 8) */
export const FB_LIST_MAX = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cut = (s: string | undefined | null, n: number) => {
  const v = s?.trim();
  return v ? v.slice(0, n) : null;
};

export interface CompatServiceOptions {
  repo: CompatRepo;
  store: LocalStore;
  allowedExts?: readonly string[] | null;
  now?: () => Date;
}

export class CompatService {
  private readonly repo: CompatRepo;
  readonly store: LocalStore;
  private readonly allowed: readonly string[];
  private readonly now: () => Date;

  constructor(opts: CompatServiceOptions) {
    this.repo = opts.repo;
    this.store = opts.store;
    this.allowed = opts.allowedExts ?? DEFAULT_ALLOWED_EXTS;
    this.now = opts.now ?? (() => new Date());
  }

  /** 上傳(fb:/sql-upload、/sql-upload-multiple;smb:/api/db/upload) */
  async upload(ns: CompatNs, parts: CompatPart[], fields: CompatFields, caller: CompatCaller): Promise<CompatRecord[]> {
    const committed: string[] = [];
    try {
      if (parts.length === 0) throw new CompatError(400, { success: false, message: ns === 'fb' ? '沒有檔案被上傳' : '請選擇要上傳的檔案' });
      const at = this.now();
      let platform: string | null = null;
      let dir = '';
      if (ns === 'fb') {
        platform = fbPlatform(fields.platform);
        if (fields.platform && !platform) throw new CompatError(400, { success: false, message: '無效的平台名稱' });
      } else {
        const d = smbDir(fields.path);
        if (d === null) throw new CompatError(400, { success: false, message: '路徑格式不正確', errorCode: 'INVALID_PATH' });
        dir = d;
      }
      const userNumber = ns === 'fb' ? (cut(fields.userNumber, 64) ?? 'Unknown') : (cut(fields.userNumber, 64) ?? '');
      const userAgent = cut(fields.userAgent, 300) ?? cut(caller.userAgent, 300) ?? (ns === 'fb' ? 'Unknown' : '');

      const files: NewCompatFile[] = [];
      for (const p of parts) {
        const name = sanitizeOriginalName(p.originalName);
        if (p.temp.truncated) throw new CompatError(413, { success: false, message: `檔案超過上限 30 MB:${name}` });
        if (!name) throw new CompatError(400, { success: false, message: '檔名空白' });
        const type = checkFileType(name, p.temp.head, this.allowed);
        if (!type.ok) throw new CompatError(415, { success: false, message: `${type.reason}:${name}`, error: type.code });
        const fileUuid = randomUUID();
        const stored = `${fileUuid}.${type.ext}`;
        const base = {
          fileUuid,
          originalName: name,
          ext: type.ext,
          mime: type.mime,
          sizeBytes: p.temp.size,
          sha256: p.temp.sha256,
          storageKey: LocalStore.keyFor(fileUuid, at),
          refType: null,
          companyId: null,
          uploadedBy: userNumber,
          uploadedIp: caller.ip,
          createdAt: at,
          // 舊前端上傳時就帶單號,不走兩段式;沒有單號也不是暫存檔,不可被 24 小時清除
          boundAt: at,
          compatNs: ns,
        };
        if (ns === 'fb') {
          files.push({
            ...base,
            sourceSystem: platform ?? 'default',
            sourceApp: cut(fields.sourceApplication, 200),
            refNo: cut(fields.sourceNumber, 100),
            compatKey: fileUuid,
            meta: {
              filename: stored,
              path: platform ? `${platform}/${stored}` : stored,
              destination: platform,
              description: cut(fields.description, 500),
              version: cut(fields.version, 50),
              userAgent,
              ip: caller.ip,
              mimetype: fbMime(type.mime),
              storageType: 'local',
              nasPath: null,
            },
          });
        } else {
          const path = dir ? `${dir}/${stored}` : stored;
          files.push({
            ...base,
            sourceSystem: cut(fields.sourcePlatform, 50) ?? 'Web',
            sourceApp: cut(fields.sourceApplication, 200) ?? 'SMB文件管理系統',
            refNo: cut(fields.sourceNumber, 100),
            compatKey: path,
            meta: {
              filename: stored,
              path,
              destination: dir || '根目錄',
              description: cut(fields.description, 500) ?? '',
              version: cut(fields.version, 50) ?? '1.0',
              userAgent,
              ip: caller.ip,
              mimetype: smbMime(type.mime),
              storageType: cut(fields.storageType, 50) ?? 'Local',
              nasPath: path,
            },
          });
        }
      }
      if (ns === 'smb' && files.length > 1) throw new CompatError(400, { success: false, message: '一次只能上傳一個檔案' });

      for (const [i, f] of files.entries()) {
        await this.store.commit(parts[i]!.temp.tmpPath, f.storageKey);
        committed.push(f.storageKey);
      }
      await this.repo.insert(
        files,
        files.map((f) => ({
          fileUuid: f.fileUuid,
          action: 'upload' as const,
          userId: f.uploadedBy || 'compat',
          ip: caller.ip,
          requestId: caller.requestId,
          detail: `compat:${ns}`,
        })),
      );
      return files.map((f) => ({ ...f, deletedAt: null, deletedBy: null, backupStatus: 'pending' as const, backupAt: null }));
    } catch (err) {
      // 與 FileService 相同:資料庫寫入失敗時移除已搬到正式路徑的檔案,不留「有檔無紀錄」(AGENT.md §7.3)
      await Promise.all([...parts.map((p) => this.store.discard(p.temp.tmpPath)), ...committed.map((k) => this.store.remove(k))]);
      throw err;
    }
  }

  async list(filter: CompatListFilter) {
    return this.repo.list(filter);
  }

  /** fb 的 :id:舊整數 id 或新檔 UUID(規則 2);其他格式視為不存在 */
  async findFb(id: string, includeDeleted = false): Promise<CompatRecord | null> {
    if (UUID_RE.test(id)) return this.repo.findByKey('fb', id.toLowerCase(), includeDeleted);
    if (/^\d{1,10}$/.test(id)) return this.repo.findByKey('fb', String(Number(id)), includeDeleted);
    return null;
  }

  /** smb 的 path:舊 path(UUID 檔名或中文原檔名)與新檔 path 都以 compat_key 查(規則 12) */
  async findSmbByPath(path: string): Promise<CompatRecord | null> {
    const key = path.replace(/\\/g, '/').replace(/^\/+/, '');
    return key ? this.repo.findByKey('smb', key) : null;
  }

  /** smb 的 /db/files/:id:舊整數 id 經 legacy_file_map 查,新檔用 UUID(含已刪除,與舊服務 findByPk 相同) */
  async findSmbById(id: string): Promise<CompatRecord | null> {
    if (UUID_RE.test(id)) return this.repo.findByUuid('smb', id.toLowerCase());
    if (/^\d{1,10}$/.test(id)) return this.repo.findByLegacyId('smb', String(Number(id)));
    return null;
  }

  /** 下載:實體檔不存在時回 null(由路由回舊式 404);每次下載寫操作紀錄 */
  async open(f: CompatRecord, caller: CompatCaller): Promise<{ stream: Readable; disposition: string; mime: string } | null> {
    if (!(await this.store.exists(f.storageKey))) return null;
    await this.repo.log({
      fileUuid: f.fileUuid,
      action: 'download',
      userId: 'compat',
      ip: caller.ip,
      requestId: caller.requestId,
      detail: `compat:${f.compatNs}`,
    });
    const mime = f.mime ?? MIME[extOf(f.originalName)] ?? 'application/octet-stream';
    return { stream: this.store.openRead(f.storageKey), disposition: contentDisposition(f.originalName, false), mime };
  }

  /** 軟刪除(舊服務會刪實體檔;新服務只設 deleted_at,AGENT.md §7.3) */
  async remove(f: CompatRecord, caller: CompatCaller): Promise<boolean> {
    const log: AccessLog = {
      fileUuid: f.fileUuid,
      action: 'delete',
      userId: 'compat',
      ip: caller.ip,
      requestId: caller.requestId,
      detail: `compat:${f.compatNs}`,
    };
    return this.repo.softDelete(f.fileUuid, 'compat', this.now(), log);
  }
}
