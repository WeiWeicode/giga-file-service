/**
 * 舊格式相容層(API.md §4;D15;LEGACY-SWITCH-PLAN.md):後端路徑 /compat/fb/*、/compat/smb/api/*,對外 /api/file/compat/*。
 *   - 由 Gateway Nginx 直接轉給 file-api(內網白名單,不經 BFF:BFF 對免登入路由不帶內部 Token,且全域上限 10 MB),
 *     所以不驗 X-Internal-Token(AGENT.md §0 唯一例外),也不出現在 OpenAPI、不自動註冊到 Gateway 路由表
 *   - 錯誤一律舊式 { success:false, message, error? }(規則 1);這個 plugin 自己的 error handler,不影響新 API
 */
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { CompatError, type CompatService } from '../modules/compat/compat-service.js';
import { PathEscapeError } from '../modules/storage/local-store.js';
import { fbRoutes } from './fb.js';
import { smbRoutes } from './smb.js';

/** mssql 連線類錯誤:資料庫連不上回 503,不退回只存檔(規則 7) */
const isDbUnavailable = (err: unknown) => {
  const e = err as { name?: string; code?: string };
  return e.name === 'ConnectionError' || e.code === 'ESOCKET' || e.code === 'ETIMEOUT' || e.code === 'ECONNCLOSED';
};

export function compatPlugin(service: CompatService, maxFileBytes: number): FastifyPluginAsync {
  return async (app) => {
    app.setErrorHandler((err: FastifyError, req, reply) => {
      if (err instanceof CompatError) return reply.status(err.status).send(err.body);
      if (isDbUnavailable(err)) {
        req.log.error({ err }, '相容層:資料庫無法連線');
        return reply.status(503).send({ success: false, message: '資料庫連接失敗，請稍後再試', error: 'Database connection failed' });
      }
      // 框架的 4xx(multipart 欄位上限、JSON 格式錯誤等)回舊式 4xx,不當成 500
      if (err.validation || (err.statusCode && err.statusCode < 500))
        return reply.status(err.statusCode && err.statusCode < 500 ? err.statusCode : 400).send({ success: false, message: '請求格式錯誤' });
      if (err instanceof PathEscapeError) req.log.error({ err }, 'storage_key 逃出檔案根目錄');
      else req.log.error({ err }, '相容層:非預期錯誤');
      // 不回傳例外訊息與堆疊(舊服務會回 error.message,新服務不外洩內部細節)
      return reply.status(500).send({ success: false, message: '系統發生錯誤', error: 'INTERNAL_ERROR' });
    });

    await app.register(fbRoutes(service, maxFileBytes), { prefix: '/compat/fb' });
    await app.register(smbRoutes(service, maxFileBytes), { prefix: '/compat/smb' });
  };
}
