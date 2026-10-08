/**
 * 啟動:連 SQL Server(schema file_svc)、準備檔案根目錄,開始服務後由 setupGateway 依部署區在背景自動註冊 API
 * (dev 不註冊,test / prod 寫入 Gateway 草稿)。暫存檔清除每小時執行一次(API.md §2)。
 */
import { access, constants } from 'node:fs/promises';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, openPool } from './db/client.js';
import { DrizzleFileRepo } from './modules/files/drizzle-repo.js';
import { FileService } from './modules/files/file-service.js';
import { LocalStore } from './modules/storage/local-store.js';

const config = loadConfig();
const pool = await openPool(config.sql, { appName: 'giganexus-file-api' });
const store = new LocalStore(config.fileRoot);
await store.init();
const service = new FileService({
  repo: new DrizzleFileRepo(createDb(pool, config.gateway.gwEnv !== 'prod')),
  store,
  allowedExts: config.allowedExts,
  tempRetentionHours: config.tempRetentionHours,
});

/** 就緒與監控心跳共用:SQL Server、檔案根目錄可寫 */
async function checks(): Promise<{ name: string; ok: boolean; latencyMs: number | null; message?: string }[]> {
  const probe = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = performance.now();
    try {
      await fn();
      return { name, ok: true, latencyMs: Math.round(performance.now() - t0) };
    } catch (err) {
      return { name, ok: false, latencyMs: null, message: (err as Error).message };
    }
  };
  return Promise.all([probe('sql', () => pool.request().query('SELECT 1')), probe('storage', () => access(store.root, constants.W_OK))]);
}

const app = await buildApp({
  config,
  service,
  readiness: async () => {
    const c = await checks();
    return { ok: c.every((x) => x.ok), checks: Object.fromEntries(c.map((x) => [x.name, x.ok ? 'ok' : `error: ${x.message}`])) };
  },
  deps: async () => (await checks()).map(({ name, ok, latencyMs }) => ({ name, ok, latencyMs })),
});
await app.listen({ host: config.host, port: config.port });
app.log.info({ gwEnv: config.gateway.gwEnv, serviceCode: config.gateway.serviceCode, fileRoot: store.root, monitor: config.monitor.enabled }, '服務已啟動');

const cleanup = setInterval(() => {
  service
    .cleanupTemps()
    .then((n) => n && app.log.info({ removed: n }, '已清除逾期暫存檔'))
    .catch((err: unknown) => app.log.error({ err }, '暫存檔清除失敗'));
}, 3600_000);
cleanup.unref();

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    clearInterval(cleanup);
    // close 會一併送出監控緩衝(最多等 3 秒)
    void app
      .close()
      .then(() => pool.close())
      .then(() => process.exit(0));
  });
