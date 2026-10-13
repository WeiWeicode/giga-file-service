/**
 * 舊服務的欄位格式(API.md §4.4;LEGACY-SWITCH-PLAN.md §4.2),以舊程式為準:
 *   - filebackend:controllers/sqlFileController.js 的 validatePlatform、normalizeMimeType
 *   - SMBbackend:controllers/smbFileUploadController.js 的 normalizeMimeType
 * 只影響回給舊前端的 mimetype 字串;下載的 Content-Type 一律用 file_object.mime(標準 MIME)。
 */

const FB_PLATFORMS = ['MES', 'BPM', 'CRM', 'ERP', 'OTHER'];

/** filebackend validatePlatform:去掉英數與 _ 以外的字元、轉大寫,不在白名單回 null(規則 10) */
export function fbPlatform(raw: string | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
  return FB_PLATFORMS.includes(clean) ? clean : null;
}

const FB_MIME: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/svg+xml': 'image/svg',
  'image/x-icon': 'image/icon',
  'application/javascript': 'text/javascript',
  'application/xml': 'text/xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/pptx',
  'application/msword': 'application/doc',
  'application/vnd.ms-excel': 'application/xls',
  'application/vnd.ms-powerpoint': 'application/ppt',
  'application/x-rar-compressed': 'application/rar',
  'application/x-7z-compressed': 'application/7z',
  'application/x-tar': 'application/tar',
  'audio/mpeg': 'audio/mp3',
  'video/quicktime': 'video/mov',
  'video/x-msvideo': 'video/avi',
  'application/octet-stream': 'application/binary',
};
const FB_KEEP = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/tiff',
  'application/pdf',
  'text/plain',
  'application/json',
  'application/zip',
  'application/gzip',
]);

/** filebackend normalizeMimeType(對應表 → 依主類型 → Office 關鍵字 → {主類型}/unknown) */
export function fbMime(mime: string | null): string {
  if (!mime) return 'application/octet-stream';
  const m = mime.split(';')[0]!.trim().toLowerCase();
  if (FB_MIME[m]) return FB_MIME[m];
  if (FB_KEEP.has(m)) return m;
  const [main, sub] = m.split('/');
  if (main === 'image' || main === 'text' || main === 'audio' || main === 'video') return `${main}/${sub || (main === 'text' ? 'plain' : 'unknown')}`;
  if (m.includes('word') || m.includes('document')) return 'application/docx';
  if (m.includes('excel') || m.includes('spreadsheet')) return 'application/xlsx';
  if (m.includes('powerpoint') || m.includes('presentation')) return 'application/pptx';
  if (m.includes('pdf')) return 'application/pdf';
  return `${main}/unknown`;
}

const SMB_MIME: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/xlsx',
  'application/msword': 'application/doc',
  'application/vnd.ms-excel': 'application/xls',
  'application/x-rar-compressed': 'application/rar',
};

/** SMBbackend normalizeMimeType:只轉對應表內的,其餘原樣 */
export function smbMime(mime: string | null): string {
  if (!mime) return 'application/octet-stream';
  const m = mime.split(';')[0]!.trim().toLowerCase();
  return SMB_MIME[m] ?? m;
}

/**
 * 上傳時間(API.md §4.4 規則 15):舊表 uploadDate 是 GETDATE()(台灣時間),舊服務(Sequelize)把它當 UTC 輸出,
 * 所以舊前端收到的是「台灣時間的時分 + Z」(例 2026-10-01T16:30:00.000Z 代表台灣 16:30)。
 * 相容層照舊輸出:SPfileUpload.vue 的 formatDate 會去掉 Z 再補 +00:00 後取 UTC 欄位,改成 +08:00 會變成 Invalid Date。
 */
export function legacyWallClockIso(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString();
}

/**
 * SMB 上傳的目錄參數(path):只接受相對路徑的一般目錄名,`\` 轉 `/`、去頭尾 `/`;含 `..`、`.`、空段或控制字元回 null。
 * 舊服務以 path.join 直接組路徑(LEGACY-INVENTORY §2 的穿越問題),新服務不重現(AGENT.md §7.3)。
 */
export function smbDir(raw: string | undefined): string | null {
  const s = (raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!s) return '';
  const segs = s.split('/');
  // eslint-disable-next-line no-control-regex
  if (s.length > 200 || segs.some((g) => !g.trim() || g === '.' || g === '..' || /[\u0000-\u001f\u007f:*?"<>|]/.test(g))) return null;
  return segs.join('/');
}
