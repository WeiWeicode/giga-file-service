/**
 * 舊來源唯讀存取(AGENT.md §7.1;docs/Gherkin/legacy/inventory.feature):
 * 166 PortalSolar、NAS 的 filebackend / SMB 備份目錄對本服務一律唯讀。
 * ReadonlyFs 只宣告讀取類操作(列目錄、取屬性、以 'r' 開檔),型別上就無法呼叫寫入、改名或刪除。
 */
import { createHash } from 'node:crypto';
import { createReadStream, type Dirent, type Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ReadonlyFs {
  readdir(dir: string): Promise<Dirent[]>;
  stat(p: string): Promise<Stats>;
  openRead(p: string): Readable;
}

export const nodeReadonlyFs: ReadonlyFs = {
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  stat: (p) => stat(p),
  openRead: (p) => createReadStream(p, { flags: 'r' }),
};

export type WalkEntry = { kind: 'file'; rel: string; size: number; mtime: Date } | { kind: 'error'; rel: string; message: string };

/** 前綴比對用:UNC 分享根目錄(\\server\share\)與磁碟根目錄 resolve 後已帶分隔符,不可再加一個 */
export const withSep = (dir: string) => (dir.endsWith(path.sep) ? dir : dir + path.sep);

export class SourceUnavailableError extends Error {
  override name = 'SourceUnavailableError';
}

export class ReadonlySource {
  readonly root: string;

  constructor(
    readonly name: string,
    root: string,
    private readonly fs: ReadonlyFs = nodeReadonlyFs,
  ) {
    this.root = path.resolve(root);
  }

  /** 來源根目錄必須存在且是目錄;否則為「未查詢」,不可當作 0 個檔案 */
  async check(): Promise<void> {
    let s: Stats;
    try {
      s = await this.fs.stat(this.root);
    } catch (err) {
      throw new SourceUnavailableError(`${this.name} 無法存取 ${this.root}:${(err as Error).message}`);
    }
    if (!s.isDirectory()) throw new SourceUnavailableError(`${this.name} 不是目錄:${this.root}`);
  }

  private full(rel: string): string {
    const p = path.resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(withSep(this.root))) throw new Error(`路徑不在來源根目錄內:${rel}`);
    return p;
  }

  /** 深度優先列出 rel 之下的檔案;讀不到的目錄或檔案以 error 回報,不中斷;符號連結不跟隨 */
  async *walk(rel = ''): AsyncGenerator<WalkEntry> {
    let entries: Dirent[];
    try {
      entries = await this.fs.readdir(this.full(rel));
    } catch (err) {
      yield { kind: 'error', rel: rel || '.', message: (err as Error).message };
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isSymbolicLink()) {
        yield { kind: 'error', rel: childRel, message: '符號連結,略過' };
      } else if (e.isDirectory()) {
        yield* this.walk(childRel);
      } else if (e.isFile()) {
        try {
          const s = await this.fs.stat(this.full(childRel));
          yield { kind: 'file', rel: childRel, size: s.size, mtime: s.mtime };
        } catch (err) {
          yield { kind: 'error', rel: childRel, message: (err as Error).message };
        }
      }
    }
  }

  async sha256(rel: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(this.fs.openRead(this.full(rel)), hash);
    return hash.digest('hex');
  }
}
