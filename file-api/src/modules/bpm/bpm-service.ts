/**
 * BPM 附件唯讀查詢與下載(F6;API.md §3,D10 / D11 / D12)。即時代理,不複製檔案。
 *   - 權限第一版只看 file.bpm.read(由 Gateway 檢查),不再依表單參與者過濾(D12)
 *   - 每次下載寫 file_access_log(action = bpm_download,detail = Doid + 單號)
 */
import type { Readable } from 'node:stream';
import { AppError } from '../../errors.js';
import type { Actor } from '../files/file-service.js';
import { canInline, contentDisposition, MIME, sanitizeOriginalName } from '../files/file-types.js';
import type { AccessLog } from '../files/types.js';
import type { BpmDocServer } from './doc-server.js';
import type { BpmAttachment, BpmRepo } from './types.js';

export interface BpmServiceOptions {
  repo: BpmRepo;
  docs: BpmDocServer;
  log: (entry: AccessLog) => Promise<void>;
  /** 顯示用:資料來源主機(191 測試 / 190 正式) */
  source: string;
}

const notFound = () => new AppError(404, 'FILE_BPM_NOT_FOUND', '找不到此 BPM 附件');

/** 下載檔名:logicalName 沒有副檔名才補上(同 BPMbackend) */
export function downloadName(a: Pick<BpmAttachment, 'originalName' | 'ext'>): string {
  const base = sanitizeOriginalName(a.originalName) || 'attachment';
  return a.ext && !base.toLowerCase().endsWith(`.${a.ext}`) ? `${base}.${a.ext}` : base;
}

export class BpmService {
  constructor(private readonly opts: BpmServiceOptions) {}

  get source(): string {
    return this.opts.source;
  }

  list(serialNumber: string): Promise<BpmAttachment[]> {
    return this.opts.repo.bySerialNumber(serialNumber);
  }

  async get(doid: string): Promise<BpmAttachment> {
    const a = await this.opts.repo.byDoid(doid.toLowerCase());
    if (!a) throw notFound();
    return a;
  }

  async open(
    doid: string,
    inline: boolean,
    actor: Actor,
  ): Promise<{ attachment: BpmAttachment; stream: Readable; size: number | null; mime: string; disposition: string }> {
    const a = await this.get(doid);
    const { stream, size } = await this.opts.docs.open(a.physicalName, a.ext);
    // 取得串流後才記錄(找不到實體檔不算下載)
    try {
      await this.opts.log({
        fileUuid: null,
        action: 'bpm_download',
        userId: actor.scope.userId,
        ip: actor.ip,
        requestId: actor.requestId,
        detail: `${a.doid} ${a.serialNumber ?? '-'}`,
      });
    } catch (err) {
      stream.destroy();
      throw err;
    }
    return {
      attachment: a,
      stream,
      size,
      mime: (a.ext && MIME[a.ext]) || 'application/octet-stream',
      disposition: contentDisposition(downloadName(a), inline && canInline(a.ext)),
    };
  }
}
