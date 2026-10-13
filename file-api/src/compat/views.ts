/**
 * 相容層回應格式(API.md §4.1、§4.2):欄位名稱與大小寫照舊服務,以舊 controller 與舊前端實際解析的欄位為準(AGENT.md §7.4)。
 *   - id:匯入的舊檔回舊整數 id,新檔回 UUID 字串(規則 2;舊前端把 id 當不透明值帶回網址)
 *   - uploadDate:台灣時間的時分 + Z,與舊服務相同(legacy-format.ts legacyWallClockIso)
 */
import { legacyWallClockIso } from '../modules/compat/legacy-format.js';
import type { CompatRecord } from '../modules/compat/types.js';

const idOf = (f: CompatRecord): number | string => f.meta.id ?? f.fileUuid;
/** fb 上傳時沒帶 platform 存 default(舊表為 NULL,清單回 null、上傳回應回 "default") */
const fbPlatformOf = (f: CompatRecord) => (f.sourceSystem === 'default' ? null : f.sourceSystem);

/** filebackend /sql-files、/sql-files-by-source 的 files[] */
export const fbListItem = (f: CompatRecord) => ({
  id: idOf(f),
  filename: f.meta.filename,
  originalName: f.originalName,
  size: f.sizeBytes,
  mimetype: f.meta.mimetype,
  platform: fbPlatformOf(f),
  uploadDate: legacyWallClockIso(f.createdAt),
  description: f.meta.description,
  sourceApplication: f.sourceApp,
  sourceNumber: f.refNo,
  version: f.meta.version,
});

/** filebackend /sql-upload 的 file、/sql-upload-multiple 的 files[] */
export const fbUploaded = (f: CompatRecord, single: boolean) => ({
  id: idOf(f),
  filename: f.meta.filename,
  originalName: f.originalName,
  size: f.sizeBytes,
  mimetype: f.meta.mimetype,
  path: f.meta.path,
  ...(single ? { destination: f.meta.destination } : {}),
  platform: fbPlatformOf(f) ?? 'default',
  uploadDate: legacyWallClockIso(f.createdAt),
});

/** SMBbackend 資料列(/api/db/search、/api/db/files 的 data):smbFileUpload 全欄位 */
export const smbRow = (f: CompatRecord) => ({
  id: idOf(f),
  filename: f.meta.filename,
  originalName: f.originalName,
  filesize: f.sizeBytes,
  mimetype: f.meta.mimetype,
  path: f.meta.path,
  destination: f.meta.destination,
  Description: f.meta.description,
  SourcePlatform: f.sourceSystem,
  SourceApplication: f.sourceApp,
  SourceNumber: f.refNo ?? '',
  userAgent: f.meta.userAgent,
  userNumber: f.uploadedBy,
  Effective: f.deletedAt === null,
  storageType: f.meta.storageType,
  ip: f.meta.ip,
  version: f.meta.version,
  nasPath: f.meta.nasPath,
  uploadDate: legacyWallClockIso(f.createdAt),
});

/** SMBbackend /api/db/upload 成功的 data */
export const smbUploaded = (f: CompatRecord) => ({
  id: idOf(f),
  fileName: f.meta.filename,
  originalFileName: f.originalName,
  path: f.meta.path,
  size: f.sizeBytes,
  mimetype: f.meta.mimetype,
  uploadDate: legacyWallClockIso(f.createdAt),
  description: f.meta.description,
  userNumber: f.uploadedBy,
  ip: f.meta.ip,
  effective: true,
});
