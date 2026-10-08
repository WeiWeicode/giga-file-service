/**
 * 本機檔案存放(STORAGE.md §1;AGENT.md §7.3):
 *   - 實體路徑 {yyyy}/{mm}/{file_uuid}(不帶副檔名、不帶原檔名)
 *   - 先寫 tmp/ 並同時計算 SHA-256,完成後 rename 到正式路徑(呼叫端之後才寫資料庫);失敗清掉暫存
 *   - 任何路徑都以 path.resolve 後確認落在根目錄之下(含分隔符的前綴比對),不信任請求或資料庫的路徑片段
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withSep } from '../legacy/readonly-source.js';

export const HEAD_BYTES = 512;

export interface TempFile {
  tmpPath: string;
  size: number;
  sha256: string;
  /** 檔案前段(檔頭檢查用) */
  head: Buffer;
  /** 超過上限:內容已被截斷,不可保存 */
  truncated: boolean;
}

export class PathEscapeError extends Error {
  override name = 'PathEscapeError';
}

export class LocalStore {
  readonly root: string;
  private readonly tmpDir: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.tmpDir = path.join(this.root, 'tmp');
  }

  async init(): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true });
  }

  /** storageKey 只允許 yyyy/mm/uuid;仍以 resolve 後的前綴比對確認不逃出根目錄 */
  resolveKey(storageKey: string): string {
    const full = path.resolve(this.root, storageKey);
    if (!full.startsWith(withSep(this.root)) || full.startsWith(withSep(this.tmpDir))) throw new PathEscapeError(`storage_key 不在檔案根目錄內:${storageKey}`);
    return full;
  }

  static keyFor(fileUuid: string, at: Date): string {
    const yyyy = String(at.getUTCFullYear());
    const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}/${mm}/${fileUuid}`;
  }

  /** 串流寫入暫存檔並計算 SHA-256;超過 maxBytes 時停止寫入並標記 truncated(呼叫端負責 discard) */
  async writeTemp(source: Readable, maxBytes: number): Promise<TempFile> {
    const tmpPath = path.join(this.tmpDir, `${randomUUID()}.part`);
    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let headLen = 0;
    let size = 0;
    let truncated = false;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (truncated) return cb();
        if (size + chunk.length > maxBytes) {
          truncated = true;
          return cb();
        }
        size += chunk.length;
        hash.update(chunk);
        if (headLen < HEAD_BYTES) {
          headChunks.push(chunk.subarray(0, HEAD_BYTES - headLen));
          headLen += Math.min(chunk.length, HEAD_BYTES - headLen);
        }
        cb(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, createWriteStream(tmpPath, { flags: 'wx' }));
    } catch (err) {
      await this.discard(tmpPath);
      throw err;
    }
    return { tmpPath, size, sha256: hash.digest('hex'), head: Buffer.concat(headChunks), truncated };
  }

  /** 暫存檔移到正式路徑;目的地已存在時失敗(UUID 不應重複) */
  async commit(tmpPath: string, storageKey: string): Promise<void> {
    const dest = this.resolveKey(storageKey);
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await stat(dest);
      throw new Error(`目的地已存在:${storageKey}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await rename(tmpPath, dest);
  }

  async discard(tmpPath: string): Promise<void> {
    const full = path.resolve(tmpPath);
    if (!full.startsWith(withSep(this.tmpDir))) throw new PathEscapeError(`暫存檔不在 tmp 目錄內:${tmpPath}`);
    await rm(full, { force: true });
  }

  openRead(storageKey: string): ReadStream {
    return createReadStream(this.resolveKey(storageKey), { flags: 'r' });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      return (await stat(this.resolveKey(storageKey))).isFile();
    } catch (err) {
      if (err instanceof PathEscapeError) throw err;
      return false;
    }
  }

  /** 只用於未綁定暫存檔的清除;軟刪除不呼叫(不刪實體檔,AGENT.md §7.3) */
  async remove(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey), { force: true });
  }

  /** 檔案根目錄所在檔案系統的容量(STORAGE.md §1;「儲存與備份」Tab) */
  async capacity(): Promise<{ totalBytes: number; freeBytes: number } | null> {
    try {
      const s = await statfs(this.root);
      return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
    } catch {
      return null;
    }
  }
}
