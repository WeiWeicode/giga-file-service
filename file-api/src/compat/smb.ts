/**
 * SMBbackend 相容(API.md §4.2):/api/file/compat/smb/api/*,保留舊的 /api/… 尾段,路徑與 JSON 照舊 smbFileUploadController.js、SPSmbController.downloadFile。
 * 舊前端 BPM bpmcomonent/SPfileUpload.vue 用 /api/db/upload、/api/db/search、/api/db/delete、/api/download。
 * 舊的 /api/files(目錄瀏覽)、/api/delete、/api/upload、/api/localdownload 不提供(§4.3)。
 */
import type { FastifyPluginAsync } from 'fastify';
import { CompatError, FB_LIST_MAX, type CompatService } from '../modules/compat/compat-service.js';
import type { CompatRecord } from '../modules/compat/types.js';
import { compatCaller, COMPAT_ROUTE, readCompatParts } from './common.js';
import { smbRow, smbUploaded } from './views.js';

type SearchQuery = Partial<
  Record<
    | 'filename'
    | 'originalName'
    | 'mimetype'
    | 'path'
    | 'destination'
    | 'description'
    | 'sourcePlatform'
    | 'sourceApplication'
    | 'sourceNumber'
    | 'userNumber'
    | 'storageType'
    | 'ip'
    | 'effective'
    | 'startDate'
    | 'endDate',
    string
  >
>;

/** 舊服務的 LIKE '%x%'(SQL Server 預設定序不分大小寫);meta 欄位在 JSON 內,資料量小,在應用層比對 */
const like = (v: string | null | undefined, q: string | undefined) => !q || (v ?? '').toLowerCase().includes(q.toLowerCase());

const date = (v: string | undefined) => {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new CompatError(400, { success: false, message: `日期格式不正確:${v}` });
  return d;
};

export function smbRoutes(service: CompatService, maxFileBytes: number): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/db/upload', COMPAT_ROUTE, async (req) => {
      const { parts, fields } = await readCompatParts(req, service, maxFileBytes);
      const [saved] = await service.upload('smb', parts, fields, compatCaller(req));
      return { success: true, message: '檔案上傳並記錄到資料庫成功', data: smbUploaded(saved!) };
    });

    app.get<{ Querystring: SearchQuery }>('/api/db/search', COMPAT_ROUTE, async (req) => {
      const q = req.query;
      const { items, total } = await service.list({
        ns: 'smb',
        refNo: q.sourceNumber || undefined,
        effective: q.effective === undefined ? undefined : q.effective === 'true',
        createdFrom: date(q.startDate),
        createdTo: date(q.endDate),
        limit: FB_LIST_MAX,
        offset: 0,
      });
      if (total > items.length) req.log.warn({ total, limit: FB_LIST_MAX }, '相容層 SMB 搜尋超過上限,結果已截斷');
      const rows = items.filter(
        (f: CompatRecord) =>
          like(f.meta.filename, q.filename) &&
          like(f.originalName, q.originalName) &&
          like(f.meta.mimetype, q.mimetype) &&
          like(f.meta.path, q.path) &&
          like(f.meta.destination, q.destination) &&
          like(f.meta.description, q.description) &&
          like(f.sourceSystem, q.sourcePlatform) &&
          like(f.sourceApp, q.sourceApplication) &&
          like(f.uploadedBy, q.userNumber) &&
          like(f.meta.storageType, q.storageType) &&
          like(f.meta.ip, q.ip),
      );
      return { success: true, count: rows.length, data: rows.map(smbRow) };
    });

    app.get<{ Querystring: { includeInactive?: string } }>('/api/db/files', COMPAT_ROUTE, async (req) => {
      const includeInactive = req.query.includeInactive === 'true';
      const { items, total } = await service.list({ ns: 'smb', effective: includeInactive ? undefined : true, limit: FB_LIST_MAX, offset: 0 });
      if (total > items.length) req.log.warn({ total, limit: FB_LIST_MAX }, '相容層 SMB 清單超過上限,結果已截斷');
      return { success: true, count: items.length, includeInactive, data: items.map(smbRow) };
    });

    app.get<{ Params: { id: string } }>('/api/db/files/:id', COMPAT_ROUTE, async (req) => {
      const f = await service.findSmbById(req.params.id);
      if (!f) throw new CompatError(404, { success: false, message: `找不到ID為${req.params.id}的檔案記錄` });
      return { success: true, data: smbRow(f) };
    });

    app.delete<{ Querystring: { path?: string; isDirectory?: string }; Body: { path?: string; isDirectory?: boolean } | undefined }>(
      '/api/db/delete',
      COMPAT_ROUTE,
      async (req) => {
        const path = req.query.path || req.body?.path;
        if (!path) throw new CompatError(400, { success: false, message: '請提供要刪除的檔案路徑參數 (path)' });
        if (req.query.isDirectory === 'true' || req.body?.isDirectory === true) throw new CompatError(400, { success: false, message: '不支援刪除目錄' });
        const f = await service.findSmbByPath(path);
        if (!f) return { success: true, message: '檔案刪除成功', data: { path, type: 'file', databaseRecord: 'not_found' } };
        await service.remove(f, compatCaller(req));
        return {
          success: true,
          message: '檔案刪除成功並更新資料庫狀態',
          data: { path, type: 'file', databaseId: f.meta.id ?? f.fileUuid, effectiveStatus: false },
        };
      },
    );

    app.get<{ Querystring: { path?: string } }>('/api/download', COMPAT_ROUTE, async (req, reply) => {
      const path = req.query.path;
      if (!path) throw new CompatError(400, { success: false, error: '請提供檔案路徑參數 (path)' });
      const f = await service.findSmbByPath(path);
      const opened = f ? await service.open(f, compatCaller(req)) : null;
      if (!f || !opened) throw new CompatError(404, { success: false, error: `檔案不存在: ${path}` });
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-length', String(f.sizeBytes))
        .header('content-disposition', opened.disposition)
        .header('cache-control', 'private, no-cache')
        .send(opened.stream);
    });
  };
}
