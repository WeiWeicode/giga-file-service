/**
 * BpmRepo 的 NaNa 實作(唯讀帳號 file_bpm_ro,只有附件 5 張表 SELECT;DATABASE.md D17:舊庫用 mssql 參數化 SQL,不經 Drizzle)。
 *   - 連線延遲到第一次查詢才建立,NaNa 連不上不影響 file-api 啟動;失敗後下次查詢重連
 *   - 查詢與 BPMbackend AttachmentController 相同的關聯(ProcessInstance → LocalRelevantData → FormInstance → NoCmDocument),
 *     但單號完全比對;localAttachmentPath 不用(filePath 指向 5144 根目錄外的 D:\attachment,取不到,LEGACY-INVENTORY §5)
 */
import sql from 'mssql';
import type { SqlConfig } from '../../config.js';
import type { BpmAttachment, BpmRepo } from './types.js';

interface Row {
  doid: string;
  logicalName: string | null;
  physicalName: string;
  extentionName: string | null;
  /** NaNa 的 datetime 為台灣時間;以字串取出再標 +08:00,不依容器時區 */
  createdTime: string | null;
  serialNumber: string | null;
  processInstanceName: string | null;
  subject: string | null;
}

const COLUMNS = `
  RTRIM(D.OID) AS doid, D.logicalName, D.physicalName, D.extentionName,
  CONVERT(varchar(19), D.createdTime, 126) AS createdTime,
  P.serialNumber,
  -- subject 等欄位為 ntext,DISTINCT 無法比較,轉成 nvarchar
  CAST(P.processInstanceName AS nvarchar(255)) AS processInstanceName, CAST(P.subject AS nvarchar(1000)) AS subject`;

const toAttachment = (r: Row): BpmAttachment => ({
  doid: r.doid.toLowerCase(),
  originalName: r.logicalName || r.physicalName,
  ext: r.extentionName ? r.extentionName.replace(/^\./, '').toLowerCase() : null,
  physicalName: r.physicalName,
  createdAt: r.createdTime ? new Date(`${r.createdTime}+08:00`) : null,
  serialNumber: r.serialNumber,
  formName: r.processInstanceName,
  subject: r.subject,
});

export class NanaBpmRepo implements BpmRepo {
  private readonly pool: sql.ConnectionPool;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(cfg: SqlConfig) {
    this.pool = new sql.ConnectionPool({
      server: cfg.server,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectionTimeout: 10_000,
      requestTimeout: 30_000,
      pool: { min: 0, max: 4, idleTimeoutMillis: 30_000 },
      options: { encrypt: false, trustServerCertificate: true, appName: 'giganexus-file-bpm', useUTC: true, enableArithAbort: true },
    });
  }

  private async ready(): Promise<sql.ConnectionPool> {
    if (this.pool.connected) return this.pool;
    this.connecting ??= this.pool.connect().finally(() => (this.connecting = null));
    return this.connecting;
  }

  async bySerialNumber(serialNumber: string): Promise<BpmAttachment[]> {
    const pool = await this.ready();
    // 同一附件可能因多筆 LocalRelevantData 重複出現,以 DISTINCT 去除;上限 500 筆
    const r = await pool.request().input('sn', sql.NVarChar(100), serialNumber).query<Row>(`
      SELECT DISTINCT TOP 500 ${COLUMNS}
      FROM dbo.ProcessInstance AS P
      INNER JOIN dbo.LocalRelevantData AS B ON B.containerOID = P.contextOID
      INNER JOIN dbo.FormInstance AS A ON B.valueOID = A.OID
      INNER JOIN dbo.NoCmDocument AS D ON D.formInstanceOID = A.OID
      WHERE P.serialNumber = @sn
      ORDER BY createdTime, doid`);
    return r.recordset.map(toAttachment);
  }

  async byDoid(doid: string): Promise<BpmAttachment | null> {
    const pool = await this.ready();
    // 附件不一定關聯到流程(LEFT JOIN);有關聯的優先
    const r = await pool.request().input('doid', sql.NChar(32), doid).query<Row>(`
      SELECT TOP 1 ${COLUMNS}
      FROM dbo.NoCmDocument AS D
      LEFT JOIN dbo.FormInstance AS A ON A.OID = D.formInstanceOID
      LEFT JOIN dbo.LocalRelevantData AS B ON B.valueOID = A.OID
      LEFT JOIN dbo.ProcessInstance AS P ON P.contextOID = B.containerOID
      WHERE D.OID = @doid
      ORDER BY CASE WHEN P.serialNumber IS NULL THEN 1 ELSE 0 END`);
    return r.recordset[0] ? toAttachment(r.recordset[0]) : null;
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}
