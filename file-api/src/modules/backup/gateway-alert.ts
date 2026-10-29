/**
 * 備份失敗告警:經 Gateway POST /api/notify/send(BACKEND-GUIDE.md §7.7)以 Email 逐人寄送(不寄群組信箱)。
 *   - 需要 file-api 的 API Key 有 notify.message.send、範本 FILE_BACKUP_FAILED(Gateway 負責人建立)
 *   - idempotencyKey 以日期 + 檔案組合,同一批失敗 24 小時內不重複寄
 * 告警送不出去只記錄錯誤,不影響 backup_status(失敗已寫入資料庫,畫面看得到)。
 */
import { createHash } from 'node:crypto';
import type { BackupAlert } from './backup-service.js';

export const ALERT_TEMPLATE = 'FILE_BACKUP_FAILED';

export interface GatewayAlertOptions {
  gatewayUrl: string;
  apiKey: string;
  /** 收件人工號 */
  users: string[];
  gwEnv: string;
  fetchImpl?: typeof fetch;
}

export function gatewayAlert(opts: GatewayAlertOptions): BackupAlert {
  const doFetch = opts.fetchImpl ?? fetch;
  return async (failures) => {
    const uuids = failures.map((f) => f.file.fileUuid).sort();
    const day = new Date().toISOString().slice(0, 10);
    const key = createHash('sha256')
      .update(`${day}:${uuids.join(',')}`)
      .digest('hex')
      .slice(0, 32);
    const res = await doFetch(new URL('/api/notify/send', opts.gatewayUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey },
      body: JSON.stringify({
        templateCode: ALERT_TEMPLATE,
        channels: ['email'],
        to: { users: opts.users },
        data: {
          env: opts.gwEnv,
          count: failures.length,
          items: failures
            .slice(0, 20)
            .map((f) => `${f.file.originalName}(${f.file.fileUuid},${f.attempts} 次:${f.error})`)
            .join('\n'),
          linkUrl: '/it/gateway/files/storage',
        },
        priority: 'high',
        idempotencyKey: `file-backup-${key}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`備份失敗告警送出失敗:HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  };
}
