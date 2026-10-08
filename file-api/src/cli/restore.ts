/**
 * 從 NAS 還原遺失的實體檔(STORAGE.md §2):npm run restore -- [--uuid <uuid>[,<uuid>…]] [--apply]
 *   - 預設乾跑:只列出本機遺失 / 內容不符、且 NAS 上有正確備份的檔案;加 --apply 才寫入本機
 *   - 只處理 backup_status = done 的檔案;NAS 檔案 SHA-256 與資料庫相符才寫入
 *   - 設定與服務相同(FILE_ROOT、BACKUP_ROOT、FILE_DB_*);測試區在容器內執行:
 *       docker compose … exec file-api node dist/src/cli/restore.js [--apply]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createDb, openPool } from '../db/client.js';
import { restore } from '../modules/backup/restore.js';
import { DrizzleFileRepo } from '../modules/files/drizzle-repo.js';
import { BackupStore } from '../modules/storage/backup-store.js';
import { LocalStore } from '../modules/storage/local-store.js';

const { values } = parseArgs({ options: { uuid: { type: 'string' }, apply: { type: 'boolean', default: false } } });

const config = loadConfig();
if (!config.backup) throw new Error('BACKUP_ROOT 未設定,無法還原');
const pool = await openPool(config.sql, { appName: 'giganexus-file-restore', poolMax: 2 });
try {
  const local = new LocalStore(config.fileRoot);
  await local.init();
  const summary = await restore({
    repo: new DrizzleFileRepo(createDb(pool, config.gateway.gwEnv !== 'prod')),
    local,
    nas: new BackupStore(config.backup.root),
    apply: values.apply,
    fileUuids: values.uuid?.split(',').map((s) => s.trim()),
  });
  for (const i of summary.items) console.log(`${i.result.padEnd(12)} ${i.state.padEnd(8)} ${i.fileUuid} ${i.storageKey}${i.error ? ` ${i.error}` : ''}`);
  const by = (r: string) => summary.items.filter((i) => i.result === r).length;
  console.error(
    `檢查 ${summary.checked} 個檔案,需還原 ${summary.items.length}:` +
      (values.apply ? `已還原 ${by('restored')}` : `可還原 ${by('dry-run')}(乾跑,加 --apply 寫入)`) +
      `,NAS 無檔 ${by('nas-missing')},NAS 不符 ${by('nas-mismatch')},錯誤 ${by('error')}`,
  );
  if (by('error') || by('nas-missing') || by('nas-mismatch')) process.exitCode = 1;
} finally {
  await pool.close();
}
