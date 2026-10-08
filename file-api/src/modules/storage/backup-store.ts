/**
 * NAS 備份存放(STORAGE.md §2;F2):
 *   - 路徑與本機相同 {yyyy}/{mm}/{file_uuid},根目錄為 NAS `giga-files/{env}/`(容器內 /data/backup)
 *   - 先寫 .part 再 rename,完成後重新讀取 NAS 上的檔案比對 SHA-256;不符即刪除並視為失敗(不可回報成功,AGENT.md §5)
 *   - 根目錄必須有標記檔 MARKER(由掛載腳本建立):NAS 沒掛上時 Docker 會在 WSL 本機建立空目錄,
 *     沒有標記檔就當作 NAS 不可用,避免把備份寫到本機卻標記完成
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, constants, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withSep } from '../legacy/readonly-source.js';
import { PathEscapeError } from './local-store.js';

export const MARKER = '.giga-files-backup';

export class BackupVerifyError extends Error {
  override name = 'BackupVerifyError';
}

export async function sha256Of(stream: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export class BackupStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** NAS 已掛載(有標記檔)且可寫;回傳不可用的原因,可用時回 null */
  async unavailableReason(): Promise<string | null> {
    try {
      await access(path.join(this.root, MARKER), constants.R_OK);
    } catch {
      return `備份根目錄沒有標記檔 ${MARKER}(NAS 未掛載?):${this.root}`;
    }
    try {
      await access(this.root, constants.W_OK);
    } catch {
      return `備份根目錄不可寫:${this.root}`;
    }
    return null;
  }

  /** storageKey 只允許 yyyy/mm/uuid;resolve 後確認不逃出根目錄 */
  resolveKey(storageKey: string): string {
    const full = path.resolve(this.root, storageKey);
    if (!full.startsWith(withSep(this.root))) throw new PathEscapeError(`storage_key 不在備份根目錄內:${storageKey}`);
    return full;
  }

  /** 複製到 NAS 並驗證 SHA-256;已存在且內容相符時視為完成(重試不重複寫) */
  async put(storageKey: string, source: () => Readable, sha256: string): Promise<void> {
    const dest = this.resolveKey(storageKey);
    if ((await this.hashOf(dest)) === sha256) return;
    await mkdir(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    try {
      await pipeline(source(), createWriteStream(part));
      const actual = await this.hashOf(part);
      if (actual !== sha256) throw new BackupVerifyError(`NAS 檔案 SHA-256 不符:${storageKey}`);
      await rename(part, dest);
    } finally {
      await rm(part, { force: true });
    }
    // rename 後再讀一次,確認落地的是正確內容
    if ((await this.hashOf(dest)) !== sha256) {
      await rm(dest, { force: true });
      throw new BackupVerifyError(`NAS 檔案 SHA-256 不符:${storageKey}`);
    }
  }

  openRead(storageKey: string): Readable {
    return createReadStream(this.resolveKey(storageKey), { flags: 'r' });
  }

  /** 檔案不存在回 null */
  async hashOf(fullPath: string): Promise<string | null> {
    try {
      if (!(await stat(fullPath)).isFile()) return null;
    } catch {
      return null;
    }
    return sha256Of(createReadStream(fullPath));
  }

  /** 只用於未綁定暫存檔清除時一併移除備份(軟刪除不動 NAS,STORAGE.md §2) */
  async remove(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey), { force: true });
  }
}
