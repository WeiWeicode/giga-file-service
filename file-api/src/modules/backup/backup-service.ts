/**
 * NAS 備份補傳(STORAGE.md §2;F2)。排程每 N 分鐘執行 runOnce:
 *   - NAS 不可用(未掛載 / 無標記檔)時整輪跳過,不累計失敗次數;上傳不受影響,恢復後自動補
 *   - 逐筆複製並驗證 SHA-256;本機實體檔的 SHA 先與資料庫比對,不符不備份(避免把壞檔覆蓋到 NAS)
 *   - 失敗累計 backup_attempts,達門檻改為 failed 並告警;failed 由「重試」API 改回 pending
 * 結果一律反映在 backup_status,不可回報成功(AGENT.md §5)。
 */
import type { FileRecord, FileRepo } from '../files/types.js';
import type { BackupStore } from '../storage/backup-store.js';
import { sha256Of } from '../storage/backup-store.js';
import type { LocalStore } from '../storage/local-store.js';

export interface BackupFailure {
  file: FileRecord;
  attempts: number;
  error: string;
}

/** 告警:達失敗門檻的檔案(一輪合併送出一次) */
export type BackupAlert = (failures: BackupFailure[]) => Promise<void>;

export interface BackupRunResult {
  /** NAS 不可用時的原因(整輪跳過) */
  skipped: string | null;
  done: number;
  retrying: number;
  failed: BackupFailure[];
}

export interface BackupServiceOptions {
  repo: FileRepo;
  local: LocalStore;
  nas: BackupStore;
  maxAttempts: number;
  batchSize?: number;
  alert?: BackupAlert | null;
  now?: () => Date;
}

export class BackupService {
  private running = false;

  constructor(private readonly opts: BackupServiceOptions) {}

  async runOnce(): Promise<BackupRunResult> {
    const result: BackupRunResult = { skipped: null, done: 0, retrying: 0, failed: [] };
    // 上一輪還沒跑完(大量補傳)時不重疊執行
    if (this.running) return { ...result, skipped: '上一輪尚未完成' };
    this.running = true;
    try {
      const { repo, local, nas, maxAttempts } = this.opts;
      const reason = await nas.unavailableReason();
      if (reason) return { ...result, skipped: reason };

      for (const f of await repo.pendingBackups(this.opts.batchSize ?? 200)) {
        try {
          if (!(await local.exists(f.storageKey))) throw new Error('本機實體檔不存在');
          const localSha = await sha256Of(local.openRead(f.storageKey));
          if (localSha !== f.sha256) throw new Error('本機實體檔 SHA-256 與資料庫不符');
          await nas.put(f.storageKey, () => local.openRead(f.storageKey), f.sha256);
          await repo.markBackupDone(f.fileUuid, (this.opts.now ?? (() => new Date()))());
          result.done++;
        } catch (err) {
          const r = await repo.markBackupAttempt(f.fileUuid, maxAttempts);
          if (r.status === 'failed') result.failed.push({ file: f, attempts: r.attempts, error: (err as Error).message });
          else result.retrying++;
        }
      }
      if (result.failed.length > 0 && this.opts.alert) await this.opts.alert(result.failed);
      return result;
    } finally {
      this.running = false;
    }
  }

  retry(fileUuids: string[] | null): Promise<number> {
    return this.opts.repo.retryBackups(fileUuids ? [...new Set(fileUuids.map((u) => u.toLowerCase()))] : null);
  }
}
