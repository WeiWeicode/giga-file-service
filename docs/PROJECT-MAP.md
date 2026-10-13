# 專案地圖 — giga-file-service

> **最後更新:2026-10-13**(F7 舊格式相容層 `src/compat/` + `modules/compat/`;F4 filebackend / SMBbackend 匯入 `cli/legacy-import.ts`;`file_object` 加 `compat_ns` / `compat_key` / `legacy_meta`)。前次 2026-10-08(F1:`file-api/` 建立——Fastify 5 + Drizzle(`giganexus_gw` schema `file_svc`)、檔案上傳 / 下載 / 綁定 / 軟刪除 / 暫存清除 / 儲存統計;F0:舊來源唯讀盤點 CLI;Dockerfile、Compose、CI。同日:文件組由 FILE-PLAN 拆分)。
> 開發新功能後,在同一個變更內更新本文件(`AGENT.md` §9.1)。只寫結構與職責,細節連到 `docs/` 對應章節。

附件服務 `file-api`(:51272,系統代碼 `file`,`/api/file/*`):上傳 / 下載 / 清單 / 綁定 / 軟刪除、BPM 附件唯讀代理(F6)、舊格式相容層(F7)、WSL 存放 + NAS 備份(F2)、舊系統 UUID 對照與同步(F4)。畫面在 GigaItApp「Gateway 管理 › 檔案管理」。

---

## 1. 目錄

```
giga-file-service/
├─ AGENT.md / GEMINI.md / README.md
├─ .gitlab-ci.yml             check(typecheck、test、db:check-2012)、develop → deploy-test(主機 2)
├─ docs/                      PRD(總綱)、ARCHITECTURE、API、DATABASE、STORAGE、MIGRATION、LEGACY-INVENTORY、
│                             SECURITY-CHECKLIST、IMPL-PLAN、DEPLOYMENT、LEGACY-SWITCH-PLAN(filebackend / SMBbackend 接手)、本文件、
│                             DevelopmentProcess/、Gherkin/(files/、legacy/、TEST-MAP)
└─ file-api/                  程式與套件(使用者要求放一層子目錄)
   ├─ src/
   │  ├─ server.ts            進入點:連 SQL Server、準備檔案根目錄、啟動;每小時清除逾期暫存檔
   │  ├─ app.ts               Fastify 組裝:X-Internal-Token 驗證(dev 可 DEV_SKIP_TOKEN)、actorOf(身分 → 資料範圍)、
   │  │                       multipart(串流、30 MB)、統一錯誤格式、/healthz /readyz /openapi.json、setupGateway(監控 + 自動註冊)
   │  ├─ config.ts            設定(部署區、FILE_ROOT、FILE_DB_*、_FILE 機密、暫存保留時數)
   │  ├─ errors.ts、openapi.ts(x-gateway、權限宣告)、print-openapi.ts、migrate.ts(Drizzle migrator,紀錄表 file_svc)
   │  ├─ routes/files.ts      /v1/files*、/v1/storage(API.md §2):schema、x-permission、x-gherkin、格式轉換
   │  ├─ routes/legacy.ts     /v1/legacy/*(「舊系統」Tab:匯入摘要、對照清單、下載;file.legacy.read)
   │  ├─ compat/              舊格式相容層(API.md §4):plugin.ts(自己的舊式錯誤處理)、fb.ts(/compat/fb/*)、smb.ts(/compat/smb/api/*)、
   │  │                       views.ts(舊 JSON 欄位)、common.ts(multipart、呼叫端);不驗內部 Token、不進 OpenAPI
   │  ├─ modules/
   │  │  ├─ files/            file-service.ts(上傳整批檢查 → commit → 寫 DB、下載、綁定、軟刪除、暫存清除)、
   │  │  │                    file-types.ts(白名單、檔頭、inline、Content-Disposition)、types.ts(FileRepo 介面、資料範圍)、
   │  │  │                    drizzle-repo.ts(SQL Server 實作:OUTPUT、OFFSET FETCH)
   │  │  ├─ storage/          local-store.ts({yyyy}/{mm}/{uuid}、tmp → rename、SHA-256、路徑不逃出根目錄、容量)
   │  │  ├─ compat/           compat-service.ts(上傳檢查、舊 id / path 查找、軟刪除)、legacy-format.ts(舊 platform / mimetype / +08:00 / SMB 目錄)、
   │  │  │                    types.ts(CompatRepo、LegacyMeta)、drizzle-repo.ts
   │  │  └─ legacy/           readonly-source.ts(只有讀取介面的 ReadonlyFs)、inventory.ts(盤點統計、Markdown 報告)、
   │  │                       webappdb.ts(WebAppDb 唯讀讀取)、legacy-import.ts(F4 匯入:乾跑報表 → --apply 複製 + 寫 file_object / legacy_file_map)、
   │  │                       legacy-service.ts / legacy-repo.ts(「舊系統」Tab 唯讀查詢)
   │  ├─ cli/inventory.ts     舊來源唯讀盤點 CLI(F0;filebackend / smbbackend / portalsolar 預設範圍)
   │  ├─ cli/legacy-import.ts filebackend / SMBbackend 舊檔匯入 CLI(F4;npm run legacy:import -- --source fb|smb [--apply])
   │  └─ db/                  schema.ts(file_svc 三張表)、client.ts(連線池、Drizzle、2012 語法檢查 logger)、
   │                          sql2012-guard.ts(Gateway 複本)
   ├─ db/migrations/          drizzle-kit 產生、人工審查(不可修改已套用的)
   ├─ db/dba/                 01-create-schema.sql(使用者以 sa 執行:schema file_svc、file_app / file_migrate)、02 NaNa 唯讀、
   │                          03-create-webappdb-readonly.sql(WebAppDb 唯讀 file_legacy_ro)
   ├─ scripts/check-sql2012.ts
   ├─ test/                   files / units / inventory / compat / legacy-import(單元)、int/(SQL Server 2012)、legacy/(真實舊來源唯讀)、helpers.ts
   ├─ deploy/                 docker-compose.yml(測試區,加入 Gateway 網路;NAS 唯讀掛 /data/legacy)、test.env.example、host2-set-secrets.sh、
   │                          host2-set-bpm-secrets.sh、host2-set-legacy-secrets.sh、host2-mount-nas.sh
   ├─ Dockerfile、.env.example、drizzle.config.ts、package.json(gateway.project = giga-file-service)
   └─ data/                   本機執行期資料(檔案根目錄、盤點報告;不進版控)
```

## 2. 對外介面

| 介面 | 位置 | 狀態 |
| --- | --- | --- |
| `/api/file/files*`、`/api/file/storage` | API §2 | ✅ 測試區已部署並驗收(F1) |
| `/api/file/storage/backup/retry` | API §2、STORAGE §2.1 | ✅ 測試區已部署並驗收(F2) |
| `/api/file/legacy/*` | API §2 | 🔶 已實作(A4,「舊系統」Tab) |
| `/api/file/bpm/*` | API §3 | ✅ 測試區已部署並驗收(F6;`src/modules/bpm/`、`src/routes/bpm.ts`;191 / 190 以 `?env=` 選擇) |
| `/api/file/compat/{fb,smb}/*` | API §4 | 🔶 已實作(F7,`src/compat/`);待 Gateway Nginx 白名單直送後公開;`portal` 規劃 |
| GigaItApp「Gateway 管理 › 檔案管理」 | PRD §8 | ✅ 檔案清單、BPM 附件、儲存與備份已上線;舊系統 Tab 隨 F4 |

## 3. 已知差異

- 白名單為暫定(PRD §11 #6);資料範圍為第一版(PRD §11 #5)。
- 暫存檔清除(每小時)與 NAS 備份補傳(每 `BACKUP_INTERVAL_MINUTES` 分鐘)都在 API 行程內執行,未拆獨立 worker;NAS 未掛載(無標記檔)時備份整輪跳過。
- 上傳由 Gateway Nginx 直送 file-api(D4-B),其他 API 經 BFF;相容層 `/api/file/compat/*` 也由 Nginx 直送(內網白名單),不驗內部 Token。
- 相容層路由在 `src/compat/`、核心在 `src/modules/compat/`;匯入的舊檔與相容層上傳的檔案和新 API 共用 `file_object`(以 `compat_ns` 區分)。
