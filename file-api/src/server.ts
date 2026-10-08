/**
 * 啟動:連 SQL Server(schema file_svc)、準備檔案根目錄,開始服務後由 setupGateway 依部署區在背景自動註冊 API
 * (dev 不註冊,test / prod 寫入 Gateway 草稿)。暫存檔清除每小時執行一次(API.md §2);
 * 有設定 BACKUP_ROOT 時每 BACKUP_INTERVAL_MINUTES 分鐘補傳 NAS 備份(STORAGE.md §2)。
 */
import { access, constants } from 'node:fs/promises';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, openPool } from './db/client.js';
import { DrizzleFileRepo } from './modules/files/drizzle-repo.js';
import { BackupService } from './modules/backup/backup-service.js';
import { gatewayAlert } from './modules/backup/gateway-alert.js';
import { BpmService, BpmSources } from './modules/bpm/bpm-service.js';
import { BpmDocServer } from './modules/bpm/doc-server.js';
import { NanaBpmRepo } from './modules/bpm/nana-repo.js';
import { FileService } from './modules/files/file-service.js';
import { BackupStore } from './modules/storage/backup-store.js';
import { LocalStore } from './modules/storage/local-store.js';

const config = loadConfig();
const pool = await openPool(config.sql, { appName: 'giganexus-file-api' });
const store = new LocalStore(config.fileRoot, config.hostDiskPath);
await store.init();
const repo = new DrizzleFileRepo(createDb(pool, config.gateway.gwEnv !== 'prod'));
const nas = config.backup ? new BackupStore(config.backup.root) : null;
const service = new FileService({
  repo,
  store,
  nas,
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

const { gatewayUrl, apiKey, gwEnv } = config.gateway;
const backup =
  config.backup && nas
    ? new BackupService({
        repo,
        local: store,
        nas,
        maxAttempts: config.backup.maxAttempts,
        alert:
          config.backup.alertUsers.length > 0 && gatewayUrl && apiKey ? gatewayAlert({ gatewayUrl, apiKey, users: config.backup.alertUsers, gwEnv }) : null,
      })
    : null;

// BPM 附件(F6):測試區 191 / 正式區 190 各一組;NaNa 連線延遲到第一次查詢,連不上不影響啟動
const bpmRepos = (config.bpm?.sources ?? []).map((src) => ({ src, repo: new NanaBpmRepo(src.sql) }));
const bpm = config.bpm
  ? new BpmSources(
      bpmRepos.map(
        ({ src, repo: nana }) =>
          new BpmService({
            repo: nana,
            docs: new BpmDocServer({ baseUrl: src.fileUrl, apiKey: src.apiKey }),
            log: (entry) => repo.log(entry),
            env: src.env,
            label: src.label,
            source: src.sql.server,
          }),
      ),
      config.bpm.defaultEnv,
    )
  : null;

const app = await buildApp({
  config,
  service,
  backup,
  bpm,
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

let backupTimer: NodeJS.Timeout | undefined;
if (backup && config.backup) {
  // 同一原因只記一次警告(NAS 長時間未掛載時不洗版),恢復後記錄
  let lastSkip: string | null = null;
  const runBackup = () =>
    backup
      .runOnce()
      .then((r) => {
        if (r.skipped) {
          if (r.skipped !== lastSkip) app.log.warn({ reason: r.skipped }, 'NAS 備份本輪跳過');
          lastSkip = r.skipped;
          return;
        }
        if (lastSkip) app.log.info('NAS 已恢復,繼續備份');
        lastSkip = null;
        if (r.done || r.retrying || r.failed.length) app.log.info({ done: r.done, retrying: r.retrying, failed: r.failed.length }, 'NAS 備份');
        for (const f of r.failed) app.log.error({ fileUuid: f.file.fileUuid, attempts: f.attempts, error: f.error }, 'NAS 備份失敗,已標記 failed');
      })
      .catch((err: unknown) => app.log.error({ err }, 'NAS 備份執行失敗'));
  backupTimer = setInterval(runBackup, config.backup.intervalMinutes * 60_000);
  backupTimer.unref();
  void runBackup();
} else app.log.warn('未設定 BACKUP_ROOT,不備份到 NAS');

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    clearInterval(cleanup);
    clearInterval(backupTimer);
    // close 會一併送出監控緩衝(最多等 3 秒)
    void app
      .close()
      .then(() => Promise.all([pool.close(), ...bpmRepos.map((b) => b.repo.close())]))
      .then(() => process.exit(0));
  });
