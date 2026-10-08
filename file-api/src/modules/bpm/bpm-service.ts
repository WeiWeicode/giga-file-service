/**
 * BPM 附件唯讀查詢與下載(F6;API.md §3,D10 / D11 / D12)。即時代理,不複製檔案。
 *   - 權限第一版只看 file.bpm.read(由 Gateway 檢查),不再依表單參與者過濾(D12)
 *   - 每次下載寫 file_access_log(action = bpm_download,detail = Doid + 單號)
 */
import type { Readable } from 'node:stream';
import type { BpmEnv } from '../../config.js';
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
  env: BpmEnv;
  /** 顯示用:測試區 / 正式區 */
  label: string;
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

  get env(): BpmEnv {
    return this.opts.env;
  }

  get label(): string {
    return this.opts.label;
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
        detail: `${a.doid} ${a.serialNumber ?? '-'} ${this.opts.env}`,
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

/** 已設定的 BPM 來源(測試區 191 / 正式區 190);?env= 未指定時用 defaultEnv */
export class BpmSources {
  private readonly byEnv: Map<BpmEnv, BpmService>;

  constructor(
    services: BpmService[],
    readonly defaultEnv: BpmEnv,
  ) {
    this.byEnv = new Map(services.map((s) => [s.env, s]));
  }

  list(): { env: BpmEnv; label: string; source: string }[] {
    return [...this.byEnv.values()].map((s) => ({ env: s.env, label: s.label, source: s.source }));
  }

  get(env?: BpmEnv): BpmService {
    const s = this.byEnv.get(env ?? this.defaultEnv);
    if (!s) throw new AppError(409, 'FILE_BPM_DISABLED', `此環境未設定 BPM ${env === 'prod' ? '正式區' : '測試區'}來源`);
    return s;
  }
}
