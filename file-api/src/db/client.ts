/**
 * 連線池與 Drizzle(DATABASE.md §0.1):giganexus_gw[_test] 的 schema file_svc,一個長期連線池。
 * tedious 參數比照 Gateway bff/src/db/client.ts(內網 SQL Server 2012 不加密,已有決議)。
 */
import sql from 'mssql';
import { drizzle, type NodeMsSqlDatabase } from 'drizzle-orm/node-mssql';
import type { Logger as DrizzleLogger } from 'drizzle-orm/logger';
import type { SqlConfig } from '../config.js';
import * as schema from './schema.js';
import { findSql2012Violations, Sql2012CompatError } from './sql2012-guard.js';

export type FileDatabase = NodeMsSqlDatabase<typeof schema>;

export async function openPool(cfg: SqlConfig, opts: { appName: string; poolMax?: number; requestTimeoutMs?: number }): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeout: 15_000,
    requestTimeout: opts.requestTimeoutMs ?? 30_000,
    pool: { min: 0, max: opts.poolMax ?? 10, idleTimeoutMillis: 30_000 },
    options: { encrypt: false, trustServerCertificate: true, appName: opts.appName, useUTC: true, enableArithAbort: true },
  });
  await pool.connect();
  return pool;
}

/** 開發 / 測試:檢查 Drizzle 產生的每一句 SQL 是否含 2012 不支援的語法(比照 Gateway) */
class Sql2012GuardLogger implements DrizzleLogger {
  logQuery(query: string): void {
    const violations = findSql2012Violations(query);
    if (violations.length) throw new Sql2012CompatError(violations, query);
  }
}

export function createDb(pool: sql.ConnectionPool, guard = false): FileDatabase {
  return drizzle({ client: pool, schema, ...(guard ? { logger: new Sql2012GuardLogger() } : {}) });
}
