/**
 * 測試共用:記憶體版 FileRepo(單元測試;SQL Server 版由 test/int 驗證)、測試用 JWKS 與 Token、multipart 請求、暫存檔案根目錄。
 * 一律使用假檔案與暫存目錄(AGENT.md §9),不碰 166 / NAS / 正式資料。
 */
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { FileService } from '../src/modules/files/file-service.js';
import {
  inScope,
  type AccessLog,
  type FileRecord,
  type FileRepo,
  type ListFilter,
  type NewFile,
  type Scope,
  type StorageStats,
} from '../src/modules/files/types.js';
import { BackupService, type BackupAlert } from '../src/modules/backup/backup-service.js';
import { BpmService } from '../src/modules/bpm/bpm-service.js';
import { BpmDocServer } from '../src/modules/bpm/doc-server.js';
import type { BpmRepo } from '../src/modules/bpm/types.js';
import { BackupStore, MARKER } from '../src/modules/storage/backup-store.js';
import { LocalStore } from '../src/modules/storage/local-store.js';

export class MemoryFileRepo implements FileRepo {
  readonly files: FileRecord[] = [];
  readonly logs: AccessLog[] = [];

  async insertMany(files: NewFile[], logs: AccessLog[]): Promise<void> {
    for (const f of files) this.files.push({ ...f, deletedAt: null, deletedBy: null, backupStatus: 'pending', backupAt: null });
    this.logs.push(...logs);
  }
  async findActive(fileUuid: string): Promise<FileRecord | null> {
    return this.files.find((f) => f.fileUuid === fileUuid && !f.deletedAt) ?? null;
  }
  async list(filter: ListFilter, scope: Scope) {
    const rows = this.files
      .filter((f) => !f.deletedAt && inScope(f, scope))
      .filter((f) => !filter.sourceSystem || f.sourceSystem === filter.sourceSystem)
      .filter((f) => !filter.refType || f.refType === filter.refType)
      .filter((f) => !filter.refNo || f.refNo === filter.refNo)
      .filter((f) => !filter.uploadedBy || f.uploadedBy === filter.uploadedBy)
      .filter((f) => !filter.createdFrom || f.createdAt >= filter.createdFrom)
      .filter((f) => !filter.createdTo || f.createdAt <= filter.createdTo)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: rows.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize), total: rows.length };
  }
  async bind(fileUuids: string[], refType: string | null, refNo: string, at: Date, log: Omit<AccessLog, 'fileUuid'>): Promise<number> {
    let n = 0;
    for (const f of this.files)
      if (fileUuids.includes(f.fileUuid) && !f.deletedAt) {
        Object.assign(f, { refType, refNo, boundAt: at });
        this.logs.push({ ...log, fileUuid: f.fileUuid });
        n++;
      }
    return n;
  }
  async softDelete(fileUuid: string, by: string, at: Date, log: AccessLog | null): Promise<boolean> {
    const f = this.files.find((x) => x.fileUuid === fileUuid && !x.deletedAt);
    if (!f) return false;
    Object.assign(f, { deletedAt: at, deletedBy: by });
    if (log) this.logs.push(log);
    return true;
  }
  async log(entry: AccessLog): Promise<void> {
    this.logs.push(entry);
  }
  async expiredTemps(before: Date, limit: number): Promise<FileRecord[]> {
    return this.files.filter((f) => !f.refNo && !f.deletedAt && f.createdAt < before).slice(0, limit);
  }
  readonly attempts = new Map<string, number>();
  async pendingBackups(limit: number): Promise<FileRecord[]> {
    return this.files.filter((f) => f.backupStatus === 'pending' && !f.deletedAt).slice(0, limit);
  }
  async markBackupDone(fileUuid: string, at: Date): Promise<void> {
    const f = this.files.find((x) => x.fileUuid === fileUuid);
    if (f) Object.assign(f, { backupStatus: 'done', backupAt: at });
  }
  async markBackupAttempt(fileUuid: string, maxAttempts: number) {
    const f = this.files.find((x) => x.fileUuid === fileUuid);
    if (!f) throw new Error(`找不到檔案:${fileUuid}`);
    const attempts = (this.attempts.get(fileUuid) ?? 0) + 1;
    this.attempts.set(fileUuid, attempts);
    f.backupStatus = attempts >= maxAttempts ? 'failed' : 'pending';
    return { status: f.backupStatus, attempts };
  }
  async retryBackups(fileUuids: string[] | null): Promise<number> {
    let n = 0;
    for (const f of this.files)
      if (f.backupStatus === 'failed' && !f.deletedAt && (!fileUuids || fileUuids.includes(f.fileUuid))) {
        f.backupStatus = 'pending';
        this.attempts.set(f.fileUuid, 0);
        n++;
      }
    return n;
  }
  async backedUp(afterId: number, limit: number) {
    return this.files
      .map((f, i) => ({ ...f, id: i + 1 }))
      .filter((f) => f.id > afterId && f.backupStatus === 'done' && !f.deletedAt)
      .slice(0, limit);
  }
  async stats(): Promise<StorageStats> {
    const active = this.files.filter((f) => !f.deletedAt);
    const backup = { pending: 0, done: 0, failed: 0 };
    for (const f of active) backup[f.backupStatus]++;
    return {
      files: active.length,
      bytes: active.reduce((s, f) => s + f.sizeBytes, 0),
      temp: active.filter((f) => !f.refNo).length,
      backup,
      failedItems: active
        .filter((f) => f.backupStatus === 'failed')
        .map((f) => ({ fileUuid: f.fileUuid, originalName: f.originalName, createdAt: f.createdAt })),
    };
  }
}

export interface Jwks {
  url: string;
  close: () => void;
  sign: (claims: Record<string, unknown>, aud?: string) => Promise<string>;
}

export async function startJwks(): Promise<Jwks> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };
  const server = http.createServer((_req, res) => res.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [jwk] })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/jwks.json`,
    close: () => server.close(),
    sign: (claims, aud = 'file-api') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'test' })
        .setIssuer('giganexus-bff')
        .setAudience(aud)
        .setExpirationTime('60s')
        .sign(privateKey),
  };
}

/** 測試設定:dev、不連資料庫(repo 由測試注入);env 可覆寫 */
export function testConfig(jwksUrl: string, fileRoot: string, env: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({
    GW_ENV: 'dev',
    SERVICE_CODE: 'file-api',
    GW_JWKS_URL: jwksUrl,
    LOG_LEVEL: 'silent',
    FILE_ROOT: fileRoot,
    FILE_DB_HOST: 'unused',
    FILE_DB_NAME: 'unused',
    FILE_DB_USER: 'unused',
    FILE_DB_PASSWORD: 'unused',
    ...env,
  });
}

export interface TestApp {
  app: FastifyInstance;
  repo: FileRepo;
  service: FileService;
  root: string;
  clock: { now: Date };
  store: LocalStore;
  /** 有 opts.backup 時才有 */
  backup: { service: BackupService; nas: BackupStore; root: string; alerts: Parameters<BackupAlert>[0][] } | null;
}

export interface TestBackupOptions {
  maxAttempts?: number;
  /** false:不建立標記檔(模擬 NAS 未掛載) */
  marker?: boolean;
}

/** BPM 附件:repo 由測試提供,5144 指向測試用 HTTP 伺服器 */
export interface TestBpmOptions {
  repo: BpmRepo;
  fileUrl: string;
  apiKey: string;
}

export async function buildTestApp(
  jwks: Jwks,
  opts: { repo?: FileRepo; config?: Partial<Config>; backup?: TestBackupOptions; bpm?: TestBpmOptions } = {},
): Promise<TestApp> {
  const root = mkdtempSync(path.join(tmpdir(), 'file-api-'));
  const config = { ...testConfig(jwks.url, root), ...opts.config };
  const store = new LocalStore(root);
  await store.init();
  const clock = { now: new Date() };
  const repo = opts.repo ?? new MemoryFileRepo();
  let backup: TestApp['backup'] = null;
  if (opts.backup) {
    const nasRoot = mkdtempSync(path.join(tmpdir(), 'file-nas-'));
    if (opts.backup.marker !== false) writeFileSync(path.join(nasRoot, MARKER), '');
    const nas = new BackupStore(nasRoot);
    const alerts: Parameters<BackupAlert>[0][] = [];
    const service = new BackupService({
      repo,
      local: store,
      nas,
      maxAttempts: opts.backup.maxAttempts ?? 3,
      alert: async (f) => void alerts.push(f),
      now: () => clock.now,
    });
    backup = { service, nas, root: nasRoot, alerts };
  }
  const service = new FileService({ repo, store, nas: backup?.nas ?? null, tempRetentionHours: config.tempRetentionHours, now: () => clock.now });
  const bpm = opts.bpm
    ? new BpmService({
        repo: opts.bpm.repo,
        docs: new BpmDocServer({ baseUrl: opts.bpm.fileUrl, apiKey: opts.bpm.apiKey, timeoutMs: 2000 }),
        log: (e) => repo.log(e),
        source: '10.10.130.191',
      })
    : null;
  const app = await buildApp({ config, service, backup: backup?.service ?? null, bpm });
  return { app, repo, service, root, clock, store, backup };
}

/** 使用者身分(碩禾,擁有權限由 Gateway 檢查,file-api 只看身分與資料範圍) */
export const user = (emp: string, cos: string[] = ['碩禾']) => ({ sub: emp, emp, name: emp, dept: 'S1800', cos, amr: 'ad', roles: ['employee'] });
export const system = (code: string) => ({ sub: `client:${code}`, emp: `client:${code}`, amr: 'api_key', roles: [] });

export interface Part {
  name: string;
  content: Buffer | string;
}

/** multipart/form-data 請求內容(以 Fetch API 的 FormData 產生 boundary 與編碼) */
export async function multipart(files: Part[], fields: Record<string, string> = {}): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('file', new Blob([typeof f.content === 'string' ? Buffer.from(f.content) : f.content]), f.name);
  const res = new Response(fd);
  return { payload: Buffer.from(await res.arrayBuffer()), headers: { 'content-type': res.headers.get('content-type')! } };
}

/** 檔案根目錄內除了 tmp/ 以外的所有檔案(相對路徑),以及 tmp/ 內的檔案數 */
export function listStored(root: string): { stored: string[]; tmp: number } {
  const stored: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else stored.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  for (const name of readdirSync(root)) if (name !== 'tmp') walk(path.join(root, name));
  return { stored, tmp: readdirSync(path.join(root, 'tmp')).length };
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
export const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 2)]);
export const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);
export const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
