# GigaNexus 附件服務(giga-file-service)— 產品需求說明

> 各系統共用一個附件服務:上傳後只保存 `file_uuid`,下載一律經 Gateway 驗證身分與權限;檔案存主機 WSL、排程備份到 NAS;舊系統先不動,提供盤點、對照與舊格式相容層。
> **時程以 NexusPlan 甘特圖(W11「附件服務」)為準**,本文不列日期。
> 本文件是總綱:各主題拆成獨立文件(§12),本文只保留摘要、決策與連結。上位規範為 Gateway [`docs/`](../../giga-api-gateway-bff/docs/);與之不一致時先指出差異。

---

## 1. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 產品名稱 | GigaNexus 附件服務(repo `giga-file-service`,服務 `file-api`) |
| 文件版本 | **v0.8**(2026-10-08) |
| 版本紀錄 | v0.8(2026-10-08,D7 改為沿用 Gateway 資料庫 `giganexus_gw` 的獨立 schema `file_svc`,不另建資料庫;新增 D17:本服務資料表用 Drizzle ORM、舊資料庫唯讀查詢用 `mssql`);v0.7(2026-10-08,原 `FILE-PLAN.md` 依 Gateway `docs/` 做法拆分為 PRD + 主題文件(§12 對照表);新增 D16:畫面放 GigaItApp「Gateway 管理」目錄下的「檔案管理」選單(§8));v0.6(2026-10-08,納入 `smbFileUpload` 統計、相容層規則 12);v0.5(2026-10-08,`webFileUpload` 依平台 / 應用統計、相容層規則 10–11);v0.4(2026-10-08,122 生產區 log 觀察、相容層規則 8、9);v0.3(2026-10-08,D2–D15 定案);v0.2(2026-10-07,納入 BPM 表單附件);v0.1(2026-10-07,初稿) |
| 相關文件 | Gateway [BACKEND-GUIDE.md](../../giga-api-gateway-bff/docs/BACKEND-GUIDE.md) §2.1、§3、§4、[DEPLOYMENT.md](../../giga-api-gateway-bff/docs/DEPLOYMENT.md) §6、[FRONTEND-GUIDE.md](../../giga-api-gateway-bff/docs/FRONTEND-GUIDE.md) §7.5;GigaItApp `docs/UI-GUIDE.md`;舊系統 `GeneralBackend/filebackend`、`GeneralBackend/SMBbackend`、`old_PortalSolar` |

## 2. 產品概述

| 項目 | 內容 |
| --- | --- |
| 情境 | 各系統需要上傳附件(單據附件、證照、文件、圖片);舊做法分散在三套系統、命名與權限不一,PortalSolar 的檔案甚至可以不登入直接以網址下載 |
| 範圍 | 新服務 `file-api`(上傳 / 下載 / 清單 / 軟刪除 / 單據綁定);WSL 本機存放 + NAS 備份;GigaItApp「Gateway 管理 › 檔案管理」頁;舊系統盤點與 UUID 對照表;**BPM 表單附件唯讀查詢與下載**(經 190 / 191 既有取檔服務 :5144);舊格式相容層 |
| 不在範圍 | 舊系統的程式修改與檔案搬遷(F4 盤點後另行決策,F5);**BPM 附件的上傳、修改、刪除**(附件仍由 BPM 系統管理);線上預覽 / 轉檔;版本控管(同一檔案多版本);防毒掃描(保留擴充點,[SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) S14) |

## 3. 目標

1. **一個共用附件服務**:各系統不再各自存檔,上傳後只保存 `file_uuid`。
2. **對外只用 UUID**:不暴露遞增 id、實體路徑或原檔名,下載一律經 Gateway 驗證身分與權限。
3. **檔案不遺失**:主機 WSL 存放,排程備份到 NAS,備份狀態可在畫面上查。
4. **舊系統先不動**:filebackend、SMBbackend、PortalSolar 照常運作;新服務提供盤點與對照,搬不搬之後一起決定。
5. **畫面可複製**:GigaItApp「檔案管理」先做,上傳元件之後給員工入口網與其他系統共用。

## 4. 現況摘要

詳見 [LEGACY-INVENTORY.md](LEGACY-INVENTORY.md)。

| 舊來源 | 摘要 | 詳見 |
| --- | --- | --- |
| GeneralBackend `filebackend`(122:5124) | `webFileUpload` 151 筆 / 有效 103;下載用遞增 id、無登入;呼叫者全是 BPM `FileUpload.vue`;`/sql-files` 只回 50 筆的缺陷 | §1、§4.1–§4.2 |
| GeneralBackend `SMBbackend`(122:5125) | `smbFileUpload` 83 筆 / 有效 54(75 筆中文原檔名);呼叫者全是 BPM `SPfileUpload.vue`;`localdownload` 路徑穿越(只記錄不修) | §2、§4.3 |
| 166 PortalSolar | 原檔名存放、公開網址不需登入;多個目錄(證照、照片、行事曆、影片…);`SDSFILES` 疑為 BPM 附件 | §3 |
| BPM 表單附件 | NaNa `NoCmDocument` + 5144 取檔服務;金鑰在呼叫端、單號 `LIKE` 比對、無權限檢查 | §5 |

## 5. 決策

| # | 問題 | 結論 | 狀態 |
| --- | --- | --- | --- |
| D1 | 放在 BFF 還是新 repo | **新 repo `giga-file-service`**。理由:BACKEND-GUIDE §2.1 BFF 不做業務邏輯;檔案 I/O 與 Gateway 隔離;§3.2 已將 51270–51279 留給「共用服務(公告、檔案等)」 | ✅ 定案 |
| D2 | 服務代碼 / port | `file-api` / **51272**(51271 為 portal-api);系統代碼 `file`,API `/api/file/*` | ✅ 定案;實作時登記 BACKEND-GUIDE §3.3 |
| D3 | 單檔大小上限 | **50 MB**(≤ 10 MB 可直接經 BFF,更大走 D4-B) | ✅ 定案 |
| D4 | 大檔上傳路徑 | **B**:上傳由 Nginx `auth_request` 問 BFF 權限後**直接串流到 file-api**,只對上傳路由放寬到 50 MB;BFF 全域 10 MB 不動([ARCHITECTURE.md](ARCHITECTURE.md) §2) | ✅ 定案 |
| D5 | 檔案存放位置 | WSL 檔案系統 `/srv/giga-files/{env}`(bind mount 進容器);**不放 `/mnt/c`**([STORAGE.md](STORAGE.md) §1) | ✅ 採用 |
| D6 | NAS 備份方式 | WSL 以 cifs 掛載 `\\10.10.130.31\docker-folder`,**排程補傳**(非雙寫),DB 記錄備份狀態;路徑 `giga-files/{env}/`([STORAGE.md](STORAGE.md) §2) | ✅ 採用;子目錄與服務帳號待 IT(§11 #4) |
| D7 | 資料庫 | **沿用 Gateway 的 `giganexus_gw`**(正式)/ `giganexus_gw_test`(開發 + 測試)/ `giganexus_gw_poc_test`(整合測試),資料表放獨立 schema **`file_svc`**;只有少量資料表,不另建資料庫。帳號為本服務自有、只授權 `file_svc`,分 app / migrate;migration 紀錄表與 Gateway 分開([DATABASE.md](DATABASE.md) §0、§0.2) | ✅ 定案(2026-10-08 改;建 schema 與帳密由使用者執行) |
| D8 | 舊系統 UUID | **新服務建對照表 `legacy_file_map`,不改舊資料表**([DATABASE.md](DATABASE.md) §3) | ✅ 採用;逐系統去留 F4 決策 |
| D9 | 舊服務 | 照常運作、**程式碼一律不修改**(含 SMB `localdownload` 路徑問題,只記錄) | ✅ 定案:風險靠「新服務上線後舊服務下線」處理 |
| D10 | BPM 附件怎麼接 | **file-api 直接查 NaNa(唯讀帳號)並向 5144 取檔、串流回傳**,不經 BPMbackend;5144 金鑰只放 file-api 機密設定;測試區 → 191、正式區 → 190([API.md](API.md) §3) | ✅ 採用 |
| D11 | BPM 附件要不要複製一份 | **先不複製**(即時代理);若 5144 不穩或需長期保存,再改為「第一次下載時快取到 WSL 並寫 `legacy_file_map`」 | ✅ 採用 |
| D12 | BPM 附件的權限 | 第一版:有 `file.bpm.read` 的人可依單號查詢 / 下載;「只能看自己是申請人或簽核人的表單」列為後續 | ✅ 定案 |
| D13 | 舊檔怎麼進新服務 | **從 NAS 備份拉取**(SMB → `CP`、filebackend → `docker-folder` 各平台目錄),唯讀掛載、先乾跑對照 DB、再複製;不碰 122 主機與舊程式([MIGRATION.md](MIGRATION.md) §2) | ✅ 定案(方向);NAS 唯讀帳號與備份頻率待確認 |
| D14 | 166 PortalSolar 怎麼處理 | **166 → NAS(原檔名鏡像)→ 配 UUID → WSL(UUID 副本)**;對照表新建、舊表不動;並行期間 166 為正本,每日增量單向同步;同名被覆蓋時保留舊版([MIGRATION.md](MIGRATION.md) §3) | ✅ 定案(方向);掃描範圍待 F0 |
| D15 | 新舊服務網址 | **分開**:新 API `/api/file/files*`、`/api/file/bpm/*`;舊格式相容層 `/api/file/compat/{fb\|smb\|portal}/*`(路徑與 JSON 照舊,舊前端只換基底網址);盤點 `/api/file/inventory/*`([API.md](API.md) §4) | ✅ 定案(方向) |
| D16 | 畫面放哪裡 | **GigaItApp「Gateway 管理」目錄(`it.group.gateway`)下新增「檔案管理」選單**,與「服務與路由」「權限查詢」「架構觀測」並列;規格見 §8,節點於 F3 登記到 GigaItApp `deploy/gateway-rbac.yaml` | ✅ 定案(2026-10-08) |
| D17 | 資料存取方式 | **`file_svc` 資料表用 Drizzle ORM + drizzle-kit**(版本鎖定與 Gateway 相同);舊資料庫(NaNa、`WebAppDb`、PortalSolar)唯讀查詢用 `mssql` 直接寫參數化 SQL,比照 Gateway `db/external/`。效能兩者相同(同一個驅動),選 Drizzle 是為了型別安全、自動產生 migration、與 Gateway 一致([DATABASE.md](DATABASE.md) §0.1) | ✅ 定案(2026-10-08) |

## 6. 架構摘要

file-api(:51272)位於 Gateway 之後:一般 API 經 BFF 轉發(`X-Internal-Token`),上傳由 Nginx `auth_request` 後直送;file-api 讀寫 `giganexus_gw` 的 schema `file_svc` 與 WSL 檔案,worker 負責 NAS 補傳與舊系統同步;BPM 附件由 file-api 直連 NaNa 與 5144 即時代理。詳見 [ARCHITECTURE.md](ARCHITECTURE.md);部署見 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 7. 功能需求摘要

| 功能 | 摘要 | 詳見 |
| --- | --- | --- |
| 新服務檔案 API | 上傳(兩段式:先上傳拿 UUID,單據存檔時 `bind`)、清單、資訊、下載、軟刪除、儲存統計、盤點查詢 | [API.md](API.md) §2 |
| BPM 附件(唯讀) | 依單號完全比對列出、資訊、下載;環境由設定決定 | [API.md](API.md) §3 |
| 舊格式相容層 | `fb` 7 支、`smb` 6 支,路徑與 JSON 照舊;規則 1–12 | [API.md](API.md) §4 |
| 儲存與備份 | WSL `{yyyy}/{mm}/{uuid}`、原子寫入、NAS 排程補傳與 SHA-256 驗證、還原 CLI | [STORAGE.md](STORAGE.md) |
| 資料表 | `file_object`、`file_access_log`、`legacy_file_map` | [DATABASE.md](DATABASE.md) |
| 舊系統對照與同步 | 盤點 → 對照 → 逐系統決策;NAS 備份拉取;166 單向每日增量同步 | [MIGRATION.md](MIGRATION.md) |

## 8. 畫面:GigaItApp「Gateway 管理 › 檔案管理」(D16)

畫面在 GigaItApp(`/it/`),不在本 repo。選單放在既有目錄 **`it.group.gateway`(Gateway 管理)** 之下,與「服務與路由」「權限查詢」「架構觀測」並列。

| Tab | 內容 | 綁定權限 |
| --- | --- | --- |
| 檔案清單 | 新服務的檔案;篩選、上傳、下載、刪除;顯示備份狀態 | `file.object.read`;按鈕 `upload` / `delete` |
| BPM 附件 | 輸入單號查詢表單附件、下載;顯示來源環境(190 正式 / 191 測試) | `file.bpm.read` |
| 舊系統 | filebackend / SMB / PortalSolar / SDSFILES 盤點結果(數量、容量、是否已對照 UUID),唯讀 | `file.legacy.read` |
| 儲存與備份 | WSL 用量、NAS 備份成功 / 待補 / 失敗、重試 | `file.storage.read`;按鈕 `retry` |

權限節點(規劃,F3 寫入 GigaItApp `deploy/gateway-rbac.yaml`,沿用 `it.gw-*` 命名;節點名稱、排序可在「選單管理」調整):

| 代碼 | 名稱 | kind | parent | sort | includes |
| --- | --- | --- | --- | --- | --- |
| `it.gw-file.read` | 檔案管理 | menu | `it.group.gateway` | 40 | — |
| `it.gw-file.objects` | 檔案清單 | tab | `it.gw-file.read` | 10 | `file.object.read` |
| `it.gw-file.upload` | 上傳 | button | `it.gw-file.objects` | 10 | `file.object.upload` |
| `it.gw-file.delete` | 刪除 | button | `it.gw-file.objects` | 20 | `file.object.delete` |
| `it.gw-file.bpm` | BPM 附件 | tab | `it.gw-file.read` | 20 | `file.bpm.read` |
| `it.gw-file.legacy` | 舊系統 | tab | `it.gw-file.read` | 30 | `file.legacy.read` |
| `it.gw-file.storage` | 儲存與備份 | tab | `it.gw-file.read` | 40 | `file.storage.read` |
| `it.gw-file.retry` | 重試備份 | button | `it.gw-file.storage` | 10 | `file.storage.manage` |

- `file.*` 權限代碼由 file-api 的 OpenAPI `x-permission` 產生([API.md](API.md) §1.1);節點綁定規則見 Gateway FRONTEND-GUIDE §7.5。
- **F3 前不先寫入 `gateway-rbac.yaml`**:CI 每次部署都會套用該檔,沒有頁面與 API 時先建選單會出現空頁。
- 畫面沿用 GigaItApp `docs/UI-GUIDE.md`;上傳元件(拖放、多檔、進度、大小 / 類型檢查)做成可複製的元件,之後放進 `@giganexus/web-kit` 給入口網與其他系統用。

## 9. 安全摘要

只接受 Gateway 身分、只用 UUID 取檔、路徑安全、檔案類型白名單 + 檔頭檢查、SVG 不 inline、5144 金鑰只在 file-api、舊來源唯讀、操作寫 `file_access_log`。逐項狀態見 [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md)。

## 10. 範圍與里程碑

| 代號 | 項目 | 甘特圖 |
| --- | --- | --- |
| F0 | 舊系統盤點 | W11-2 |
| F1 | file-api 主體 | W11-3 |
| F2 | NAS 備份 | W11-4 |
| F6 | BPM 附件(唯讀) | W11-5 |
| F3 | GigaItApp 檔案管理頁 | W11-6 |
| F7 | 舊格式相容層 | W11-7 |
| F4 | 舊系統對照與同步 | W11-8 |
| F5 | 搬遷(視 F4 決策) | W11-9 |

交付物、驗收與前置工作見 [IMPL-PLAN.md](IMPL-PLAN.md);進度以甘特圖為準。

## 11. 待確認事項

編號沿用 FILE-PLAN §13,不重新編號。

1. ~~單檔大小上限(D3)、上傳走法(D4)~~ 已定案(50 MB、Nginx 直送)。
2. ~~資料庫名稱與主機(D7)~~ 已定案(比照 Gateway);建庫與帳密由使用者執行。
3. 是否可唯讀存取 `\\10.10.130.166\PortalSolar`、`\\10.10.130.190\SDSFILES` 與相關 DB 進行 F0 盤點。**2026-10-08**:166 與 NAS 已可由開發機唯讀存取並完成盤點([LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §6);190 `SDSFILES` 與 `WebAppDb` 唯讀帳號仍待提供(逐筆對照需要)。
4. NAS 子目錄與服務帳號;保留期限(軟刪除後多久實體清除)。
5. 第一個接入的業務系統是哪個(決定 `source_system` 與資料層級規則的第一版)。
6. 允許的檔案類型清單。
7. BPM 5144 取檔服務:程式放在哪裡、什麼語言;`localAttachmentPath` 由誰、多久寫入一次,`filePath` 是否完整可直接用。
8. 5144 金鑰更換(目前金鑰已在 BPM repo 的程式註解中),以及 NaNa 唯讀帳號。
9. ~~BPM 附件權限(D12)~~ 已定案(第一版 `file.bpm.read`)。
10. PortalSolar `SDSFILES` 是否就是 BPM 附件([LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §3)。
11. 「NAS 備份拉取」(D13)的 NAS 唯讀帳號,以及舊主機 robocopy 備份的排程頻率(決定切換前差異有多大)。
12. 166 的**唯讀**服務帳號(同步只讀不寫);要同步的目錄範圍(依 F0 結果,例如 `ESLearning` 影片、`PersonalPic` 員工照片、`html`、`EIP` 是否納入)。
13. 同名被覆蓋時保留舊版(建議)還是只留最新;每日增量的時段;正式切換日與 166 上傳凍結的方式。
14. 舊服務使用者**已確認**([LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §4):兩個舊服務的資料列全部是 BPM 表單前端。**2026-10-08 NAS 盤點**(§6.1):`CRM`、`MES` 為空目錄、沒有 `ERP`;`CP` 有 101 個檔案(資料表 83 筆)、filebackend 110 個(資料表 151 筆),逐筆對照待 `WebAppDb` 唯讀帳號。
15. 相容路由 `auth_mode = public` 與 Nginx 內網白名單([API.md](API.md) §4.4 規則 4)是否接受。
16. Gateway 的 CORS 白名單可否加入 BPM 前端來源並暴露 `Content-Disposition`(規則 9);相容層 `/sql-files` 無 `limit` 時回全部(規則 8)是否接受。

## 12. 文件索引與拆分對照

| 文件 | 內容 | 原 FILE-PLAN 章節 |
| --- | --- | --- |
| 本文件 `PRD.md` | 概述、目標、決策 D1–D17、畫面、待確認事項 | §1、§2、§4、§9、§13 |
| [LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) | 舊系統盤點與使用統計 | §3.1–§3.5 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架構、Gateway 限制與上傳路徑 | §3.6、§5 |
| [STORAGE.md](STORAGE.md) | WSL 存放、NAS 備份 | §6 |
| [DATABASE.md](DATABASE.md) | 資料表 | §7 |
| [API.md](API.md) | 新 API、BPM 附件、相容層 | §8.1–§8.3 |
| [MIGRATION.md](MIGRATION.md) | 對照、NAS 拉取、166 同步 | §10、§10.1、§10.2 |
| [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) | 資安檢查清單 | §11 |
| [IMPL-PLAN.md](IMPL-PLAN.md) | 工作項目、前置工作、測試策略 | §12 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 部署區、CI/CD、掛載、機密、Gateway 端變更 | (新增;整理自 §5、`AGENT.md` §6) |
| [PROJECT-MAP.md](PROJECT-MAP.md) | 目錄與職責 | (新增) |
| [Gherkin/](Gherkin/README.md) | 行為規格與測試對照 | (新增) |
| [DevelopmentProcess/](DevelopmentProcess/) | 修正紀錄 | (新增) |
