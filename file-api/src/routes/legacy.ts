/**
 * 舊系統匯入檔案 API(F4 / A4;API.md §2;PRD §8「舊系統」Tab)。後端路徑 /v1/legacy... 對外為 /api/file/legacy...。
 * 唯讀:匯入摘要、對照清單、下載(管理者查核);邏輯在 modules/legacy/legacy-service.ts。權限 file.legacy.read。
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import type { Actor } from '../modules/files/file-service.js';
import { LEGACY_SOURCES, type LegacyItem, type LegacyService, type LegacySource } from '../modules/legacy/legacy-service.js';

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const itemSchema = {
  type: 'object',
  properties: {
    fileUuid: { type: 'string' },
    legacySource: { type: 'string', enum: LEGACY_SOURCES },
    legacyKey: { type: 'string', nullable: true },
    legacyDir: { type: 'string', nullable: true },
    legacyName: { type: 'string' },
    isCurrent: { type: 'boolean' },
    syncState: { type: 'string' },
    importedAt: { type: 'string', format: 'date-time' },
    originalName: { type: 'string' },
    refNo: { type: 'string', nullable: true },
    sourceSystem: { type: 'string' },
    sourceApp: { type: 'string', nullable: true },
    sizeBytes: { type: 'integer' },
    sha256: { type: 'string' },
    uploadedBy: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    deleted: { type: 'boolean' },
    backupStatus: { type: 'string', enum: ['pending', 'done', 'failed'] },
  },
} as const;

/** 不回 storage_key(實體路徑,AGENT.md §7.3) */
const view = (i: LegacyItem) => ({
  fileUuid: i.fileUuid,
  legacySource: i.legacySource,
  legacyKey: i.legacyKey,
  legacyDir: i.legacyDir,
  legacyName: i.legacyName,
  isCurrent: i.isCurrent,
  syncState: i.syncState,
  importedAt: i.importedAt.toISOString(),
  originalName: i.originalName,
  refNo: i.refNo,
  sourceSystem: i.sourceSystem,
  sourceApp: i.sourceApp,
  sizeBytes: i.sizeBytes,
  sha256: i.sha256,
  uploadedBy: i.uploadedBy,
  createdAt: i.createdAt.toISOString(),
  deleted: i.deletedAt !== null,
  backupStatus: i.backupStatus,
});

export function legacyRoutes(service: LegacyService | null, actorOf: (req: FastifyRequest) => Actor): FastifyPluginAsync {
  const svc = () => {
    if (!service) throw new AppError(409, 'FILE_LEGACY_DISABLED', '此環境未提供舊系統查詢');
    return service;
  };

  return async (app) => {
    app.get(
      '/v1/legacy/summary',
      {
        schema: {
          operationId: 'file.legacy.summary',
          summary: '舊系統匯入摘要',
          description:
            '各舊系統來源(filebackend、smbbackend)已匯入的檔案數、容量、在新服務已刪除數、NAS 備份狀態、最後匯入時間;沒有匯入資料的來源數量為 0。166 PortalSolar、190 SDSFILES 尚未同步,不在此列。',
          tags: ['舊系統'],
          'x-permission': 'file.legacy.read',
          'x-gherkin': [
            '場景: 匯入摘要',
            '  假如 已匯入 filebackend 103 筆、smbbackend 54 筆',
            '  當 呼叫 GET /api/file/legacy/summary',
            '  那麼 回應 200,items 依序為 filebackend(files 103)、smbbackend(files 54)',
          ].join('\n'),
          response: {
            200: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      source: { type: 'string' },
                      files: { type: 'integer' },
                      bytes: { type: 'integer' },
                      deleted: { type: 'integer' },
                      backup: { type: 'object', properties: { pending: { type: 'integer' }, done: { type: 'integer' }, failed: { type: 'integer' } } },
                      lastImportedAt: { type: 'string', format: 'date-time', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async (req) => {
        actorOf(req);
        const items = await svc().summary();
        return { items: items.map((s) => ({ ...s, lastImportedAt: s.lastImportedAt?.toISOString() ?? null })) };
      },
    );

    app.get<{ Querystring: { source?: LegacySource; q?: string; page: number; pageSize: number } }>(
      '/v1/legacy/files',
      {
        schema: {
          operationId: 'file.legacy.list',
          summary: '舊系統匯入檔案清單',
          description:
            '已匯入的舊檔與其對照(舊 id、舊檔名 / path、原檔名、單號、新 UUID、SHA-256、在新服務是否已刪除、備份狀態),可依來源篩選、以關鍵字部分比對舊 id / 舊檔名 / 原檔名 / 單號,後端分頁。isCurrent 為 false 表示與其他表單共用同一個舊檔(各自匯入)。',
          tags: ['舊系統'],
          'x-permission': 'file.legacy.read',
          'x-gherkin': [
            '場景: 依單號關鍵字查詢',
            '  假如 已匯入 smbbackend 舊 id 31(單號 SP-1)與 32(單號 SP-10)',
            '  當 呼叫 GET /api/file/legacy/files?source=smbbackend&q=SP-10',
            '  那麼 回應 total 為 1,items[0].legacyKey 為 "32"',
          ].join('\n'),
          querystring: {
            type: 'object',
            properties: {
              source: { type: 'string', enum: LEGACY_SOURCES },
              q: { type: 'string', maxLength: 100 },
              page: { type: 'integer', minimum: 1, default: 1 },
              pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: { items: { type: 'array', items: itemSchema }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } },
            },
          },
        },
      },
      async (req) => {
        actorOf(req);
        const q = req.query;
        const { items, total } = await svc().list({ source: q.source, q: q.q, page: q.page, pageSize: q.pageSize });
        return { items: items.map(view), total, page: q.page, pageSize: q.pageSize };
      },
    );

    app.get<{ Params: { uuid: string } }>(
      '/v1/legacy/files/:uuid/content',
      {
        schema: {
          operationId: 'file.legacy.download',
          summary: '下載匯入的舊檔',
          description:
            '管理者查核用:下載匯入的舊檔(含已在新服務刪除、實體檔仍保留者);Content-Disposition 含 UTF-8 原檔名。不是匯入的舊檔回 404 FILE_NOT_FOUND。每次下載寫入操作紀錄。',
          tags: ['舊系統'],
          'x-permission': 'file.legacy.read',
          'x-audit-level': 'meta',
          'x-timeout-ms': 60_000,
          'x-gherkin': [
            '場景: 下載匯入的舊檔',
            '  假如 已匯入 filebackend 舊 id 140 的 "電子發票設定.pdf"',
            '  當 呼叫 GET /api/file/legacy/files/{fileUuid}/content',
            "  那麼 回應 200,Content-Disposition 含 filename*=UTF-8''%E9%9B%BB...",
          ].join('\n'),
          params: { type: 'object', required: ['uuid'], properties: { uuid: { type: 'string', pattern: UUID } } },
        },
      },
      async (req, reply) => {
        const actor = actorOf(req);
        const { item, stream, disposition, mime } = await svc().open(req.params.uuid.toLowerCase(), {
          userId: actor.scope.userId,
          ip: actor.ip,
          requestId: actor.requestId,
        });
        return reply
          .header('content-type', mime)
          .header('content-length', String(item.sizeBytes))
          .header('content-disposition', disposition)
          .header('cache-control', 'private, no-cache')
          .send(stream);
      },
    );
  };
}
