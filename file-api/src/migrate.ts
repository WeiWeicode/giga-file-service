/**
 * 套用 db/migrations(Drizzle migrator;DATABASE.md §0.2):
 *   - 紀錄表 file_svc.__file_migrations(不可用 Gateway 的 drizzle schema,Gateway reset-test-db 會清掉)
 *   - 以本服務的 migrate 帳號(FILE_MIGRATE_USER / FILE_MIGRATE_PASSWORD[_FILE])執行,只有 schema file_svc 的權限
 *   開發:於 file-api/ 執行 npm run db:migrate(讀 .env);容器內(WORKDIR /app):node dist/src/migrate.js;migrations 目錄以 cwd 為準;整合測試以 database 參數指定 poc_test 庫
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-mssql/migrator';
import { required, secret, type SqlConfig } from './config.js';
import { createDb, openPool } from './db/client.js';

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'db/migrations');
export const MIGRATIONS_SCHEMA = 'file_svc';
export const MIGRATIONS_TABLE = '__file_migrations';

export function migrateSqlConfig(env: NodeJS.ProcessEnv = process.env, database?: string): SqlConfig {
  return {
    server: required('FILE_DB_HOST', env.FILE_DB_HOST),
    port: Number(env.FILE_DB_PORT ?? 1433),
    database: database ?? required('FILE_DB_NAME', env.FILE_DB_NAME),
    user: required('FILE_MIGRATE_USER', env.FILE_MIGRATE_USER),
    password: required('FILE_MIGRATE_PASSWORD(或 FILE_MIGRATE_PASSWORD_FILE)', secret(env, 'FILE_MIGRATE_PASSWORD', false)),
  };
}

export async function runMigrations(cfg: SqlConfig, migrationsFolder = process.env.MIGRATIONS_FOLDER ?? MIGRATIONS_FOLDER): Promise<void> {
  const pool = await openPool(cfg, { appName: 'giganexus-file-migrate', poolMax: 1, requestTimeoutMs: 300_000 });
  try {
    await migrate(createDb(pool), { migrationsFolder, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE });
  } finally {
    await pool.close();
  }
}

// 以 pathToFileURL 比對:Windows 的 argv[1] 為 D:\...,直接接 file:// 永遠不相等(同 Gateway)
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const cfg = migrateSqlConfig();
  runMigrations(cfg)
    .then(() => console.log(`${cfg.database}:migration 完成(schema ${MIGRATIONS_SCHEMA})`))
    .catch((err: unknown) => {
      console.error('migration 失敗', err);
      process.exit(1);
    });
}
