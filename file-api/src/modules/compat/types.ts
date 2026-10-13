/**
 * 舊格式相容層的資料型別與儲存介面(API.md §4;LEGACY-SWITCH-PLAN.md §4)。核心不依賴 Fastify / Drizzle(AGENT.md §9.1)。
 *   - 相容層的檔案也存在 file_object:compat_ns = fb / smb,compat_key = 舊 id(fb)或舊 path(smb),新檔用 UUID
 *   - 舊表才有的欄位(description、version、mimetype…)放 legacy_meta(JSON 字串),原樣回傳給舊前端
 */
import type { AccessLog, FileRecord, NewFile } from '../files/types.js';

export type CompatNs = 'fb' | 'smb';

/** 舊 webFileUpload / smbFileUpload 才有的欄位(兩表欄位相同) */
export interface LegacyMeta {
  /** 舊整數 id(只有匯入的舊檔有;新檔的 id 就是 UUID) */
  id?: number;
  filename: string;
  path: string;
  destination: string | null;
  description: string | null;
  version: string | null;
  userAgent: string | null;
  ip: string | null;
  /** 舊服務正規化後的 MIME(例 application/docx),只用於回傳;下載的 Content-Type 用 file_object.mime */
  mimetype: string | null;
  storageType: string | null;
  nasPath: string | null;
}

export interface CompatRecord extends FileRecord {
  compatNs: CompatNs;
  compatKey: string;
  meta: LegacyMeta;
}

export interface NewCompatFile extends NewFile {
  compatNs: CompatNs;
  compatKey: string;
  meta: LegacyMeta;
}

/** 舊系統對照(DATABASE.md §3);匯入舊檔時與 file_object 同一交易寫入 */
export interface LegacyMapEntry {
  fileUuid: string;
  legacySource: 'filebackend' | 'smbbackend';
  legacyDir: string | null;
  legacyName: string;
  legacyDb: string;
  legacyTable: string;
  legacyKey: string;
  sizeBytes: number;
  mtimeUtc: Date;
  sha256: string;
  nasPath: string;
  at: Date;
}

export interface CompatListFilter {
  ns: CompatNs;
  /** fb:SourcePlatform 完全比對 */
  sourceSystem?: string;
  /** SourceNumber 完全比對 */
  refNo?: string;
  /** true = 只有有效檔、false = 只有已刪除、undefined = 全部 */
  effective?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  offset: number;
  limit: number;
}

export interface CompatRepo {
  /** 經相容層上傳的新檔(含操作紀錄,同一交易) */
  insert(files: NewCompatFile[], logs: AccessLog[]): Promise<void>;
  /** 匯入的舊檔:file_object + legacy_file_map + 操作紀錄,同一交易 */
  insertLegacy(file: NewCompatFile, map: LegacyMapEntry): Promise<void>;
  /** 依查找鍵找檔案(includeDeleted 時含已刪除);同鍵多筆時取最新一筆 */
  findByKey(ns: CompatNs, key: string, includeDeleted?: boolean): Promise<CompatRecord | null>;
  /** 依 UUID 找(含已刪除) */
  findByUuid(ns: CompatNs, fileUuid: string): Promise<CompatRecord | null>;
  /** smb 的舊整數 id(/db/files/:id):經 legacy_file_map.legacy_key 查 */
  findByLegacyId(ns: CompatNs, legacyId: string): Promise<CompatRecord | null>;
  list(filter: CompatListFilter): Promise<{ items: CompatRecord[]; total: number }>;
  /** 已匯入的舊 id(legacy_file_map.legacy_key),匯入工具判斷是否重跑 */
  importedKeys(source: LegacyMapEntry['legacySource']): Promise<Map<string, { fileUuid: string; deleted: boolean }>>;
  softDelete(fileUuid: string, by: string, at: Date, log: AccessLog | null): Promise<boolean>;
  log(entry: AccessLog): Promise<void>;
}
