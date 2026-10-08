/**
 * 檔案類型與檔名(SECURITY-CHECKLIST S9–S11;AGENT.md §7.3):副檔名白名單 + 檔頭(magic number)檢查、
 * 執行檔與腳本一律拒絕、只有圖片 / PDF 可 inline(SVG 不行)、Content-Disposition 的 UTF-8 檔名。
 *
 * 白名單為暫定(PRD §11 #6 待需求方確認),依 NAS / 166 盤點看到的舊附件類型整理;可用 FILE_ALLOWED_EXTS 覆寫,
 * 但 BLOCKED_EXTS 永遠拒絕,不受覆寫影響。
 */
import path from 'node:path';

export const DEFAULT_ALLOWED_EXTS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'xlsm',
  'ppt',
  'pptx',
  'msg',
  'txt',
  'csv',
  'zip',
  '7z',
  'rar',
];

/** 執行檔、腳本、可執行網頁:不論白名單一律拒絕 */
export const BLOCKED_EXTS = new Set([
  'exe', 'dll', 'com', 'scr', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh', 'hta',
  'jar', 'sh', 'bash', 'py', 'pl', 'php', 'asp', 'aspx', 'jsp', 'cgi', 'html', 'htm', 'xhtml', 'lnk', 'reg', 'cpl', 'sys', 'apk',
]); // prettier-ignore

type Signature = (head: Buffer) => boolean;
const startsWith = (bytes: number[]) => (h: Buffer) => bytes.every((b, i) => h[i] === b);
const ascii =
  (s: string, offset = 0) =>
  (h: Buffer) =>
    h.subarray(offset, offset + s.length).toString('latin1') === s;
const ZIP = startsWith([0x50, 0x4b, 0x03, 0x04]);
const OLE = startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** 純文字:前段沒有 NUL(UTF-16 BOM 例外) */
const TEXT: Signature = (h) => (h[0] === 0xff && h[1] === 0xfe) || (h[0] === 0xfe && h[1] === 0xff) || !h.includes(0);

const SIGNATURES: Record<string, Signature> = {
  pdf: ascii('%PDF-'),
  png: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: startsWith([0xff, 0xd8, 0xff]),
  jpeg: startsWith([0xff, 0xd8, 0xff]),
  gif: (h) => ascii('GIF87a')(h) || ascii('GIF89a')(h),
  bmp: ascii('BM'),
  webp: (h) => ascii('RIFF')(h) && ascii('WEBP', 8)(h),
  svg: (h) => TEXT(h) && /<svg[\s>]/i.test(h.toString('utf8')),
  doc: OLE,
  xls: OLE,
  ppt: OLE,
  msg: OLE,
  docx: ZIP,
  xlsx: ZIP,
  xlsm: ZIP,
  pptx: ZIP,
  zip: ZIP,
  '7z': startsWith([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  rar: ascii('Rar!'),
  txt: TEXT,
  csv: TEXT,
};

/** 不論副檔名,出現這些檔頭一律視為執行檔 */
const EXECUTABLE_HEADS: Signature[] = [ascii('MZ'), startsWith([0x7f, 0x45, 0x4c, 0x46]), ascii('#!')];

export const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  msg: 'application/vnd.ms-outlook',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
};

/** 可以 inline 預覽的類型(S10:SVG 不在內) */
const INLINE_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);

/** 原檔名只保留最後一段(去掉 / 與 \ 之前的路徑、控制字元),長度上限 255 */
export function sanitizeOriginalName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, 255);
}

export function extOf(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  return ext;
}

export type TypeCheck = { ok: true; ext: string; mime: string } | { ok: false; code: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_CONTENT_MISMATCH'; reason: string };

/** 檢查副檔名與檔頭;head 為檔案前段(至少 512 bytes,檔案較小時為全部) */
export function checkFileType(name: string, head: Buffer, allowed: readonly string[] = DEFAULT_ALLOWED_EXTS): TypeCheck {
  const ext = extOf(name);
  if (!ext) return { ok: false, code: 'FILE_TYPE_NOT_ALLOWED', reason: '檔名沒有副檔名' };
  if (BLOCKED_EXTS.has(ext)) return { ok: false, code: 'FILE_TYPE_NOT_ALLOWED', reason: `不允許上傳 .${ext}(執行檔或腳本)` };
  if (!allowed.includes(ext)) return { ok: false, code: 'FILE_TYPE_NOT_ALLOWED', reason: `不允許上傳 .${ext}` };
  if (EXECUTABLE_HEADS.some((s) => s(head))) return { ok: false, code: 'FILE_CONTENT_MISMATCH', reason: '檔案內容為執行檔或腳本' };
  const sig = SIGNATURES[ext];
  // 空檔案沒有檔頭可比對:只有純文字類型允許
  if (head.length === 0 && sig !== TEXT) return { ok: false, code: 'FILE_CONTENT_MISMATCH', reason: '檔案內容為空' };
  if (sig && !sig(head)) return { ok: false, code: 'FILE_CONTENT_MISMATCH', reason: `檔案內容與副檔名 .${ext} 不符` };
  return { ok: true, ext, mime: MIME[ext] ?? 'application/octet-stream' };
}

export const canInline = (ext: string | null) => !!ext && INLINE_EXTS.has(ext);

/**
 * Content-Disposition:ASCII 後備名(非 ASCII 換成 _)+ filename*=UTF-8''(RFC 6266 / 5987)。
 * 舊 BPMbackend 只給 filename="%E4..." 造成部分瀏覽器顯示編碼字串(LEGACY-INVENTORY §5 問題 4)。
 */
export function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
