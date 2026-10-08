/**
 * 新服務檔案 API(API.md §2;docs/Gherkin/files/*.feature)。後端路徑 /v1/... 對外為 /api/file/...。
 * 路由只做 schema 驗證、權限宣告與格式轉換;邏輯在 modules/files/file-service.ts。
 */
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import type { Actor, FileService, UploadFields, UploadPart } from '../modules/files/file-service.js';
import type { FileRecord } from '../modules/files/types.js';

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const FIELD_NAMES = new Set(['sourceSystem', 'sourceApp', 'refType', 'refNo']);

const fileSchema = {
  type: 'object',
  properties: {
    fileUuid: { type: 'string', format: 'uuid' },
    originalName: { type: 'string' },
    ext: { type: 'string', nullable: true },
    mime: { type: 'string', nullable: true },
    sizeBytes: { type: 'integer' },
    sha256: { type: 'string' },
    sourceSystem: { type: 'string' },
    sourceApp: { type: 'string', nullable: true },
    refType: { type: 'string', nullable: true },
    refNo: { type: 'string', nullable: true },
    companyId: { type: 'string', nullable: true },
    uploadedBy: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    boundAt: { type: 'string', format: 'date-time', nullable: true },
    backupStatus: { type: 'string', enum: ['pending', 'done', 'failed'] },
    backupAt: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

/** 對外欄位:不回 storage_key(實體路徑)、uploaded_ip、刪除資訊(AGENT.md §7.3) */
const view = (f: FileRecord) => ({
  fileUuid: f.fileUuid,
  originalName: f.originalName,
  ext: f.ext,
  mime: f.mime,
  sizeBytes: f.sizeBytes,
  sha256: f.sha256,
  sourceSystem: f.sourceSystem,
  sourceApp: f.sourceApp,
  refType: f.refType,
  refNo: f.refNo,
  companyId: f.companyId,
  uploadedBy: f.uploadedBy,
  createdAt: f.createdAt.toISOString(),
  boundAt: f.boundAt?.toISOString() ?? null,
  backupStatus: f.backupStatus,
  backupAt: f.backupAt?.toISOString() ?? null,
});

const errorRef = (codes: string) => `錯誤:${codes}。`;

export function fileRoutes(service: FileService, actorOf: (req: FastifyRequest) => Actor, maxFileBytes: number): FastifyPluginAsync {
  return async (app) => {
    app.post(
      '/v1/files',
      {
        schema: {
          operationId: 'file.object.upload',
          summary: '上傳附件',
          description:
            'multipart/form-data 上傳一或多個檔案(欄位 file,單檔 30 MB、一次最多 10 個),選填 sourceSystem、sourceApp、refType、refNo。' +
            '未帶 refNo 為暫存檔,單據存檔時呼叫綁定 API;超過 24 小時未綁定會被清除。副檔名白名單 + 檔頭檢查,執行檔與腳本一律拒絕;任一檔不合格整批拒絕。' +
            errorRef('400 FILE_NO_FILE / VALIDATION_FAILED、413 FILE_TOO_LARGE / FILE_TOO_MANY、415 FILE_TYPE_NOT_ALLOWED / FILE_CONTENT_MISMATCH'),
          tags: ['附件'],
          consumes: ['multipart/form-data'],
          'x-permission': 'file.object.upload',
          'x-audit-level': 'meta',
          'x-timeout-ms': 60_000,
          'x-gherkin': [
            '場景: 上傳單一檔案後取得 UUID,狀態為暫存',
            '  假如 使用者擁有 file.object.upload',
            '  當 以 multipart 上傳 "報價單.pdf" 到 POST /api/file/files',
            '  那麼 回應 201,items[0].fileUuid 為 UUID、refNo 為 null、backupStatus 為 "pending"',
            '場景: 拒絕執行檔',
            '  當 上傳 "setup.exe"',
            '  那麼 回應 415,code 為 "FILE_TYPE_NOT_ALLOWED",且沒有留下任何檔案',
            '場景: 副檔名與檔頭不符',
            '  當 上傳內容為執行檔的 "偽裝.pdf"',
            '  那麼 回應 415,code 為 "FILE_CONTENT_MISMATCH"',
          ].join('\n'),
          response: { 201: { type: 'object', properties: { items: { type: 'array', items: fileSchema } } } },
        },
      },
      async (req, reply) => {
        const actor = actorOf(req);
        const parts: UploadPart[] = [];
        const fields: UploadFields = {};
        try {
          for await (const part of req.parts()) {
            if (part.type === 'file') {
              const file = part as MultipartFile;
              const temp = await service.store.writeTemp(file.file, maxFileBytes);
              // @fastify/multipart 在 fileSize 上限截斷時設定 truncated(throwFileSizeLimit: false)
              if (file.file.truncated) temp.truncated = true;
              parts.push({ originalName: file.filename, temp });
            } else if (FIELD_NAMES.has(part.fieldname) && typeof part.value === 'string') {
              fields[part.fieldname as keyof UploadFields] = part.value;
            }
          }
        } catch (err) {
          await Promise.all(parts.map((p) => service.store.discard(p.temp.tmpPath)));
          const code = (err as { code?: string }).code;
          if (code === 'FST_FILES_LIMIT') throw new AppError(413, 'FILE_TOO_MANY', '一次最多上傳 10 個檔案');
          if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') throw new AppError(400, 'VALIDATION_FAILED', '請以 multipart/form-data 上傳');
          throw err;
        }
        const saved = await service.upload(parts, fields, actor);
        return reply.status(201).send({ items: saved.map(view) });
      },
    );

    app.get<{
      Querystring: { page: number; pageSize: number; sourceSystem?: string; refType?: string; refNo?: string; uploadedBy?: string; from?: string; to?: string };
    }>(
      '/v1/files',
      {
        schema: {
          operationId: 'file.object.list',
          summary: '附件清單',
          description: '列出可存取的附件(自己上傳的,或所屬公司的;系統身分只看自己上傳的),可依來源系統、單據、上傳者、建立時間篩選,後端分頁。不含已刪除的檔案。',
          tags: ['附件'],
          'x-permission': 'file.object.read',
          'x-gherkin': [
            '場景: 依單號篩選並分頁',
            '  假如 已上傳 3 個檔案,其中 2 個綁定 refNo "ECR-2026-003"',
            '  當 呼叫 GET /api/file/files?refNo=ECR-2026-003&page=1&pageSize=1',
            '  那麼 回應 total 為 2、items 有 1 筆',
          ].join('\n'),
          querystring: {
            type: 'object',
            properties: {
              page: { type: 'integer', minimum: 1, default: 1 },
              pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              sourceSystem: { type: 'string', maxLength: 50 },
              refType: { type: 'string', maxLength: 50 },
              refNo: { type: 'string', maxLength: 100 },
              uploadedBy: { type: 'string', maxLength: 64 },
              from: { type: 'string', format: 'date-time' },
              to: { type: 'string', format: 'date-time' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: { items: { type: 'array', items: fileSchema }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } },
            },
          },
        },
      },
      async (req) => {
        const q = req.query;
        const { items, total } = await service.list(
          {
            page: q.page,
            pageSize: q.pageSize,
            sourceSystem: q.sourceSystem,
            refType: q.refType,
            refNo: q.refNo,
            uploadedBy: q.uploadedBy,
            createdFrom: q.from ? new Date(q.from) : undefined,
            createdTo: q.to ? new Date(q.to) : undefined,
          },
          actorOf(req),
        );
        return { items: items.map(view), total, page: q.page, pageSize: q.pageSize };
      },
    );

    app.post<{ Body: { uuids: string[]; refType?: string; refNo: string } }>(
      '/v1/files/bind',
      {
        schema: {
          operationId: 'file.object.bind',
          summary: '暫存附件綁定單據',
          description: '單據存檔時,把自己上傳的附件綁定到單據(refType、refNo)。任一 UUID 不存在回 404、不是自己上傳的回 403,整批不綁定。',
          tags: ['附件'],
          'x-permission': 'file.object.upload',
          'x-audit-level': 'meta',
          'x-gherkin': [
            '場景: 單據存檔時綁定暫存檔',
            '  假如 使用者已上傳 2 個暫存檔',
            '  當 呼叫 POST /api/file/files/bind,uuids 兩筆、refNo "ECR-2026-002"',
            '  那麼 回應 200,bound 為 2',
            '場景: 不可綁定他人上傳的檔案',
            '  當 綁定 S100001 上傳的檔案',
            '  那麼 回應 403,code 為 "DATA_ACCESS_DENIED"',
          ].join('\n'),
          body: {
            type: 'object',
            required: ['uuids', 'refNo'],
            additionalProperties: false,
            properties: {
              uuids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', pattern: UUID } },
              refType: { type: 'string', maxLength: 50 },
              refNo: { type: 'string', minLength: 1, maxLength: 100 },
            },
          },
          response: { 200: { type: 'object', properties: { bound: { type: 'integer' } } } },
        },
      },
      async (req) => ({ bound: await service.bind(req.body.uuids, req.body.refType ?? null, req.body.refNo.trim(), actorOf(req)) }),
    );

    app.get<{ Params: { uuid: string } }>(
      '/v1/files/:uuid',
      {
        schema: {
          operationId: 'file.object.get',
          summary: '附件資訊',
          description: '依 UUID 查詢附件資訊;不存在或已刪除回 404 FILE_NOT_FOUND,不在資料範圍回 403 DATA_ACCESS_DENIED。',
          tags: ['附件'],
          'x-permission': 'file.object.read',
          'x-gherkin': ['場景: 查詢不存在的附件', '  當 呼叫 GET /api/file/files/{不存在的 UUID}', '  那麼 回應 404,code 為 "FILE_NOT_FOUND"'].join('\n'),
          params: { type: 'object', required: ['uuid'], properties: { uuid: { type: 'string', pattern: UUID } } },
          response: { 200: fileSchema },
        },
      },
      async (req) => view(await service.get(req.params.uuid.toLowerCase(), actorOf(req))),
    );

    app.get<{ Params: { uuid: string }; Querystring: { inline?: string } }>(
      '/v1/files/:uuid/content',
      {
        schema: {
          operationId: 'file.object.download',
          summary: '下載附件',
          description:
            '串流下載附件內容;Content-Disposition 含 ASCII 後備檔名與 filename*=UTF-8 中文檔名。?inline=1 只對圖片與 PDF 生效(SVG 一律以附件下載)。每次下載寫入操作紀錄。',
          tags: ['附件'],
          'x-permission': 'file.object.read',
          'x-timeout-ms': 60_000,
          'x-gherkin': [
            '場景: 下載時帶 UTF-8 檔名',
            '  假如 已上傳 "電子發票設定.docx"',
            '  當 呼叫 GET /api/file/files/{fileUuid}/content',
            "  那麼 回應 200,Content-Disposition 含 filename*=UTF-8''%E9%9B%BB...,X-Content-Type-Options 為 nosniff",
            '場景: SVG 不 inline',
            '  當 以 ?inline=1 下載 "圖.svg"',
            '  那麼 Content-Disposition 為 attachment',
          ].join('\n'),
          params: { type: 'object', required: ['uuid'], properties: { uuid: { type: 'string', pattern: UUID } } },
          querystring: { type: 'object', properties: { inline: { type: 'string', enum: ['0', '1'] } } },
        },
      },
      async (req, reply) => {
        const { file, stream, disposition } = await service.open(req.params.uuid.toLowerCase(), req.query.inline === '1', actorOf(req));
        return reply
          .header('content-type', file.mime ?? 'application/octet-stream')
          .header('content-length', String(file.sizeBytes))
          .header('content-disposition', disposition)
          .header('cache-control', 'private, no-cache')
          .send(stream);
      },
    );

    app.delete<{ Params: { uuid: string } }>(
      '/v1/files/:uuid',
      {
        schema: {
          operationId: 'file.object.delete',
          summary: '刪除附件',
          description: '軟刪除(只設 deleted_at,不刪實體檔與 NAS 備份);之後清單與下載都看不到。已刪除再刪回 404。',
          tags: ['附件'],
          'x-permission': 'file.object.delete',
          'x-audit-level': 'meta',
          'x-gherkin': [
            '場景: 軟刪除後清單與下載都看不到,但實體檔保留',
            '  當 呼叫 DELETE /api/file/files/{fileUuid}',
            '  那麼 回應 204,之後 GET 回 404 FILE_NOT_FOUND,實體檔仍存在',
          ].join('\n'),
          params: { type: 'object', required: ['uuid'], properties: { uuid: { type: 'string', pattern: UUID } } },
        },
      },
      async (req, reply) => {
        await service.remove(req.params.uuid.toLowerCase(), actorOf(req));
        return reply.status(204).send();
      },
    );

    app.get(
      '/v1/storage',
      {
        schema: {
          operationId: 'file.storage.get',
          summary: '儲存與備份統計',
          description:
            '檔案數、容量、暫存檔數、NAS 備份狀態(pending / done / failed)與最近失敗清單、磁碟容量(有主機磁碟目錄時以 Windows 主機磁碟為準,basis = host)。NAS 備份於 F2 實作前一律為 pending。',
          tags: ['儲存'],
          'x-permission': 'file.storage.read',
          'x-gherkin': [
            '場景: 儲存與備份統計',
            '  假如 已上傳 2 個檔案',
            '  當 呼叫 GET /api/file/storage',
            '  那麼 回應 files 為 2、backup.pending 為 2',
          ].join('\n'),
          response: {
            200: {
              type: 'object',
              properties: {
                files: { type: 'integer' },
                bytes: { type: 'integer' },
                temp: { type: 'integer' },
                backup: { type: 'object', properties: { pending: { type: 'integer' }, done: { type: 'integer' }, failed: { type: 'integer' } } },
                failedItems: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { fileUuid: { type: 'string' }, originalName: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
                  },
                },
                capacity: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    totalBytes: { type: 'integer' },
                    freeBytes: { type: 'integer' },
                    basis: { type: 'string', enum: ['host', 'filesystem'] },
                    filesystem: { type: 'object', properties: { totalBytes: { type: 'integer' }, freeBytes: { type: 'integer' } } },
                  },
                },
              },
            },
          },
        },
      },
      async () => {
        const s = await service.stats();
        return { ...s, failedItems: s.failedItems.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })) };
      },
    );
  };
}
