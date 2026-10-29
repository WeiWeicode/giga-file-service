/** 相容層路由共用:呼叫端資訊、multipart 讀取、路由設定(plugin.ts、fb.ts、smb.ts) */
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import {
  CompatError,
  COMPAT_FIELD_NAMES,
  type CompatCaller,
  type CompatFields,
  type CompatPart,
  type CompatService,
} from '../modules/compat/compat-service.js';

export const compatCaller = (req: FastifyRequest): CompatCaller => {
  const fwd = req.headers['x-forwarded-for'];
  const ua = req.headers['user-agent'];
  return {
    ip: (typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : undefined) || req.ip || null,
    userAgent: typeof ua === 'string' ? ua : null,
    requestId: req.id,
  };
};

/** multipart:檔案邊收邊寫暫存檔(不整個讀進記憶體);表單欄位只收兩個舊服務定義過的 */
export async function readCompatParts(
  req: FastifyRequest,
  service: CompatService,
  maxFileBytes: number,
): Promise<{ parts: CompatPart[]; fields: CompatFields }> {
  const parts: CompatPart[] = [];
  const fields: CompatFields = {};
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const file = part as MultipartFile;
        const temp = await service.store.writeTemp(file.file, maxFileBytes);
        if (file.file.truncated) temp.truncated = true;
        parts.push({ originalName: file.filename, temp });
      } else if (COMPAT_FIELD_NAMES.has(part.fieldname) && typeof part.value === 'string') {
        fields[part.fieldname as keyof CompatFields] = part.value;
      }
    }
  } catch (err) {
    await Promise.all(parts.map((p) => service.store.discard(p.temp.tmpPath)));
    const code = (err as { code?: string }).code;
    if (code === 'FST_FILES_LIMIT') throw new CompatError(413, { success: false, message: '一次最多上傳 10 個檔案' });
    if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') throw new CompatError(400, { success: false, message: '請以 multipart/form-data 上傳' });
    throw err;
  }
  return { parts, fields };
}

/** 相容層路由共用設定:不驗內部 Token、不進 OpenAPI */
export const COMPAT_ROUTE = { config: { gatewayAuth: false }, schema: { hide: true } } as const;
