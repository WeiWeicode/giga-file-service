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
 *   HOST_DISK_PATH        選用:Windows 主機磁碟上的任一目錄(唯讀掛載),容量以它為準(WSL 虛擬磁碟的大小不代表實際可用空間)
 *   BACKUP_ROOT           選用:NAS 備份根目錄(容器內 /data/backup,bind mount NAS giga-files/{env};STORAGE.md §2);未設定則不備份
 *   BACKUP_INTERVAL_MINUTES  備份補傳間隔(預設 5)
 *   BACKUP_MAX_ATTEMPTS   失敗幾次改為 failed 並告警(預設 5)
 *   BACKUP_ALERT_USERS    選用:備份失敗告警收件人工號(逗號分隔;經 Gateway /api/notify/send,需 GW_API_KEY 有 notify.message.send)
 *   BPM 附件(F6;選用,兩個來源各自設定,未設定任何來源則 /bpm/* 回 409):
 *     BPM_TEST_*          BPM 測試區(191);未設定時沿用不帶前綴的 BPM_*(最初的設定名稱)
 *     BPM_PROD_*          BPM 正式區(190)
 *     各來源:{前綴}DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD(_FILE)(NaNa 唯讀帳號 file_bpm_ro,db/dba/02-create-bpm-readonly.sql)、
 *            {前綴}FILE_URL(取檔服務 :5144)、{前綴}FILE_API_KEY(_FILE)(其 X-API-Key,只放 file-api)
 *     BPM_DEFAULT_ENV     未指定 ?env= 時的來源(test / prod;預設:GW_ENV=prod 用 prod,其他用 test,沒設定的就用另一個)
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
  /** 單檔上限(D3:30 MB) */
  maxFileBytes: number;
  /** 單一請求最多幾個檔案 */
  maxFilesPerRequest: number;
  /** null = 使用 file-types.ts 的暫定清單 */
  allowedExts: string[] | null;
  tempRetentionHours: number;
  devSkipToken: boolean;
  /** null = 只看檔案根目錄所在的檔案系統 */
  hostDiskPath: string | null;
  /** null = 不備份(dev 預設) */
  backup: { root: string; intervalMinutes: number; maxAttempts: number; alertUsers: string[] } | null;
  /** null = 未設定任何 BPM 附件來源(F6) */
  bpm: { sources: BpmSourceConfig[]; defaultEnv: BpmEnv } | null;
}

export type BpmEnv = 'test' | 'prod';

export interface BpmSourceConfig {
  env: BpmEnv;
  /** 顯示用:測試區 / 正式區 */
  label: string;
  sql: SqlConfig;
  fileUrl: string;
  apiKey: string;
}

const BPM_LABEL: Record<BpmEnv, string> = { test: '測試區', prod: '正式區' };

/** 讀一個 BPM 來源;{prefix}DB_HOST 沒設定回 null */
function bpmSource(env: NodeJS.ProcessEnv, code: BpmEnv, prefix: string, strictFile: boolean): BpmSourceConfig | null {
  const host = env[`${prefix}DB_HOST`];
  if (!host) return null;
  return {
    env: code,
    label: BPM_LABEL[code],
    sql: {
      server: host,
      port: Number(env[`${prefix}DB_PORT`] ?? 1433),
      database: env[`${prefix}DB_NAME`] || 'NaNa',
      user: required(`${prefix}DB_USER`, env[`${prefix}DB_USER`]),
      password: required(`${prefix}DB_PASSWORD(或 ${prefix}DB_PASSWORD_FILE)`, secret(env, `${prefix}DB_PASSWORD`, strictFile)),
    },
    fileUrl: required(`${prefix}FILE_URL`, env[`${prefix}FILE_URL`]),
    apiKey: required(`${prefix}FILE_API_KEY(或 ${prefix}FILE_API_KEY_FILE)`, secret(env, `${prefix}FILE_API_KEY`, strictFile)),
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** D3(2026-10-08 由 50 MB 改為 30 MB) */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

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

  const positive = (name: string, v: string | undefined, def: number) => {
    const n = Number(v ?? def);
    if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${name} 必須為正整數:${v}`);
    return n;
  };
  const backupRoot = env.BACKUP_ROOT || null;
  const backup = backupRoot
    ? {
        root: backupRoot,
        intervalMinutes: positive('BACKUP_INTERVAL_MINUTES', env.BACKUP_INTERVAL_MINUTES, 5),
        maxAttempts: positive('BACKUP_MAX_ATTEMPTS', env.BACKUP_MAX_ATTEMPTS, 5),
        alertUsers: (env.BACKUP_ALERT_USERS ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }
    : null;

  const bpmSources = [
    bpmSource(env, 'test', 'BPM_TEST_', !isDev) ?? bpmSource(env, 'test', 'BPM_', !isDev),
    bpmSource(env, 'prod', 'BPM_PROD_', !isDev),
  ].filter((x): x is BpmSourceConfig => x !== null);
  const wanted = env.BPM_DEFAULT_ENV || (gateway.gwEnv === 'prod' ? 'prod' : 'test');
  if (wanted !== 'test' && wanted !== 'prod') throw new ConfigError(`BPM_DEFAULT_ENV 必須為 test 或 prod:${wanted}`);
  const bpm = bpmSources.length ? { sources: bpmSources, defaultEnv: (bpmSources.find((x) => x.env === wanted) ?? bpmSources[0]!).env } : null;

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
    hostDiskPath: env.HOST_DISK_PATH || null,
    backup,
    bpm,
  };
}
