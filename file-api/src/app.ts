/**
 * Fastify 應用程式(結構沿用 Gateway samples/node-backend 與 RustIt ItAgentBack 的 mgmt-app.ts):
 *   - 只認 X-Internal-Token(ES256、iss=giganexus-bff、aud=file-api;BACKEND-GUIDE.md §4.2),身分放在 req.identity
 *   - dev 可設 DEV_SKIP_TOKEN=1 不驗證(本機直連);test / prod 設定即啟動失敗(config.ts)
 *   - 錯誤格式 { code, message, requestId, details? }(§5.3);GET /healthz、/readyz、/openapi.json
 *   - setupGateway:API 監控送 giga-observe、test / prod 開始服務後自動註冊 OpenAPI 草稿(§7.5)
 */
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import { createTokenVerifier, errorBody, INTERNAL_TOKEN_HEADER, type DepStatus, type GatewayIdentity } from '@giganexus/backend-sdk';
import { setupGateway } from '@giganexus/backend-sdk/fastify';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import type { BackupService } from './modules/backup/backup-service.js';
import type { Actor, FileService } from './modules/files/file-service.js';
import { PathEscapeError } from './modules/storage/local-store.js';
import { swaggerOptions } from './openapi.js';
import { fileRoutes } from './routes/files.js';

declare module 'fastify' {
  interface FastifyRequest {
    identity: GatewayIdentity | null;
  }
  interface FastifyContextConfig {
    /** false:不驗證 Token(健康檢查、OpenAPI) */
    gatewayAuth?: boolean;
  }
}

/** DEV_SKIP_TOKEN 時的身分(只在 dev) */
const DEV_IDENTITY: GatewayIdentity = { sub: 'dev', emp: 'dev', name: '本機開發', cos: ['dev'], roles: ['dev'] };

export interface AppOptions {
  config: Pick<Config, 'gateway' | 'monitor' | 'logLevel' | 'devSkipToken' | 'maxFileBytes' | 'maxFilesPerRequest'>;
  service: FileService;
  /** null = 此環境未設定 NAS 備份 */
  backup?: BackupService | null;
  /** 就緒檢查:SQL Server、檔案根目錄可用 */
  readiness?: () => Promise<{ ok: boolean; checks: Record<string, string> }>;
  deps?: () => Promise<DepStatus[]>;
}

/** Token 身分 → 資料範圍(types.ts Scope;第一版,PRD §11 #5 待定) */
export function actorOf(req: FastifyRequest): Actor {
  const id = req.identity;
  if (!id) throw new AppError(401, 'FILE_INTERNAL_TOKEN_INVALID', '缺少內部 Token');
  const forwarded = req.headers['x-forwarded-for'];
  // BFF 以 req.ips 重設 X-Forwarded-For(使用者送的已被丟棄);第一個為瀏覽器來源
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) || req.ip || null;
  const isSystem = id.amr === 'api_key' || id.amr === 'webhook' || id.sub.startsWith('client:') || id.sub.startsWith('webhook:');
  if (isSystem) return { scope: { kind: 'system', userId: id.sub }, ip, requestId: req.id, companyId: null };
  const companies = id.cos ?? [];
  return { scope: { kind: 'user', userId: id.emp ?? id.sub, companies }, ip, requestId: req.id, companyId: companies[0] ?? null };
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { config, service } = opts;
  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers["x-internal-token"]'] },
    // 沿用 Gateway 傳下來的 X-Request-Id,寫入每一筆日誌(§5.2)
    requestIdHeader: 'x-request-id',
  });
  const verify = createTokenVerifier({ jwksUrl: config.gateway.jwksUrl!, audience: config.gateway.serviceCode });

  await app.register(swagger, swaggerOptions(config.gateway.serviceCode, config.gateway.project));
  await app.register(setupGateway, {
    env: config.gateway,
    monitor: config.monitor,
    version: process.env.npm_package_version,
    monitorOptions: { deps: opts.deps ?? null },
  });
  // 串流處理:檔案邊收邊寫入暫存檔,不整個讀進記憶體(AGENT.md §8);超過上限截斷後由 file-service 回 413
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: { fileSize: config.maxFileBytes, files: config.maxFilesPerRequest, fields: 20, fieldSize: 1000, parts: 40 },
  });

  app.decorateRequest('identity', null);
  app.addHook('onRequest', async (req) => {
    if (!req.routeOptions.url || req.routeOptions.config.gatewayAuth === false) return;
    if (config.devSkipToken) {
      req.identity = DEV_IDENTITY;
      return;
    }
    const token = req.headers[INTERNAL_TOKEN_HEADER];
    if (typeof token !== 'string' || !token) throw new AppError(401, 'FILE_INTERNAL_TOKEN_INVALID', '缺少內部 Token');
    try {
      req.identity = await verify(token);
    } catch {
      // 只有 Token 驗證失敗才回 401;Gateway 收到會視為設定錯誤並告警(§5.3)
      throw new AppError(401, 'FILE_INTERNAL_TOKEN_INVALID', '內部 Token 無效');
    }
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.removeHeader('x-powered-by');
    // 所有回應都不讓瀏覽器猜測類型(SECURITY-CHECKLIST S11)
    reply.header('x-content-type-options', 'nosniff');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send(errorBody(err.code, err.message, req.id, err.details));
    if (err instanceof PathEscapeError) {
      // 資料庫中的 storage_key 異常:不讀取根目錄以外的檔案,記錄後回 500(file-safety.feature)
      req.log.error({ err }, 'storage_key 逃出檔案根目錄');
      return reply.status(500).send(errorBody('INTERNAL_ERROR', '系統發生錯誤', req.id));
    }
    const e = err as { validation?: { instancePath: string; message?: string }[]; statusCode?: number };
    if (e.validation)
      return reply.status(400).send(
        errorBody(
          'VALIDATION_FAILED',
          '參數驗證失敗',
          req.id,
          e.validation.map((v) => ({ field: v.instancePath.replace(/^\//, '') || '(body)', message: v.message ?? '' })),
        ),
      );
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send(errorBody('VALIDATION_FAILED', '請求格式錯誤', req.id));
    req.log.error({ err }, '非預期錯誤');
    return reply.status(500).send(errorBody('INTERNAL_ERROR', '系統發生錯誤', req.id));
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send(errorBody('FILE_API_NOT_FOUND', '找不到此 API', req.id)));

  const noAuth = { config: { gatewayAuth: false }, schema: { hide: true } };
  app.get('/healthz', noAuth, async () => ({ status: 'ok' }));
  app.get('/readyz', noAuth, async (_req, reply) => {
    if (!opts.readiness) return { status: 'ok' };
    const r = await opts.readiness();
    return reply.status(r.ok ? 200 : 503).send({ status: r.ok ? 'ok' : 'unavailable', checks: r.checks });
  });
  app.get('/openapi.json', noAuth, async () => app.swagger());

  await app.register(fileRoutes(service, actorOf, config.maxFileBytes, opts.backup ?? null));
  return app;
}
