/**
 * 設定(AGENT.md §6、DEPLOYMENT.md §1):Gateway 相關(GW_ENV、SERVICE_CODE=file-api、GW_BASE_URL、API Key…)由 SDK loadGatewayEnv 讀取,
 * 本檔補上服務自己的設定。缺少必要設定時啟動失敗,不加預設值繞過檢查。
 *
 *   PORT                  file-api(51272,BACKEND-GUIDE §3.3)
 *   HOST                  dev 預設 127.0.0.1(DEV_SKIP_TOKEN 開著時不可讓同網段的電腦連入),test / prod 預設 0.0.0.0(容器)
 *   FILE_ROOT             檔案根目錄(test / prod 為容器內 /data/files,bind mount WSL /srv/giga-files/{env};STORAGE.md §1)
 *   FILE_DB_*             SQL Server(giganexus_gw[_test] 的 schema file_svc;DATABASE.md §0);密碼 test / prod 只接受 FILE_DB_PASSWORD_FILE
 *   FILE_ALLOWED_EXTS     允許的副檔名(逗號分隔);未設定用 file-types.ts 的暫定清單(PRD §11 #6 待定)
 *   TEMP_RETENTION_HOURS  未綁定暫存檔保留時數(預設 24,API.md §2)
 *   DEV_SKIP_TOKEN        dev 專用:不驗證 X-Internal-Token(本機直連);非 dev 設定即啟動失敗
 */
import { readFileSync } from 'node:fs';
import { isGatewayPort, loadGatewayEnv, loadMonitorEnv, type GatewayEnv, type MonitorEnv } from '@giganexus/backend-sdk';

export interface SqlConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface Config {
  gateway: GatewayEnv;
  monitor: MonitorEnv;
  host: string;
  port: number;
  logLevel: string;
  fileRoot: string;
  sql: SqlConfig;
  /** 單檔上限(D3:50 MB) */
  maxFileBytes: number;
  /** 單一請求最多幾個檔案 */
  maxFilesPerRequest: number;
  /** null = 使用 file-types.ts 的暫定清單 */
  allowedExts: string[] | null;
  tempRetentionHours: number;
  devSkipToken: boolean;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** 讀 NAME 或 NAME_FILE(Docker secret);strictFile:test / prod 只接受 _FILE(AGENT.md §6) */
export function secret(env: NodeJS.ProcessEnv, name: string, strictFile: boolean): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch (err) {
      throw new ConfigError(`無法讀取 ${name}_FILE:${(err as Error).message}`);
    }
  }
  if (env[name] && strictFile) throw new ConfigError(`${name} 在 test / prod 只接受 ${name}_FILE(Docker secret)`);
  return env[name] || undefined;
}

export function required<T>(name: string, v: T | undefined | null | ''): T {
  if (v === undefined || v === null || v === '') throw new ConfigError(`${name} 未設定`);
  return v;
}

const flag = (v: string | undefined) => v === '1' || v === 'true';

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd?: string): Config {
  const gateway = loadGatewayEnv(env, cwd);
  const isDev = gateway.gwEnv === 'dev';
  if (!isDev && env.DEV_SKIP_TOKEN !== undefined) throw new ConfigError(`DEV_SKIP_TOKEN 只能在 GW_ENV=dev 使用,${gateway.gwEnv} 不可設定`);

  const port = Number(env.PORT ?? 51272);
  if (!isGatewayPort(port)) throw new ConfigError(`PORT 必須在 51200–51300(BACKEND-GUIDE.md §3):${env.PORT}`);

  const exts = env.FILE_ALLOWED_EXTS?.split(',')
    .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);

  const retention = Number(env.TEMP_RETENTION_HOURS ?? 24);
  if (!Number.isFinite(retention) || retention <= 0) throw new ConfigError(`TEMP_RETENTION_HOURS 必須為正數:${env.TEMP_RETENTION_HOURS}`);

  return {
    gateway,
    monitor: loadMonitorEnv(gateway.gwEnv, env),
    host: env.HOST ?? (isDev ? '127.0.0.1' : '0.0.0.0'),
    port,
    logLevel: env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    fileRoot: required('FILE_ROOT', env.FILE_ROOT),
    sql: {
      server: required('FILE_DB_HOST', env.FILE_DB_HOST),
      port: Number(env.FILE_DB_PORT ?? 1433),
      database: required('FILE_DB_NAME', env.FILE_DB_NAME),
      user: required('FILE_DB_USER', env.FILE_DB_USER),
      password: required('FILE_DB_PASSWORD(或 FILE_DB_PASSWORD_FILE)', secret(env, 'FILE_DB_PASSWORD', !isDev)),
    },
    maxFileBytes: MAX_FILE_BYTES,
    maxFilesPerRequest: 10,
    allowedExts: exts && exts.length > 0 ? exts : null,
    tempRetentionHours: retention,
    devSkipToken: isDev && flag(env.DEV_SKIP_TOKEN),
  };
}
