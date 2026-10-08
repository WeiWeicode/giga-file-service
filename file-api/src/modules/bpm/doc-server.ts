/**
 * BPM 取檔服務(python_BPM190191檔案下載API,FastAPI :5144)客戶端(LEGACY-INVENTORY.md §5)。
 *   GET {BPM_FILE_URL}/download/{目錄}/{physicalName}{.副檔名},標頭 X-API-Key;找不到回 404 {"detail":"File not found"}
 *
 * 目錄規則:physicalName 每 2 字元切段,取索引 N..1 反向組成目錄(不含索引 0)。BPMbackend 依序試 N = 11 → 10 → 12;
 * NaNa 的 physicalName 長度 21–32 不等,實際規則應為「去掉第一段與最後一段」(N = 段數 − 2),先試它,再補 11 / 10 / 12。
 * 找到的段數依 physicalName 快取(記憶體 LRU),同一檔案不重複試。
 */
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AppError } from '../../errors.js';

const PHYSICAL_RE = /^[0-9A-Za-z]{1,64}$/;
const EXT_RE = /^[0-9A-Za-z]{1,10}$/;
const LEGACY_SEGMENTS = [11, 10, 12];

export function chunks(physicalName: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < physicalName.length; i += 2) parts.push(physicalName.slice(i, i + 2));
  return parts;
}

/** 索引 n..1 反向(不存在的索引略過,同 BPMbackend) */
export function dirFor(physicalName: string, n: number): string {
  const parts = chunks(physicalName);
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const p = parts[i];
    if (p) out.push(p);
  }
  return out.join('/');
}

/** 依序要試的段數:預測值(段數 − 2)優先,再補 BPMbackend 的 11 / 10 / 12;組出相同目錄的只留一個 */
export function candidateSegments(physicalName: string): number[] {
  const predicted = chunks(physicalName).length - 2;
  const seen = new Set<string>();
  const out: number[] = [];
  for (const n of [predicted, ...LEGACY_SEGMENTS]) {
    if (n < 1) continue;
    const dir = dirFor(physicalName, n);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(n);
  }
  return out;
}

export interface DocStream {
  stream: Readable;
  size: number | null;
  segments: number;
}

export interface DocServerOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  cacheSize?: number;
  fetchImpl?: typeof fetch;
}

export class BpmDocServer {
  private readonly cache = new Map<string, number>();
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: DocServerOptions) {
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  urlFor(physicalName: string, ext: string | null, segments: number): string {
    const path = dirFor(physicalName, segments).split('/').map(encodeURIComponent).join('/');
    return new URL(`/download/${path}/${encodeURIComponent(physicalName)}${ext ? `.${ext}` : ''}`, this.opts.baseUrl).toString();
  }

  /** 開啟串流;所有目錄都找不到回 404 FILE_BPM_NOT_FOUND,5144 拒絕或連不上回 502 FILE_BPM_UPSTREAM */
  async open(physicalName: string, ext: string | null): Promise<DocStream> {
    // 資料庫值也不信任:只允許英數,避免組出 5144 根目錄外的路徑
    if (!PHYSICAL_RE.test(physicalName) || (ext !== null && !EXT_RE.test(ext)))
      throw new AppError(500, 'FILE_BPM_BAD_RECORD', 'BPM 附件紀錄格式異常,請通知管理員');
    const cached = this.cache.get(physicalName);
    const order = cached ? [cached, ...candidateSegments(physicalName).filter((n) => n !== cached)] : candidateSegments(physicalName);
    for (const n of order) {
      const res = await this.get(this.urlFor(physicalName, ext, n));
      if (res.status === 404) {
        await res.body?.cancel();
        continue;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        throw new AppError(502, 'FILE_BPM_UPSTREAM', `BPM 取檔服務回應 ${res.status}${res.status === 403 ? '(金鑰錯誤?)' : ''}`);
      }
      this.remember(physicalName, n);
      const len = Number(res.headers.get('content-length'));
      return { stream: Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), size: Number.isFinite(len) && len > 0 ? len : null, segments: n };
    }
    throw new AppError(404, 'FILE_BPM_NOT_FOUND', 'BPM 取檔服務找不到此附件的實體檔');
  }

  /** 逾時只限等待回應標頭;之後的本體串流不設時限(大檔慢速下載不中斷) */
  private async get(url: string): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('逾時')), this.opts.timeoutMs ?? 30_000);
    try {
      return await this.doFetch(url, { headers: { 'x-api-key': this.opts.apiKey }, signal: ac.signal });
    } catch (err) {
      throw new AppError(502, 'FILE_BPM_UPSTREAM', `BPM 取檔服務連線失敗:${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(physicalName: string, n: number): void {
    this.cache.delete(physicalName);
    this.cache.set(physicalName, n);
    const max = this.opts.cacheSize ?? 10_000;
    if (this.cache.size > max) this.cache.delete(this.cache.keys().next().value!);
  }
}
