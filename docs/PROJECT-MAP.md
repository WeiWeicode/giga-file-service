# 專案地圖 — giga-file-service

> **最後更新:2026-10-08**(F1:`file-api/` 建立——Fastify 5 + Drizzle(`giganexus_gw` schema `file_svc`)、檔案上傳 / 下載 / 綁定 / 軟刪除 / 暫存清除 / 儲存統計;F0:舊來源唯讀盤點 CLI;Dockerfile、Compose、CI。同日:文件組由 FILE-PLAN 拆分)。
> 開發新功能後,在同一個變更內更新本文件(`AGENT.md` §9.1)。只寫結構與職責,細節連到 `docs/` 對應章節。

附件服務 `file-api`(:51272,系統代碼 `file`,`/api/file/*`):上傳 / 下載 / 清單 / 綁定 / 軟刪除、BPM 附件唯讀代理(F6)、舊格式相容層(F7)、WSL 存放 + NAS 備份(F2)、舊系統 UUID 對照與同步(F4)。畫面在 GigaItApp「Gateway 管理 › 檔案管理」。

---

## 1. 目錄

```
giga-file-service/
├─ AGENT.md / GEMINI.md / README.md
├─ .gitlab-ci.yml             check(typecheck、test、db:check-2012)、develop → deploy-test(主機 2)
├─ docs/                      PRD(總綱)、ARCHITECTURE、API、DATABASE、STORAGE、MIGRATION、LEGACY-INVENTORY、
│                             SECURITY-CHECKLIST、IMPL-PLAN、DEPLOYMENT、本文件、DevelopmentProcess/、Gherkin/(files/、legacy/、TEST-MAP)
└─ file-api/                  程式與套件(使用者要求放一層子目錄)
   ├─ src/
   │  ├─ server.ts            進入點:連 SQL Server、準備檔案根目錄、啟動;每小時清除逾期暫存檔
   │  ├─ app.ts               Fastify 組裝:X-Internal-Token 驗證(dev 可 DEV_SKIP_TOKEN)、actorOf(身分 → 資料範圍)、
   │  │                       multipart(串流、50 MB)、統一錯誤格式、/healthz /readyz /openapi.json、setupGateway(監控 + 自動註冊)
   │  ├─ config.ts            設定(部署區、FILE_ROOT、FILE_DB_*、_FILE 機密、暫存保留時數)
   │  ├─ errors.ts、openapi.ts(x-gateway、權限宣告)、print-openapi.ts、migrate.ts(Drizzle migrator,紀錄表 file_svc)
   │  ├─ routes/files.ts      /v1/files*、/v1/storage(API.md §2):schema、x-permission、x-gherkin、格式轉換
   │  ├─ modules/
   │  │  ├─ files/            file-service.ts(上傳整批檢查 → commit → 寫 DB、下載、綁定、軟刪除、暫存清除)、
   │  │  │                    file-types.ts(白名單、檔頭、inline、Content-Disposition)、types.ts(FileRepo 介面、資料範圍)、
   │  │  │                    drizzle-repo.ts(SQL Server 實作:OUTPUT、OFFSET FETCH)
   │  │  ├─ storage/          local-store.ts({yyyy}/{mm}/{uuid}、tmp → rename、SHA-256、路徑不逃出根目錄、容量)
   │  │  └─ legacy/           readonly-source.ts(只有讀取介面的 ReadonlyFs)、inventory.ts(盤點統計、Markdown 報告)
   │  ├─ cli/inventory.ts     舊來源唯讀盤點 CLI(F0;filebackend / smbbackend / portalsolar 預設範圍)
   │  └─ db/                  schema.ts(file_svc 三張表)、client.ts(連線池、Drizzle、2012 語法檢查 logger)、
   │                          sql2012-guard.ts(Gateway 複本)
   ├─ db/migrations/          drizzle-kit 產生、人工審查(不可修改已套用的)
   ├─ db/dba/                 01-create-schema.sql(使用者以 sa 執行:schema file_svc、file_app / file_migrate)
   ├─ scripts/check-sql2012.ts
   ├─ test/                   files / units / inventory(單元)、int/(SQL Server 2012)、legacy/(真實舊來源唯讀)、helpers.ts
   ├─ deploy/                 docker-compose.yml(測試區,加入 Gateway 網路)、test.env.example、host2-set-secrets.sh
   ├─ Dockerfile、.env.example、drizzle.config.ts、package.json(gateway.project = giga-file-service)
   └─ data/                   本機執行期資料(檔案根目錄、盤點報告;不進版控)
```

## 2. 對外介面

| 介面 | 位置 | 狀態 |
| --- | --- | --- |
| `/api/file/files*`、`/api/file/storage` | API §2 | ✅ 已實作(待測試區部署) |
| `/api/file/storage/backup/retry`、`/inventory/*` | API §2 | 規劃(F2、F4) |
| `/api/file/bpm/*` | API §3 | 規劃 |
| `/api/file/compat/{fb,smb,portal}/*` | API §4 | 規劃 |
| GigaItApp「Gateway 管理 › 檔案管理」 | PRD §8 | 規劃(F3) |

## 3. 已知差異

- 白名單為暫定(PRD §11 #6);資料範圍為第一版(PRD §11 #5)。
- 暫存檔清除在 API 行程內每小時執行(worker 行程於 F2 NAS 備份時再拆)。
- 上傳經 BFF 時受 10 MB 限制,50 MB 直送待 Gateway Nginx 變更(DEPLOYMENT §4)。
