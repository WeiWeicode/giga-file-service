# GigaNexus 附件服務 — 資料庫設計(SQL Server,草案)

> 本文件自 [PRD.md](PRD.md) §7 拆出(原 FILE-PLAN §7),為該主題的唯一維護來源;PRD 僅保留摘要與連結。
> 對應 PRD 版本:**v0.8**(2026-10-08)。**尚未建立 migration**。資料表放在 Gateway 的 `giganexus_gw`、獨立 schema **`file_svc`**(D7);存取方式 **Drizzle ORM**(D17,§0.1)。

---

## 0. 資料庫與限制

| 項目 | 內容 |
| --- | --- |
| 主機 | 10.10.130.220(公司 SQL Server **2012**,與 Gateway 同一台) |
| 資料庫 | **沿用 Gateway 的資料庫**(D7,只有少量資料表,不另建資料庫):正式 `giganexus_gw`、開發 + 測試 `giganexus_gw_test`、整合測試 `giganexus_gw_poc_test` |
| Schema | **`file_svc`**(`file` 是 T-SQL 保留字,不使用);本服務只讀寫這個 schema,**不讀寫 `gw.*`**,也不與 `gw.*` 建 FK |
| 帳號 | 本服務自有 LOGIN,比照 Gateway 分 app(`file_svc` 的 SELECT / INSERT / UPDATE / DELETE)/ migrate(`file_svc` 的 DDL);**只授權 schema `file_svc`**,不共用 Gateway 的 `gw_app` / `gw_migrate`;**建 schema 與帳密由使用者執行**,AI 不經手 |
| 語法 | 只用 SQL Server 2012 支援的語法(不可用 JSON 函式、`CREATE OR ALTER`、`DROP … IF EXISTS`、`STRING_AGG`、`TRIM` 等),見 Gateway [DATABASE.md](../../giga-api-gateway-bff/docs/DATABASE.md) §0 |
| UUID | `UNIQUEIDENTIFIER`(2012 支援 `NEWID()`);值由**應用端**產生(v4),不依賴 DB |
| 時間 | `DATETIME2` 存 UTC,畫面轉台灣時間(比照 Gateway) |
| 命名 | 資料表與欄位 `snake_case` |
| 舊資料 | `WebAppDb.webFileUpload`、`smbFileUpload`、PortalSolar 各表、BPM `NaNa` **只讀不改**(D8、D9);對照一律寫在 `file_svc.legacy_file_map` |

### 0.1 存取方式(D17)

| 對象 | 方式 | 說明 |
| --- | --- | --- |
| `file_svc.*`(本服務資料表) | **Drizzle ORM** + drizzle-kit(MSSQL dialect) | 版本**鎖定與 Gateway 相同**(目前 `drizzle-orm` / `drizzle-kit` `1.0.0-rc.4`,已在 2012 PoC);升版須重新驗證。schema 定義在 `src/db/schema/`,`schemaFilter: ['file_svc']` |
| 舊資料庫(NaNa、`WebAppDb`、PortalSolar 等,唯讀) | `mssql` 直接寫參數化 SQL | 比照 Gateway `bff/src/db/external/`;不定義 Drizzle schema、不跑 migration |

效能兩者相同(Drizzle 底層就是同一個 `mssql` / tedious 驅動,多的只是組 SQL 的微秒級成本;本服務的瓶頸在檔案 I/O)。選 Drizzle 是為了型別安全、自動產生 migration、與 Gateway 一致。

### 0.2 與 Gateway 共用資料庫的規則

1. **migration 紀錄分開**:Drizzle migrator 的紀錄表放在 `file_svc`(例 `file_svc.__file_migrations`),**不可用 Gateway 使用的 `drizzle` schema**;Gateway 的 `reset-test-db` 會清空 `gw` 與 `drizzle` 兩個 schema。F1 時確認 `drizzle-orm/node-mssql/migrator` 的 `migrationsSchema` / `migrationsTable` 選項可用,不可用時回報再議。
2. **migration 只動 `file_svc`**:drizzle-kit 產生的 SQL 人工審查,不得出現 `gw.` 或其他 schema;SQL 2012 語法檢查沿用 Gateway `sql2012-guard` 的規則。
3. **部署順序獨立**:本服務的 migration 由本 repo 的 migrate 容器執行,與 Gateway migration 互不相依。
4. **整合測試**:`test:int` 只清空 `file_svc`,使用 `giganexus_gw_poc_test`,**不可指向 `giganexus_gw_test`**(與 Gateway 規則相同)。
5. **資料量**:檔案內容不進資料庫(只存中繼資料),不會明顯增加 `giganexus_gw` 的大小;備份與還原跟著 `giganexus_gw` 一起。
6. Gateway 端登記:Gateway [DATABASE.md](../../giga-api-gateway-bff/docs/DATABASE.md) 開頭註明 schema `file_svc` 屬本服務。

## 1. `file_svc.file_object` 檔案主表

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

## 2. `file_svc.file_access_log` 操作紀錄

```sql
file_access_log (id, file_uuid, action, user_id, ip, request_id, created_at)
-- action:upload / download / delete / bind / bpm_download(BPM 附件記 Doid 與單號)
```

## 3. `file_svc.legacy_file_map` 舊系統對照

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
- filtered unique index(`WHERE is_current = 1`)SQL Server 2008 起支援,2012 可用;drizzle-kit 不支援時在 migration SQL 手動補上並註明。

## 4. 待定

- 軟刪除後實體清除的保留期限(PRD §11 #4)。
- 是否另建 `sync_run`(同步 / 備份批次紀錄)表,F2 / F4 實作時決定。
