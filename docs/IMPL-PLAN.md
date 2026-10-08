# GigaNexus 附件服務 — 實作計畫

> 依據 [PRD.md](PRD.md) **v0.8** §10,將工作項目 F0–F7 拆解為交付物與驗收條件(原 FILE-PLAN §12)。**時程以 NexusPlan 甘特圖(工作流 W11「附件服務」)為準**,本文不列日期。
> 相關文件:[ARCHITECTURE.md](ARCHITECTURE.md)、[API.md](API.md)、[DATABASE.md](DATABASE.md)、[STORAGE.md](STORAGE.md)、[MIGRATION.md](MIGRATION.md)、[DEPLOYMENT.md](DEPLOYMENT.md)、[SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md)。

---

## 1. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件版本 | v0.3(2026-10-08,F1 程式與測試完成、F0 NAS / 166 盤點完成;前置 P2–P4 完成);v0.2(2026-10-08,P3 改為在 `giganexus_gw` 建 schema `file_svc`、P4 定案 Drizzle(D7、D17));v0.1(2026-10-08,自 FILE-PLAN v0.6 §12 拆出;補交付物、驗收、前置工作與甘特圖對照) |

## 2. 進度與里程碑

| 代號 | 項目 | 甘特圖 | 狀態 | 相依 |
| --- | --- | --- | --- | --- |
| — | 規劃與文件(FILE-PLAN → `docs/` 文件組) | W11-1 | ✅ 完成 | — |
| F0 | 舊系統盤點 | W11-2 | 🔶 進行中(122 log、兩張舊表統計、**NAS 與 166 唯讀盤點完成**(LEGACY-INVENTORY §6);190 `SDSFILES` 與 `WebAppDb` 逐筆對照待唯讀帳號) | — |
| F1 | file-api 主體 | W11-3 | 🔶 程式與測試完成(單元 53、SQL Server 2012 整合 5、真實來源唯讀 3);**待測試區部署**(主機 2 機密 + develop) | 規劃;前置 §3 |
| F2 | NAS 備份 | W11-4 | 未開始 | F1 |
| F6 | BPM 附件(唯讀) | W11-5 | 未開始 | F1 |
| F3 | GigaItApp 檔案管理頁 | W11-6 | 未開始 | F1 |
| F7 | 舊格式相容層 | W11-7 | 未開始 | F1 |
| ◆ | 測試區附件服務可用 | W11-M | — | F2、F3、F6 |
| F4 | 舊系統對照與同步 | W11-8 | 未開始 | F0、◆ |
| F5 | 搬遷(視 F4 決策) | W11-9 | 暫停(待 F4 決策) | F4 |

## 3. 前置工作

| # | 項目 | 負責 | 需要於 |
| --- | --- | --- | --- |
| P1 | ✅ GitLab / GitHub 專案已建立;CI `.gitlab-ci.yml`(check、develop → deploy-test)。**主機 2 需先執行 `file-api/deploy/host2-set-secrets.sh`** | 使用者執行腳本 | 測試區部署 |
| P2 | ✅ 已登記 `file-api` 51272(BACKEND-GUIDE §3.3,2026-10-08) | — | — |
| P3 | ✅ `giganexus_gw_test`、`giganexus_gw_poc_test` 已建 schema `file_svc` 與 `file_app` / `file_migrate`(2026-10-08,`file-api/db/dba/01-create-schema.sql`);migration 已套用到 `giganexus_gw_test`。正式區之後在 `giganexus_gw` 另建 | — | — |
| P4 | ~~決定資料存取方式~~ ✅ 已定案:Drizzle ORM(版本同 Gateway)+ 舊資料庫 `mssql` 唯讀(D17) | — | — |
| P5 | NAS 子目錄與服務帳號(PRD §11 #4) | IT | F2 |
| P6 | NaNa 唯讀帳號、5144 金鑰更換(PRD §11 #8) | BPM 負責人 | F6 |
| P7 | 166、190 `SDSFILES`、NAS `CP` 唯讀存取(PRD §11 #3、#11、#12) | IT | F0 |
| P8 | 允許的檔案類型清單(PRD §11 #6) | 需求方 | F1 |
| P9 | 相容路由公開 + 內網白名單、CORS(PRD §11 #15、#16) | IT / Gateway 負責人 | F7 |

## 4. 工作拆解

### F0 舊系統盤點

- 交付物:166 `PortalSolar`、190 `SDSFILES`、GeneralBackend 兩個 files 目錄(NAS 備份)的目錄 / 檔案數 / 容量清單;各 DB 存檔名的表與欄位清單;孤兒檔 / 斷鏈統計;結果寫回 [LEGACY-INVENTORY.md](LEGACY-INVENTORY.md)。
- 已完成:122 filebackend log 觀察、`webFileUpload`、`smbFileUpload` 依平台 / 應用的筆數統計(LEGACY-INVENTORY §4)。
- 待做:`files/CRM`、`ERP`、`MES` 是否為孤兒檔;SMB 83 筆在 NAS `CP` 是否都有實體檔、75 筆原檔名的實際位置;166 / 190 目錄(需 P7)。
- 驗收:清單可重現(附查詢 / 掃描指令),查不到的來源明確標「未查詢」。

### F1 file-api 主體

- 交付物:repo 骨架(Fastify 5 + TypeScript,比照 itapp-api / `samples/node-backend`)、`docs/PROJECT-MAP.md` 更新、Drizzle schema 與 migration(schema `file_svc`、紀錄表分開,[DATABASE.md](DATABASE.md) §0.2)、[API.md](API.md) §2 上傳 / 下載 / 清單 / 綁定 / 刪除、暫存清除排程、OpenAPI(含 `x-permission`、`x-gherkin`)、自動註冊、giga-observe 接入、Dockerfile 與 CI。
- 驗收:`npm test`、`typecheck`、`build` 通過;測試區經 Gateway 實測上傳 / 下載(含中文檔名)/ 刪除;50 MB 直送路徑(需 Gateway Nginx 變更,[DEPLOYMENT.md](DEPLOYMENT.md) §4);SECURITY-CHECKLIST S1–S13、S19–S21 更新狀態。

### F2 NAS 備份

- 交付物:主機 2 WSL cifs 掛載(使用者執行)、補傳排程、SHA-256 驗證、失敗告警、還原 CLI、「儲存與備份」API([STORAGE.md](STORAGE.md) §2)。
- 驗收:上傳後 N 分鐘內 `backup_status = done`;拔 NAS 期間上傳正常、恢復後自動補;刪除 WSL 檔後以 CLI 還原且 SHA 相符。

### F3 GigaItApp 檔案管理頁

- 交付物:GigaItApp「Gateway 管理」目錄下新增「檔案管理」選單,四個 Tab(PRD §8);`deploy/gateway-rbac.yaml` 登記節點並綁定 API;可複製的上傳元件。
- 驗收:測試區以有 / 無權限帳號各操作一次,Tab 與按鈕依權限顯示;在 GigaItApp 留修正紀錄。

### F6 BPM 附件(唯讀)

- 交付物:[API.md](API.md) §3 三支 API、目錄段數快取;GigaItApp「BPM 附件」Tab。
- 驗收:測試區對 191、正式區對 190 實測下載(含中文檔名、三種目錄段數);單號完全比對不誤配;每次下載有 `file_access_log`。可在 F1 之後、與 F2 並行。

### F7 舊格式相容層

- 交付物:[API.md](API.md) §4:`fb`(7 支)、`smb`(6 支)路由與舊 JSON 一致;`portal` 靜態網址相容視需要。
- 驗收:以舊服務回應當 golden 樣本比對欄位;以舊前端 `FileUpload.vue` / `SPfileUpload.vue` 在測試區對測;規則 5(歷史檔案已搬完)滿足後才切換舊前端。

### F4 舊系統對照與同步

- 交付物:`legacy_file_map` 產生、NAS 備份拉取([MIGRATION.md](MIGRATION.md) §2)、166 同步工作(§3:掃描 → NAS 鏡像 → UUID → WSL → 每日增量 → 對照報表)、「舊系統」Tab 唯讀查詢;與需求方逐系統決策。
- 驗收:乾跑報表(孤兒、斷鏈、重複)經需求方確認;實際同步後檔案數 / 容量 / SHA-256 對得上;重跑不重複產生資料。

### F5 搬遷(視 F4 決策)

- 另訂計畫;切換步驟見 [MIGRATION.md](MIGRATION.md) §3。

## 5. 測試策略

| 層級 | 內容 |
| --- | --- |
| 單元 | 路徑安全、檔案類型、檔名編碼、相容層欄位轉換、BPM 目錄規則、同步狀態線 |
| 整合 | `giganexus_gw_poc_test` 的 schema `file_svc`(`test:int` 只清空 `file_svc`,不可指向 `giganexus_gw_test`)+ 暫存目錄;NAS 與 166 以本機目錄模擬 |
| E2E | 測試區經 Gateway(含 Nginx 直送、權限、相容層) |
| 行為規格 | Gherkin 寫在 OpenAPI `x-gherkin`,另於 [Gherkin/](Gherkin/README.md) 保留驗收場景;對照 [Gherkin/TEST-MAP.md](Gherkin/TEST-MAP.md) |

- 一律用假檔案與暫存目錄,**不對 166、NAS、190 / 191 正式資料做寫入測試**。

## 6. 完成定義(Definition of Done)

- 測試通過、不放寬既有檢查;失敗明確回報。
- 相關文件同步(API / DATABASE / PROJECT-MAP / SECURITY-CHECKLIST / Gherkin TEST-MAP)。
- `docs/DevelopmentProcess/` 留紀錄;跨 repo 修改在對方 repo 留紀錄。
- 測試區完成即更新甘特圖(W11-*)進度與備註。
