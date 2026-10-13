/**
 * filebackend / SMBbackend 舊檔匯入(F4;LEGACY-SWITCH-PLAN.md §3 A1):npm run legacy:import -- --source fb|smb [--apply] [--no-hash] [--out data/legacy-import]
 *   - 預設乾跑:只讀 WebAppDb 與 NAS,產生對照報表(JSON),不寫入任何東西;確認報表後加 --apply
 *   - --apply 寫入本服務的 FILE_ROOT 與 schema file_svc(設定同服務:FILE_ROOT、FILE_DB_*);可重跑,已匯入的舊 id 跳過
 *   - 來源一律唯讀:WebAppDb 用 file_legacy_ro(WEBAPPDB_*,config.ts loadWebAppDbConfig);NAS 根目錄 LEGACY_NAS_ROOT
 *     (開發機預設 \\10.10.130.31\docker-folder;測試區 /data/legacy,只掛在一次性服務 legacy-import)
 *   - 測試區:docker compose --env-file … -f file-api/deploy/docker-compose.yml --profile legacy-import run --rm legacy-import --source fb [--apply]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, loadWebAppDbConfig } from '../config.js';
import { createDb, openPool } from '../db/client.js';
import { DrizzleCompatRepo } from '../modules/compat/drizzle-repo.js';
import { FB_SPEC_DIRS, runImport, summarize, type ImportSourceSpec } from '../modules/legacy/legacy-import.js';
import { ReadonlySource, withSep } from '../modules/legacy/readonly-source.js';
import { WebAppDbSource } from '../modules/legacy/webappdb.js';
import { LocalStore } from '../modules/storage/local-store.js';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'no-hash': { type: 'boolean', default: false },
    out: { type: 'string', default: 'data/legacy-import' },
  },
});
if (values.source !== 'fb' && values.source !== 'smb') throw new Error('用法:npm run legacy:import -- --source fb|smb [--apply]');

const nasRoot = process.env.LEGACY_NAS_ROOT ?? '\\\\10.10.130.31\\docker-folder';
const spec: ImportSourceSpec =
  values.source === 'fb'
    ? { ns: 'fb', legacySource: 'filebackend', table: 'webFileUpload', nas: new ReadonlySource('filebackend', nasRoot), scanDirs: FB_SPEC_DIRS }
    : { ns: 'smb', legacySource: 'smbbackend', table: 'smbFileUpload', nas: new ReadonlySource('smbbackend', path.join(nasRoot, 'CP')), scanDirs: [''] };

const outDir = path.resolve(values.out);
if (withSep(outDir).toLowerCase().startsWith(withSep(spec.nas.root).toLowerCase())) throw new Error(`輸出目錄不可位於來源之下:${outDir}`);

const config = loadConfig();
const legacy = await WebAppDbSource.open(loadWebAppDbConfig());
const pool = await openPool(config.sql, { appName: 'giganexus-file-legacy-import', poolMax: 2 });
try {
  const rows = await legacy.rows(spec.table);
  const store = new LocalStore(config.fileRoot);
  await store.init();
  const report = await runImport({
    spec,
    rows,
    repo: new DrizzleCompatRepo(createDb(pool, config.gateway.gwEnv !== 'prod')),
    store,
    apply: values.apply,
    hash: !values['no-hash'],
  });

  // 需要人看的列:斷鏈、擋下、路徑異常、失敗
  for (const i of report.items.filter((x) => ['missing', 'blocked', 'bad-path', 'duplicate-path', 'unreadable'].includes(x.status) || x.result === 'error'))
    console.log(
      `${(i.result ?? i.status).padEnd(9)} id=${i.legacyId} ${i.rel ?? '(無路徑)'} ${i.originalName} 單號=${i.sourceNumber ?? ''}${i.error ? ` ${i.error}` : ''}`,
    );
  for (const o of report.orphans) console.log(`orphan    ${o.rel} ${o.size}`);
  console.error(summarize(report));

  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${spec.legacySource}-${report.apply ? 'apply' : 'dryrun'}-${report.startedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  console.error(`報表:${file}`);
  if (report.items.some((i) => i.result === 'error') || report.errors.length) process.exitCode = 1;
} finally {
  await pool.close();
  await legacy.close();
}
