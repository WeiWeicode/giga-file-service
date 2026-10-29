/**
 * 「舊系統」Tab 的唯讀查詢(F4 / A4;API.md §2 /api/file/legacy;PRD §8):匯入的舊檔(legacy_file_map + file_object)。
 * 不依賴 Fastify(AGENT.md §9.1)。只讀;下載寫操作紀錄。新 API 的檔案清單看不到這些檔(compat_ns,API.md §4.4 規則 17),
 * 管理者在這裡查詢與下載,權限 file.legacy.read。
 */
import type { Readable } from 'node:stream';
import { AppError, notFound } from '../../errors.js';
import { contentDisposition, extOf, MIME } from '../files/file-types.js';
import type { AccessLog } from '../files/types.js';
import type { LocalStore } from '../storage/local-store.js';

export type LegacySource = 'filebackend' | 'smbbackend';

export interface LegacyItem {
  fileUuid: string;
  legacySource: LegacySource;
  legacyKey: string | null;
  legacyDir: string | null;
  legacyName: string;
  isCurrent: boolean;
  syncState: string;
  importedAt: Date;
  originalName: string;
  mime: string | null;
  refNo: string | null;
  sourceSystem: string;
  sourceApp: string | null;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  createdAt: Date;
  deletedAt: Date | null;
  backupStatus: 'pending' | 'done' | 'failed';
  storageKey: string;
}

export interface LegacySummary {
  source: LegacySource;
  files: number;
  bytes: number;
  /** 匯入後在新服務被刪除(相容層刪除或舊表改無效後同步) */
  deleted: number;
  backup: { pending: number; done: number; failed: number };
  lastImportedAt: Date | null;
}

export interface LegacyFilter {
  source?: LegacySource;
  /** 舊 id、舊檔名 / path、原檔名、單號(部分比對) */
  q?: string;
  page: number;
  pageSize: number;
}

export interface LegacyRepo {
  list(filter: LegacyFilter): Promise<{ items: LegacyItem[]; total: number }>;
  summary(): Promise<LegacySummary[]>;
  find(fileUuid: string): Promise<LegacyItem | null>;
  log(entry: AccessLog): Promise<void>;
}

export const LEGACY_SOURCES: LegacySource[] = ['filebackend', 'smbbackend'];

export class LegacyService {
  constructor(
    private readonly repo: LegacyRepo,
    private readonly store: LocalStore,
  ) {}

  list(filter: LegacyFilter) {
    return this.repo.list(filter);
  }

  /** 沒有匯入資料的來源也列出(數量 0),畫面固定顯示兩個來源 */
  async summary(): Promise<LegacySummary[]> {
    const rows = await this.repo.summary();
    return LEGACY_SOURCES.map(
      (source) =>
        rows.find((r) => r.source === source) ?? { source, files: 0, bytes: 0, deleted: 0, backup: { pending: 0, done: 0, failed: 0 }, lastImportedAt: null },
    );
  }

  /** 下載(含已在新服務刪除的檔,實體檔保留;管理者查核用) */
  async open(
    fileUuid: string,
    who: Pick<AccessLog, 'userId' | 'ip' | 'requestId'>,
  ): Promise<{ item: LegacyItem; stream: Readable; disposition: string; mime: string }> {
    const item = await this.repo.find(fileUuid);
    if (!item) throw notFound();
    if (!(await this.store.exists(item.storageKey))) throw new AppError(500, 'FILE_STORAGE_MISSING', '檔案實體不存在,請通知管理員');
    await this.repo.log({ fileUuid, action: 'download', ...who, detail: `legacy ${item.legacySource} ${item.legacyKey ?? ''}`.trim() });
    const mime = item.mime ?? MIME[extOf(item.originalName)] ?? 'application/octet-stream';
    return { item, stream: this.store.openRead(item.storageKey), disposition: contentDisposition(item.originalName, false), mime };
  }
}
