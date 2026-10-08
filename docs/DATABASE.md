# GigaNexus 附件服務 — 資料庫設計(SQL Server,草案)

> 本文件自 [PRD.md](PRD.md) §7 拆出(原 FILE-PLAN §7),為該主題的唯一維護來源;PRD 僅保留摘要與連結。
> 對應 PRD 版本:**v0.7**(2026-10-08)。**尚未建立 migration**;資料存取方式(Drizzle 或 `mssql` 直連)於 F1 依 Gateway [TECH-STACK.md](../../giga-api-gateway-bff/docs/TECH-STACK.md) 決定,定案後回寫本文件與 `AGENT.md` §7.7。

---

## 0. 資料庫與限制

| 項目 | 內容 |
| --- | --- |
| 主機 | 10.10.130.220(公司 SQL Server **2012**,與 Gateway 同一台) |
| 資料庫 | `giganexus_file`(正式)、`giganexus_file_test`(測試 + 開發)(D7) |
| 帳號 | 比照 Gateway 分 app(讀寫資料)/ migrate(變更結構);**建庫與帳密由使用者執行**,AI 不經手 |
| 語法 | 只用 SQL Server 2012 支援的語法(不可用 JSON 函式、`CREATE OR ALTER`、`DROP … IF EXISTS`、`STRING_AGG`、`TRIM` 等),見 Gateway [DATABASE.md](../../giga-api-gateway-bff/docs/DATABASE.md) §0 |
| UUID | `UNIQUEIDENTIFIER`(2012 支援 `NEWID()`);值由**應用端**產生(v4),不依賴 DB |
| 時間 | `DATETIME2` 存 UTC,畫面轉台灣時間(比照 Gateway) |
| 命名 | 資料表與欄位 `snake_case` |
| 舊資料 | `WebAppDb.webFileUpload`、`smbFileUpload`、PortalSolar 各表、BPM `NaNa` **只讀不改**(D8、D9);對照一律寫在本庫 `legacy_file_map` |

## 1. `file_object` 檔案主表

```sql
file_object (
  id              BIGINT IDENTITY PRIMARY KEY,   -- 內部用,不對外
  file_uuid       UNIQUEIDENTIFIER NOT NULL UNIQUE,  -- 對外唯一識別
  original_name   NVARCHAR(255) NOT NULL,
  ext             NVARCHAR(20),
  mime            NVARCHAR(100),
  size_bytes      BIGINT NOT NULL,
  sha256          CHAR(64) NOT NULL,
  storage_key     NVARCHAR(200) NOT NULL,       -- {yyyy}/{mm}/{uuid}(STORAGE §1)
  source_system   NVARCHAR(50) NOT NULL,        -- 例 it / portal / bpm(對應 Gateway 系統代碼);舊檔標示舊系統
  source_app      NVARCHAR(50),                 -- 舊 SourceApplication 完整字串,不拆(LEGACY-INVENTORY §4.2 觀察 8)
  ref_type        NVARCHAR(50),                 -- 單據類型
  ref_no          NVARCHAR(100),                -- 來源單號;NULL = 尚未綁定(暫存)
  company_id      NVARCHAR(20),
  uploaded_by     NVARCHAR(20) NOT NULL,        -- 工號
  uploaded_ip     NVARCHAR(50),
  created_at      DATETIME2 NOT NULL,
  bound_at        DATETIME2,
  deleted_at      DATETIME2,                    -- 軟刪除
  deleted_by      NVARCHAR(20),
  backup_status   NVARCHAR(10) NOT NULL,        -- pending / done / failed(STORAGE §2)
  backup_at       DATETIME2,
  backup_attempts INT NOT NULL DEFAULT 0
)
```

- 每個被同步的舊檔也會有一筆 `file_object`(`source_system` 標示舊系統),讓新舊檔案都用同一支 `/api/file/files/:uuid/content` 下載。
- 暫存檔(`ref_no IS NULL`)超過 24 小時未綁定由排程清除([API.md](API.md) §2)。
- 相容層欄位對應見 [API.md](API.md) §4.4 規則 3。

## 2. `file_access_log` 操作紀錄

```sql
file_access_log (id, file_uuid, action, user_id, ip, request_id, created_at)
-- action:upload / download / delete / bind / bpm_download(BPM 附件記 Doid 與單號)
```

## 3. `legacy_file_map` 舊系統對照

```sql
legacy_file_map (
  id              BIGINT IDENTITY PRIMARY KEY,
  file_uuid       UNIQUEIDENTIFIER NOT NULL UNIQUE,  -- 同 file_object.file_uuid
  legacy_source   NVARCHAR(30) NOT NULL,   -- portalsolar / smbbackend / filebackend / sdsfiles(/ bpm,D11 快取時)
  legacy_dir      NVARCHAR(300),           -- 相對來源根目錄的目錄,例 EHS\License
  legacy_name     NVARCHAR(255) NOT NULL,  -- 原檔名(中文照存)
  legacy_db       NVARCHAR(100),           -- 以下三欄 F0 盤點後回填:哪個資料列引用這個檔
  legacy_table    NVARCHAR(100),
  legacy_key      NVARCHAR(200),           -- 例:webFileUpload / smbFileUpload 的舊 id(相容層用)
  size_bytes      BIGINT NOT NULL,
  mtime_utc       DATETIME2 NOT NULL,      -- 來源檔修改時間,判斷是否變動
  sha256          CHAR(64),
  is_current      BIT NOT NULL DEFAULT 1,  -- 同名內容被覆蓋時,舊列設 0、新增一列(新 UUID)
  nas_path        NVARCHAR(500),           -- NAS 原檔名鏡像位置
  nas_copied_at   DATETIME2,
  wsl_copied_at   DATETIME2,               -- UUID 副本寫入 WSL 的時間
  first_seen_at   DATETIME2 NOT NULL,
  last_seen_at    DATETIME2 NOT NULL,
  source_missing_at DATETIME2,             -- 來源已不存在(只標記,不刪 NAS / WSL)
  sync_state      NVARCHAR(20) NOT NULL    -- discovered / nas_copied / done / failed(MIGRATION §3)
)
-- 唯一鍵:(legacy_source, legacy_dir, legacy_name) WHERE is_current = 1
```

- 舊資料表不動:舊程式存的「檔名」要找對應 UUID,用 `(legacy_source, legacy_dir, legacy_name, is_current = 1)` 查本表。
- 相容層:`/sql-download/:id`、`/sql-delete/:id` 以 `legacy_key` 查舊整數 id;SMB `path` 兩種格式(UUID 檔名、中文原檔名)都以本表查得到([API.md](API.md) §4.4 規則 2、12)。
- BPM 附件預設不寫本表(D11 即時代理);改為快取時才寫 `legacy_source = bpm`、`legacy_key = Doid`([MIGRATION.md](MIGRATION.md) §1)。
- filtered unique index(`WHERE is_current = 1`)SQL Server 2008 起支援,2012 可用。

## 4. 待定

- 軟刪除後實體清除的保留期限(PRD §11 #4)。
- 是否另建 `sync_run`(同步 / 備份批次紀錄)表,F2 / F4 實作時決定。
