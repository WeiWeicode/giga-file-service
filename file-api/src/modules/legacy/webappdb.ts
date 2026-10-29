/**
 * WebAppDb 唯讀讀取(F4;D8、D17):filebackend 的 webFileUpload、SMBbackend 的 smbFileUpload(兩表欄位相同)。
 * 以唯讀帳號 file_legacy_ro(db/dba/03-create-webappdb-readonly.sql)連線,只 SELECT;舊表一律不改(AGENT.md §7.1)。
 * uploadDate 是 GETDATE()(台灣時間、無時區):以字串取出,由匯入程式標 +08:00,不依容器時區(比照 NaNa,API.md §3)。
 */
import sql from 'mssql';
import type { SqlConfig } from '../../config.js';

export type LegacyTable = 'webFileUpload' | 'smbFileUpload';

export interface LegacyRow {
  id: number;
  filename: string | null;
  originalName: string | null;
  filesize: number | null;
  mimetype: string | null;
  path: string | null;
  destination: string | null;
  Description: string | null;
  SourcePlatform: string | null;
  SourceApplication: string | null;
  SourceNumber: string | null;
  userAgent: string | null;
  userNumber: string | null;
  Effective: boolean;
  storageType: string | null;
  ip: string | null;
  version: string | null;
  nasPath: string | null;
  /** 'YYYY-MM-DDTHH:mm:ss.fff'(台灣時間) */
  uploadDate: string;
}

export interface LegacyRowSource {
  rows(table: LegacyTable): Promise<LegacyRow[]>;
  close(): Promise<void>;
}

/** 表名只允許這兩個(不組使用者輸入) */
const TABLES: Record<LegacyTable, string> = { webFileUpload: '[dbo].[webFileUpload]', smbFileUpload: '[dbo].[smbFileUpload]' };

export class WebAppDbSource implements LegacyRowSource {
  private constructor(private readonly pool: sql.ConnectionPool) {}

  static async open(cfg: SqlConfig): Promise<WebAppDbSource> {
    const pool = new sql.ConnectionPool({
      server: cfg.server,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectionTimeout: 15_000,
      requestTimeout: 60_000,
      pool: { min: 0, max: 2 },
      // 內網 SQL Server 2012 不加密(比照 db/client.ts);applicationIntent 唯讀
      options: { encrypt: false, trustServerCertificate: true, appName: 'giganexus-file-legacy-import', readOnlyIntent: true },
    });
    await pool.connect();
    return new WebAppDbSource(pool);
  }

  async rows(table: LegacyTable): Promise<LegacyRow[]> {
    const r = await this.pool.request().query<Omit<LegacyRow, 'Effective'> & { Effective: boolean | number }>(
      `SELECT id, filename, originalName, filesize, mimetype, path, destination, Description, SourcePlatform, SourceApplication, SourceNumber,
              userAgent, userNumber, Effective, storageType, ip, version, nasPath, CONVERT(varchar(23), uploadDate, 126) AS uploadDate
         FROM ${TABLES[table]} ORDER BY id`,
    );
    return r.recordset.map((x) => ({ ...x, Effective: x.Effective === true || x.Effective === 1, filesize: x.filesize === null ? null : Number(x.filesize) }));
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}
