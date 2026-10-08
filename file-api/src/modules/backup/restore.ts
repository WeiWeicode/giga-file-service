/**
 * 還原(STORAGE.md §2):依資料庫紀錄(backup_status = done、未刪除)找出本機遺失或內容不符的實體檔,從 NAS 拉回。
 *   - 預設乾跑,只列出;apply 才寫入本機
 *   - NAS 上的檔案先驗證 SHA-256 與資料庫相符才寫入,寫入走 LocalStore 的暫存 → rename(不覆蓋到一半的檔)
 *   - 本機內容不符的檔案不直接覆蓋:先改名為 {key}.corrupt-{時間} 保留,再還原
 */
import { rename } from 'node:fs/promises';
import type { FileRecord, FileRepo } from '../files/types.js';
import { sha256Of, type BackupStore } from '../storage/backup-store.js';
import type { LocalStore } from '../storage/local-store.js';

export type RestoreState = 'ok' | 'missing' | 'mismatch';

export interface RestoreItem {
  fileUuid: string;
  storageKey: string;
  state: Exclude<RestoreState, 'ok'>;
  /** restored:已還原;nas-missing / nas-mismatch:NAS 也沒有可用的檔案;dry-run:乾跑未寫入 */
  result: 'restored' | 'nas-missing' | 'nas-mismatch' | 'dry-run' | 'error';
  error?: string;
}

export interface RestoreSummary {
  checked: number;
  items: RestoreItem[];
}

export interface RestoreOptions {
  repo: FileRepo;
  local: LocalStore;
  nas: BackupStore;
  apply: boolean;
  /** 只處理指定檔案;未指定時掃描全部已備份檔案 */
  fileUuids?: string[];
  batchSize?: number;
}

async function localState(local: LocalStore, f: FileRecord): Promise<RestoreState> {
  if (!(await local.exists(f.storageKey))) return 'missing';
  return (await sha256Of(local.openRead(f.storageKey))) === f.sha256 ? 'ok' : 'mismatch';
}

export async function restore(opts: RestoreOptions): Promise<RestoreSummary> {
  const { repo, local, nas } = opts;
  const reason = await nas.unavailableReason();
  if (reason) throw new Error(reason);

  const summary: RestoreSummary = { checked: 0, items: [] };
  const handle = async (f: FileRecord) => {
    summary.checked++;
    const state = await localState(local, f);
    if (state === 'ok') return;
    const item: RestoreItem = { fileUuid: f.fileUuid, storageKey: f.storageKey, state, result: 'dry-run' };
    summary.items.push(item);
    try {
      const nasSha = await nas.hashOf(nas.resolveKey(f.storageKey));
      if (nasSha === null) return void (item.result = 'nas-missing');
      if (nasSha !== f.sha256) return void (item.result = 'nas-mismatch');
      if (!opts.apply) return;
      const temp = await local.writeTemp(nas.openRead(f.storageKey), Number.MAX_SAFE_INTEGER);
      if (temp.sha256 !== f.sha256) {
        await local.discard(temp.tmpPath);
        throw new Error('從 NAS 讀回的內容 SHA-256 不符');
      }
      if (state === 'mismatch') {
        const full = local.resolveKey(f.storageKey);
        await rename(full, `${full}.corrupt-${Date.now()}`);
      }
      await local.commit(temp.tmpPath, f.storageKey);
      item.result = 'restored';
    } catch (err) {
      item.result = 'error';
      item.error = (err as Error).message;
    }
  };

  if (opts.fileUuids) {
    for (const u of opts.fileUuids) {
      const f = await repo.findActive(u.toLowerCase());
      if (!f) throw new Error(`找不到檔案:${u}`);
      if (f.backupStatus !== 'done') throw new Error(`檔案尚未備份到 NAS(${f.backupStatus}):${u}`);
      await handle(f);
    }
    return summary;
  }
  for (let after = 0; ;) {
    const batch = await repo.backedUp(after, opts.batchSize ?? 500);
    if (batch.length === 0) break;
    for (const f of batch) await handle(f);
    after = batch.at(-1)!.id;
  }
  return summary;
}
