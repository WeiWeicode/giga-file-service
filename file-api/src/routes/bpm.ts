/**
 * BPM 表單附件 API(API.md §3;docs/Gherkin/bpm/attachments.feature)。後端路徑 /v1/bpm/... 對外為 /api/file/bpm/...。
 * 邏輯在 modules/bpm/bpm-service.ts。來源以 ?env=test|prod 選擇(測試區 191 / 正式區 190),未指定用預設來源;
 * 該來源未設定時回 409 FILE_BPM_DISABLED,路由仍註冊到 Gateway。
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { BpmEnv } from '../config.js';
import { AppError } from '../errors.js';
import type { BpmService, BpmSources } from '../modules/bpm/bpm-service.js';
import { DOID_RE, SERIAL_RE, type BpmAttachment } from '../modules/bpm/types.js';
import type { Actor } from '../modules/files/file-service.js';

const attachmentSchema = {
  type: 'object',
  properties: {
    doid: { type: 'string' },
    originalName: { type: 'string' },
    ext: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time', nullable: true },
    serialNumber: { type: 'string', nullable: true },
    formName: { type: 'string', nullable: true },
    subject: { type: 'string', nullable: true },
  },
};

const envQuery = { env: { type: 'string', enum: ['test', 'prod'], description: 'BPM 來源:test = 測試區 191、prod = 正式區 190;省略用預設來源' } };

/** 不回傳 physicalName(只在 file-api 內部組取檔路徑) */
const toDto = (a: BpmAttachment) => ({
  doid: a.doid,
  originalName: a.originalName,
  ext: a.ext,
  createdAt: a.createdAt?.toISOString() ?? null,
  serialNumber: a.serialNumber,
  formName: a.formName,
  subject: a.subject,
});

export function bpmRoutes(sources: BpmSources | null, actorOf: (req: FastifyRequest) => Actor): FastifyPluginAsync {
  const pick = (env: BpmEnv | undefined): BpmService => {
    if (!sources) throw new AppError(409, 'FILE_BPM_DISABLED', '此環境未設定 BPM 附件來源');
    return sources.get(env);
  };

  return async (app) => {
    app.get(
      '/v1/bpm/sources',
      {
        schema: {
          operationId: 'file.bpm.sources',
          summary: 'BPM 附件來源',
          description: '此 file-api 已設定的 BPM 來源(test = 測試區 191、prod = 正式區 190)與預設來源;畫面用來切換。都沒設定時 items 為空。',
          tags: ['BPM 附件'],
          'x-permission': 'file.bpm.read',
          'x-gherkin': [
            '場景: 列出 BPM 來源',
            '  假如 file-api 設定了測試區 191 與正式區 190',
            '  當 呼叫 GET /api/file/bpm/sources',
            '  那麼 回應 200,items 有 test 與 prod,defaultEnv 為 test',
          ].join('\n'),
          response: {
            200: {
              type: 'object',
              properties: {
                defaultEnv: { type: 'string', nullable: true },
                items: {
                  type: 'array',
                  items: { type: 'object', properties: { env: { type: 'string' }, label: { type: 'string' }, source: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      async (req) => {
        actorOf(req);
        return { defaultEnv: sources?.defaultEnv ?? null, items: sources?.list() ?? [] };
      },
    );

    app.get<{ Params: { serialNumber: string }; Querystring: { env?: BpmEnv } }>(
      '/v1/bpm/forms/:serialNumber/attachments',
      {
        schema: {
          operationId: 'file.bpm.forms.attachments',
          summary: '依單號查詢 BPM 表單附件',
          description:
            '依 BPM 單號(ProcessInstance.serialNumber)**完全比對**列出表單附件(Doid、原檔名、副檔名、表單名稱、主旨、建立時間),最多 500 筆;env / label / source 為實際查詢的來源。唯讀查詢 NaNa,不經 BPMbackend。',
          tags: ['BPM 附件'],
          'x-permission': 'file.bpm.read',
          'x-gherkin': [
            '場景: 依單號完全比對',
            '  假如 BPM 有單號 "THR005_00000519" 與 "THR005_000005190" 的表單附件',
            '  當 呼叫 GET /api/file/bpm/forms/THR005_00000519/attachments?env=prod',
            '  那麼 回應 200,只列出正式區 THR005_00000519 的附件,不含 physicalName',
          ].join('\n'),
          params: { type: 'object', required: ['serialNumber'], properties: { serialNumber: { type: 'string', pattern: SERIAL_RE } } },
          querystring: { type: 'object', properties: envQuery },
          response: {
            200: {
              type: 'object',
              properties: {
                serialNumber: { type: 'string' },
                env: { type: 'string' },
                label: { type: 'string' },
                source: { type: 'string' },
                items: { type: 'array', items: attachmentSchema },
              },
            },
          },
        },
      },
      async (req) => {
        actorOf(req);
        const s = pick(req.query.env);
        const items = await s.list(req.params.serialNumber);
        return { serialNumber: req.params.serialNumber, env: s.env, label: s.label, source: s.source, items: items.map(toDto) };
      },
    );

    app.get<{ Params: { doid: string }; Querystring: { env?: BpmEnv } }>(
      '/v1/bpm/attachments/:doid',
      {
        schema: {
          operationId: 'file.bpm.attachments.get',
          summary: 'BPM 附件資訊',
          description: '依 Doid(NoCmDocument.OID,32 碼十六進位)取得單一附件資訊與所屬表單;附件未關聯到流程時表單欄位為 null。Doid 要搭配查到它的 env。',
          tags: ['BPM 附件'],
          'x-permission': 'file.bpm.read',
          'x-gherkin': [
            '場景: 查詢單一附件',
            '  當 呼叫 GET /api/file/bpm/attachments/{doid}',
            '  那麼 回應 200,含原檔名與所屬單號;不存在回 404 FILE_BPM_NOT_FOUND',
          ].join('\n'),
          params: { type: 'object', required: ['doid'], properties: { doid: { type: 'string', pattern: DOID_RE } } },
          querystring: { type: 'object', properties: envQuery },
          response: { 200: attachmentSchema },
        },
      },
      async (req) => {
        actorOf(req);
        return toDto(await pick(req.query.env).get(req.params.doid));
      },
    );

    app.get<{ Params: { doid: string }; Querystring: { inline?: string; env?: BpmEnv } }>(
      '/v1/bpm/attachments/:doid/content',
      {
        schema: {
          operationId: 'file.bpm.attachments.download',
          summary: '下載 BPM 附件',
          description:
            '向該來源的 BPM 取檔服務(:5144)串流取得附件;目錄依 physicalName 規則推算(預測段數優先,再試 11 / 10 / 12,找到的段數快取)。Content-Disposition 含 filename*=UTF-8 中文檔名;?inline=1 只對圖片與 PDF 生效。每次下載寫入操作紀錄(bpm_download,含 env)。實體檔找不到回 404 FILE_BPM_NOT_FOUND,取檔服務拒絕或連不上回 502 FILE_BPM_UPSTREAM。',
          tags: ['BPM 附件'],
          'x-permission': 'file.bpm.read',
          'x-timeout-ms': 60_000,
          'x-gherkin': [
            '場景: 下載 BPM 附件並帶 UTF-8 檔名',
            '  假如 Doid 對應的附件原檔名為 "客訴報告.xlsx"',
            '  當 呼叫 GET /api/file/bpm/attachments/{doid}/content?env=test',
            "  那麼 回應 200,Content-Disposition 含 filename*=UTF-8''%E5%AE%A2...,操作紀錄有 bpm_download",
          ].join('\n'),
          params: { type: 'object', required: ['doid'], properties: { doid: { type: 'string', pattern: DOID_RE } } },
          querystring: { type: 'object', properties: { inline: { type: 'string', enum: ['0', '1'] }, ...envQuery } },
        },
      },
      async (req, reply) => {
        const actor = actorOf(req);
        const { stream, size, mime, disposition } = await pick(req.query.env).open(req.params.doid, req.query.inline === '1', actor);
        reply.header('content-type', mime).header('content-disposition', disposition).header('cache-control', 'private, no-cache');
        if (size !== null) reply.header('content-length', String(size));
        return reply.send(stream);
      },
    );
  };
}
