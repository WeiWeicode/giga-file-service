/**
 * OpenAPI 根層設定(BACKEND-GUIDE.md §6.1):x-gateway 與 x-permissions 必填。
 * 每個 operation 的 operationId、summary、description、x-permission、x-gherkin 寫在各路由的 schema。
 */
import type { SwaggerOptions } from '@fastify/swagger';

declare module 'fastify' {
  interface FastifySchema {
    /** 權限代碼(例 file.object.read)、authenticated 或 public(需 IT 核准) */
    'x-permission'?: string;
    /** 行為規格:Gherkin 場景文字(zh-TW 關鍵字),存入 gw.api_route.gherkin */
    'x-gherkin'?: string;
    'x-audit-level'?: 'none' | 'meta' | 'body';
    'x-timeout-ms'?: number;
    'x-gateway-path'?: string;
  }
}

/** API 權限代碼(API.md §1.1);畫面節點 it.gw-file.* 由 GigaItApp gateway-rbac.yaml 以 includes 綁定(PRD §8) */
export const PERMISSIONS = [
  { code: 'file.object.read', name: '附件:查詢與下載' },
  { code: 'file.object.upload', name: '附件:上傳與綁定單據' },
  { code: 'file.object.delete', name: '附件:刪除' },
  { code: 'file.storage.read', name: '附件:儲存與備份狀態' },
  { code: 'file.storage.manage', name: '附件:重試 NAS 備份' },
  { code: 'file.bpm.read', name: 'BPM 表單附件:查詢與下載' },
];

export function swaggerOptions(serviceCode: string, project: string): SwaggerOptions {
  const extensions = { 'x-gateway': { upstream: serviceCode, system: 'file', project }, 'x-permissions': PERMISSIONS };
  return { openapi: { openapi: '3.0.3', info: { title: '附件服務 file-api', version: '0.1.0' }, ...extensions } };
}
