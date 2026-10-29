/**
 * filebackend 相容(API.md §4.1):/api/file/compat/fb/*,路徑與 JSON 照舊 sqlFileController.js。
 * 舊前端 BPM bpmcomonent/FileUpload.vue 用 /sql-files、/sql-upload、/sql-upload-multiple、/sql-download/:id、/sql-delete/:id。
 */
import type { FastifyPluginAsync } from 'fastify';
import { CompatError, FB_LIST_MAX, type CompatService } from '../modules/compat/compat-service.js';
import { compatCaller, COMPAT_ROUTE, readCompatParts } from './common.js';
import { fbListItem, fbUploaded } from './views.js';

/** 舊服務用 parseInt;非數字或超出範圍時改用預設值,不回 500 */
const intOr = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

/** /sql-stats 統計的上限(舊資料 2026-10 約 100 筆) */
const STATS_MAX = 10_000;

export function fbRoutes(service: CompatService, maxFileBytes: number): FastifyPluginAsync {
  return async (app) => {
    app.post('/sql-upload', COMPAT_ROUTE, async (req) => {
      const { parts, fields } = await readCompatParts(req, service, maxFileBytes);
      if (parts.length > 1) {
        await Promise.all(parts.map((p) => service.store.discard(p.temp.tmpPath)));
        throw new CompatError(400, { success: false, message: '一次只能上傳一個檔案,多個檔案請用 /sql-upload-multiple' });
      }
      const [saved] = await service.upload('fb', parts, fields, compatCaller(req));
      return { success: true, message: '檔案上傳成功並記錄到資料庫', file: fbUploaded(saved!, true), databaseLogged: true };
    });

    app.post('/sql-upload-multiple', COMPAT_ROUTE, async (req) => {
      const { parts, fields } = await readCompatParts(req, service, maxFileBytes);
      const saved = await service.upload('fb', parts, fields, compatCaller(req));
      return { success: true, message: `${saved.length} 個檔案上傳成功並記錄到資料庫`, files: saved.map((f) => fbUploaded(f, false)), databaseLogged: true };
    });

    // 規則 8:沒帶 limit 時回全部有效檔(上限 1000),修正舊的 50 筆缺陷;有帶 limit / offset 照舊
    app.get<{ Querystring: { platform?: string; limit?: string; offset?: string } }>('/sql-files', COMPAT_ROUTE, async (req) => {
      const q = req.query;
      const { items, total } = await service.list({
        ns: 'fb',
        effective: true,
        sourceSystem: q.platform || undefined,
        limit: q.limit === undefined ? FB_LIST_MAX : intOr(q.limit, 50, 1, FB_LIST_MAX),
        offset: intOr(q.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      });
      return { success: true, total, files: items.map(fbListItem) };
    });

    app.get<{ Querystring: { sourceNumber?: string } }>('/sql-files-by-source', COMPAT_ROUTE, async (req) => {
      const sourceNumber = req.query.sourceNumber;
      if (!sourceNumber) throw new CompatError(400, { success: false, message: '請提供單號 (sourceNumber)' });
      const { items, total } = await service.list({ ns: 'fb', effective: true, refNo: sourceNumber, limit: FB_LIST_MAX, offset: 0 });
      return { success: true, total, files: items.map(fbListItem) };
    });

    app.get<{ Params: { id: string } }>('/sql-download/:id', COMPAT_ROUTE, async (req, reply) => {
      const f = await service.findFb(req.params.id);
      if (!f) throw new CompatError(404, { success: false, message: '檔案記錄不存在或已被刪除' });
      const opened = await service.open(f, compatCaller(req));
      if (!opened) {
        req.log.warn({ fileUuid: f.fileUuid, storageKey: f.storageKey }, '相容層下載:找不到實體檔案');
        throw new CompatError(404, { success: false, message: '實體檔案不存在' });
      }
      return reply
        .header('content-type', opened.mime)
        .header('content-length', String(f.sizeBytes))
        .header('content-disposition', opened.disposition)
        .header('cache-control', 'private, no-cache')
        .send(opened.stream);
    });

    // 舊服務不檢查 Effective:已刪除的再刪一次仍回成功(冪等)
    app.delete<{ Params: { id: string } }>('/sql-delete/:id', COMPAT_ROUTE, async (req) => {
      const f = await service.findFb(req.params.id, true);
      if (!f) throw new CompatError(404, { success: false, message: '檔案記錄不存在' });
      if (!f.deletedAt) await service.remove(f, compatCaller(req));
      return { success: true, message: '檔案刪除成功' };
    });

    app.get('/sql-stats', COMPAT_ROUTE, async () => {
      const { items } = await service.list({ ns: 'fb', effective: true, limit: STATS_MAX, offset: 0 });
      const totalSize = items.reduce((s, f) => s + f.sizeBytes, 0);
      const group = <K extends string>(key: (f: (typeof items)[number]) => K) => {
        const m = new Map<K, { count: number; totalSize: number }>();
        for (const f of items) {
          const g = m.get(key(f)) ?? { count: 0, totalSize: 0 };
          g.count++;
          g.totalSize += f.sizeBytes;
          m.set(key(f), g);
        }
        return [...m.entries()];
      };
      return {
        success: true,
        stats: {
          totalFiles: items.length,
          totalSize,
          averageSize: items.length > 0 ? Math.round(totalSize / items.length) : 0,
          platforms: group((f) => f.sourceSystem).map(([platform, g]) => ({ platform, ...g })),
          fileTypes: group((f) => f.meta.mimetype ?? '').map(([mimetype, g]) => ({ mimetype, count: g.count })),
        },
      };
    });
  };
}
