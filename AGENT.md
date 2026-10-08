# GigaNexus 附件服務(giga-file-service)— AI 協作準則(AGENT.md)

> 本文件是 AI 程式助手(Claude、Gemini 等)在本專案中的行為準則,所有 AI 協作開發必須遵守。
> 由 Gateway 專案(`giga-api-gateway-bff`)根目錄 `AGENT.md`、下游後端樣本 `samples/node-backend/AGENT.md` 與 `GigaItApp/AGENT.md` 整理合併,並依本專案調整。
> Gateway 的規格(`../giga-api-gateway-bff/docs/`)仍是上位規範;本文件與之不一致時,**先指出差異,不要自行決定以哪一邊為準**。
> 本專案的設計決策(D1–D15)與工作項目(F0–F7)以 **[docs/FILE-PLAN.md](docs/FILE-PLAN.md)** 為準;跨專案規則(相對路徑、用 BFF 路由表找 API、跨 repo 修改)見 `../giga-api-gateway-bff/AGENT.md` **§10 多專案工作區**。

---

## AI 分工(Claude / Gemini)— 必讀

同 `../giga-api-gateway-bff/AGENT.md` §10.8(有出入時以該節為準)。

寫程式、寫測試、寫文件由 **Claude** 負責;**Gemini** 只負責執行測試、撰寫測試報告,以及非邏輯性的修改。Gemini 開始動手前,先確認工作在下表 Gemini 欄是 ✅。

| 工作 | Claude | Gemini |
| --- | --- | --- |
| 寫程式(新功能、業務邏輯、API、權限、資料存取、狀態管理、修 bug、重構) | ✅ | ❌ |
| 寫測試(單元 / 整合 / E2E 測試碼、測試用 fixture 的邏輯) | ✅ | ❌ |
| 寫文件(`AGENT.md`、`README.md`、`docs/`、`PROJECT-MAP.md`、架構 JSON、修正紀錄) | ✅ | ❌(測試報告除外) |
| 執行測試(既有的 `npm test`、`test:int`、E2E、`cargo test` 等)並撰寫測試報告 | ✅ | ✅ |
| 非邏輯性修改:前端 mock / 假資料、版面與樣式(CSS、間距、顏色、排版)、畫面文案錯字 | ✅ | ✅ |
| CI/CD 與容器、部署設定 | ✅ | ❌ **禁止** |

**Gemini 禁止修改**(即使只改一行):

- CI/CD:`.gitlab-ci.yml`、`ci-templates/`、Runner 設定。
- 容器與部署:`Dockerfile*`、`docker-compose*`、`.dockerignore`、`deploy/`、`nginx/`、部署腳本、`.env*`、`Web.config` / 發佈設定。
- 相依與建置設定:`package.json`(含 scripts)、lock 檔、`Cargo.toml`、`tsconfig*.json`、`vite.config.*`。
- 資料庫:schema、migration、seed。
- 測試程式碼:測試失敗時**不得**為了讓測試通過而修改測試或程式、跳過測試、調整門檻;把失敗寫進報告,交給 Claude 處理。

**測試報告**(Gemini 執行測試後必寫):

- 位置:該 repo 的 `docs/test-reports/YYYY-MM-DD-<主題>.md`。
- 內容:1. 環境(分支 / commit、部署區、執行的指令)2. 結果(通過 / 失敗 / 略過數量)3. 失敗項目(測試名稱、錯誤訊息摘錄)4. **可能問題**:推測原因、相關檔案與行號、重現步驟、影響範圍 5. 建議交給 Claude 處理的項目。
- 測試全部通過也要寫,並列出觀察到的潛在風險(警告訊息、偶發失敗、執行過慢等)。

**判斷不了是否屬於「非邏輯性」時,一律視為邏輯修改**:不動程式,寫進報告交給 Claude。

---

## 0. 專案定位(先讀)

| 項目 | 內容 |
| --- | --- |
| 做什麼 | GigaNexus 共用的附件(檔案)服務:上傳 / 下載 / 清單 / 軟刪除 / 單據綁定;檔案存放於主機 WSL 並排程備份到 NAS;**BPM 表單附件唯讀查詢與下載**;**舊系統(GeneralBackend `filebackend` / `SMBbackend`、166 PortalSolar)檔案的 UUID 對照與同步**;舊格式相容層 |
| 狀態 | **規劃中,尚無程式碼**。規劃文件 [docs/FILE-PLAN.md](docs/FILE-PLAN.md)(決策 D1–D15 已定案,§13 仍有待確認事項);工作項目 F0–F7 的時程**以 NexusPlan 甘特圖為準**,文件不列日期 |
| 系統代碼 / API | `file`;新 API `/api/file/files*`、`/api/file/bpm/*`;盤點 `/api/file/inventory/*`;舊格式相容層 `/api/file/compat/{fb,smb,portal}/*`(D15) |
| 服務代碼 / port | `file-api` / **51272**(D2 定案;**尚未登記**於 `../giga-api-gateway-bff/docs/BACKEND-GUIDE.md` §3.3,開發前先向 Gateway 負責人登記,不可自行換 port) |
| 登入 | **後端不實作登入**,只信任 Gateway 的 `X-Internal-Token`。唯一例外:舊格式相容路由(舊前端沒有 Gateway 登入,規劃 `auth_mode = public` + Nginx 內網白名單,需 IT 核准,FILE-PLAN §8.3 規則 4) |
| 檔案存放 | 主機 WSL `/srv/giga-files/{env}`(容器內 `/data/files`),實體路徑 `{yyyy}/{mm}/{file_uuid}`(不帶副檔名與原檔名);不放 `/mnt/c`(D5) |
| 備份 | WSL 以 cifs 掛載 NAS `\\10.10.130.31\docker-folder`,排程補傳並驗 SHA-256(D6);NAS 上 `giga-files/{env}/` 為新服務備份,`giga-files/legacy/portalsolar/` 為 166 原檔名鏡像 |
| 資料庫 | SQL Server 10.10.130.220:`giganexus_file`(正式)、`giganexus_file_test`(測試 + 開發),帳號分 app / migrate(D7);SQL Server 2012 限制見 `../giga-api-gateway-bff/docs/DATABASE.md` §0 |
| 畫面 | 不在本 repo:GigaItApp「檔案管理」頁(F3,`../GigaItApp/`),上傳元件之後進 `@giganexus/web-kit` |
| 工作區 | 與 `../giga-api-gateway-bff/`(上位規範、SDK、路由表)、`../GigaItApp/`(畫面與選單權限)同層;舊系統唯讀參考:`../old_PortalSolar/`、`../../GeneralBackend/`(`filebackend`、`SMBbackend`)、`../../BPM/bpmcomonent/`(舊前端 `FileUpload.vue`、`SPfileUpload.vue`)、`../../BPMbackend/`。後三者不在 GigaNexus 工作區同層,**不在你的環境時說明「未讀取」,不要猜內容** |
| 尚未登記 | 本 repo 尚未加入 Gateway `AGENT.md` §10.2 專案登記表、工作區 `AGENT.md` §3 導航與 `GigaNexusAIPlan/architecture/workspace.json`;這些在其他 repo,**要改先說明並取得同意**(§10.5) |

---

## 1. 先思考再動手

- **動手之前,先說明你的理解與假設**:用 1–3 句話摘要打算做什麼、為什麼這樣做。
- **有疑問先問,不要猜**;需求有多種解讀時,列出選項讓人類選擇。FILE-PLAN §13 列出的待確認事項,**未定案前不要自行決定**。
- 規格以 Gateway `docs/` 與 [docs/FILE-PLAN.md](docs/FILE-PLAN.md) 為準;程式與規格不一致時先指出差異。

```
❌ 看到舊 SMB 有路徑穿越問題,順手去修 ../../GeneralBackend/SMBbackend
✅ 「SMB localdownload 未檢查 ../(FILE-PLAN §3.2)。D9 決定舊服務程式一律不動,
    我只在 §3.2 記錄,新服務只用 UUID 取檔、不接受路徑參數。這樣對嗎?」
```

## 2. 簡單優先

- 用最少的程式碼解決當前問題,不寫「未來可能用到」的程式碼(例:防毒掃描只保留擴充點,不實作,FILE-PLAN §11)。
- 不要「順便」引入新套件、設計模式或抽象層;新增套件前先說明理由(Gateway `docs/TECH-STACK.md` 已列的優先)。
- 舊格式相容層是**過渡用**,不為它設計通用框架;舊端點只做 FILE-PLAN §8.3 列的、有人使用的那幾支。

## 3. 外科手術式修改

- **只改必須改的地方**;不順手整理、重構、改名不相關的程式碼,不改動既有格式(格式交給 Prettier)。
- **不要修改已套用的 migration**;資料表變更一律新增 migration。
- **舊系統的程式碼、資料表、檔案目錄一律不改**(§7.1)。
- 修改 Gateway 專案(`nginx/`、`deploy/`、`docs/`)時同樣只動必要的幾行,並在 Gateway 的 `docs/DevelopmentProcess/` 留紀錄;其他 repo 先說明並取得同意。
- 每次修改都要能用一句話解釋為什麼改。

## 4. 目標導向執行

- 先定義成功標準,**優先對應 FILE-PLAN 的工作項目(F0–F7)與完成標準**,自己迭代到達成為止;遇到阻塞(缺資訊、權限不足、尚未登記 port、缺帳密)才停下來回報。
- 行為變更時同步更新:FILE-PLAN(決策 / API / 資料表)→ OpenAPI `x-gherkin` 場景 → 測試;API 變更同步 `docs/` 對應章節。
- 完成時簡要說明:做了什麼、執行了哪些指令、結果如何;**完成工作項目後,依工作區慣例更新 NexusPlan 甘特圖**(`../GigaNexusAIPlan/`),文件本身不寫日期。

## 5. 失敗要明確說

- **失敗就說失敗**,不能把「靜默跳過」包裝成「完成」;附上錯誤訊息與 `requestId`。
- 不用空的 `catch {}` 吞錯誤;確實要降級時記錄 log 並在註解說明依據。
- **檔案服務特別要求**:NAS 備份失敗、SHA-256 不符、舊來源讀不到、5144 取檔失敗,一律記錄並反映在狀態欄位(`backup_status`、`sync_state`),**不可回報成功**。
- 沒有查詢到不等於不存在:查不了(沒帳密、連不到 166 / NAS / 190)時明確說「未查詢」,不可當作「沒有檔案」。
- 不要刪除或放寬失敗的測試來讓測試通過。

---

## 6. 部署區與設定

| 項目 | `dev`(本機開發) | `test`(測試區) | `prod`(正式區) |
| --- | --- | --- | --- |
| `GW_ENV` | `dev` | `test` | `prod` |
| 自動註冊 API | 不註冊 | 啟動時註冊為 Gateway **草稿** | 啟動時註冊為 Gateway **草稿** |
| 機密(DB 帳密、5144 金鑰、166 / NAS 帳密) | 可由 `.env` 給值 | `*_FILE`(Docker secret) | **只接受** `*_FILE` |
| 資料庫 | `giganexus_file_test` | `giganexus_file_test` | `giganexus_file` |
| `BPM_ENV`(BPM 附件環境,D10) | `test`(對 191) | `test`(對 191) | `prod`(對 190) |
| 檔案根目錄 | 本機暫存目錄(不要寫入 `/srv/giga-files`) | `/srv/giga-files/test` | `/srv/giga-files/prod` |
| 日誌等級預設 | `debug` | `info` | `info` |

- 部署區只有這三個值;不要新增 `staging`、`product` 之類的名稱。缺少必要設定時**啟動失敗**,不要加預設值繞過檢查。
- 部署沿用 Gateway 的 GitLab 流程:`develop` → 主機 2 測試區,`main` → 主機 3 正式區,容器加入 Gateway Docker 網路(`../giga-api-gateway-bff/docs/DEPLOYMENT.md`、BACKEND-GUIDE §3.1)。**本 repo 目前尚未建立 GitLab remote。**
- 上傳走 Nginx `auth_request` 直送 file-api、放寬到 50 MB(D4-B)需要改 Gateway 的 `nginx/`:**跨 repo 修改,先說明並取得同意**;BFF 全域 10 MB 限制不動。
- 主機連線慣例(`ssh host1` / `host2`、WSL 內 Docker 指令)見工作區 `../AGENT.md` §5;需要 root 的指令請本人執行。

---

## 7. 檔案服務專屬規則

### 7.1 舊系統一律唯讀

- **不修改**:GeneralBackend `filebackend`、`SMBbackend`(含 `localdownload` 路徑穿越問題,D9)、`old_PortalSolar`、BPM 的 `BPMbackend` 與 `bpmcomonent`。只讀程式碼以確認 API 欄位與行為。
- **不改舊資料表**:`webFileUpload`、`smbFileUpload`、PortalSolar 各表只讀(D8);對照一律寫在本專案資料庫的 `legacy_file_map`。
- **不寫入舊來源**:166 `PortalSolar`、190 `SDSFILES`、NAS 的 `CP` / 備份目錄對同步與搬遷程式皆**唯讀**(掛載用 `ro`、帳號用唯讀帳號)。NAS 上只寫本專案自己的 `giga-files/` 目錄。
- 舊來源有多個值得注意的現況(中文原檔名、同名覆蓋、備份是時間點快照、`robocopy /is /e` 不刪除),見 FILE-PLAN §3、§10.1、§10.2,**處理前先讀**。

### 7.2 機密與帳密

- 帳密、金鑰(DB、NAS、166 唯讀帳號、NaNa 唯讀帳號、BPM 5144 的 `X-API-Key`)**不入版控、不寫進映像檔、不貼進對話或日誌**;以 `<NAME>_FILE` 指向 Docker secret,dev 用 `.gitignore` 已涵蓋的 `.env`。
- **AI 不開啟 `.env`、不讀取機密檔、不要求使用者貼帳密**:需要寫入主機機密時,寫成腳本(隱藏輸入)交給使用者執行。
- BPM 5144 金鑰**只放 file-api 機密設定**(D10);`../../BPMbackend` 的註解裡有明碼金鑰,**不要複製到本專案**,也不要貼進文件或對話。

### 7.3 儲存與下載安全(FILE-PLAN §6、§11)

- **對外只用 `file_uuid`**:不暴露遞增 id、實體路徑、原檔名;**不提供依路徑或檔名取檔的 API**(舊 SMB `localdownload` 的問題不可重現);相容層以對照表查詢,不直接組路徑。
- 寫檔:先寫 `tmp/` 並同時計算 SHA-256,完成後 `rename` 到正式路徑,**再寫資料庫**;失敗清掉暫存,不留資料庫有紀錄但沒有檔案(反之亦然)。
- 組合路徑時一律 `path.resolve` 後確認落在根目錄之下(含分隔符的前綴比對),不信任任何來自請求或資料庫的路徑片段。
- 副檔名白名單 + 檢查檔頭(magic number);拒絕執行檔與腳本;`image/svg+xml` 一律以附件下載、不 inline。
- 回應標頭:`X-Content-Type-Options: nosniff`;`Content-Disposition` 同時給 ASCII 後備名與 `filename*=UTF-8''…`;下載需要暴露此標頭給跨來源前端。
- 軟刪除只設 `deleted_at`,**不刪實體檔、不刪 NAS**;實體清除是保留期限後的獨立排程(期限待定,FILE-PLAN §13)。
- 上傳、下載、刪除、綁定寫 `file_access_log`(含 `X-Request-Id`)。

### 7.4 舊格式相容層(`/api/file/compat/*`,FILE-PLAN §8.3)

- 路徑與 JSON **照舊服務**(`success`、`message`、`file(s)`、`data`、`total`、欄位大小寫),以 `../../GeneralBackend/filebackend/controllers/sqlFileController.js`、`../../GeneralBackend/SMBbackend/controllers/smbFileUploadController.js` 與舊前端實際解析的欄位為準;**不要憑印象改欄位**。
- **隔離**:相容層程式放在獨立目錄,新 API(Gateway 統一錯誤格式、UUID)與舊格式互不影響;錯誤回舊式 `{ success:false, message, error }` 只限相容路由,**不可外洩到新 API**。
- 只做 FILE-PLAN §8.3 列的端點;舊的不寫 DB 直接存取、目錄瀏覽、`/api/localdownload` 等**不複製**。
- 資料原樣存取:`platform`、`sourceApplication`(`{應用}_{類別}`,**不拆**)、`sourceNumber`;舊 `id` 對照 `legacy_file_map.legacy_key`,新檔 `id` 用 UUID;SMB 的 `path` 兩種格式(`{uuid}{副檔名}`、中文原檔名)都要查得到。
- 相容層測試要用舊服務回應當 golden 樣本比對欄位;**舊前端切換前**,該來源的歷史檔案必須已搬完並驗證(FILE-PLAN §8.3 規則 5)。

### 7.5 166 同步與 NAS 拉取(FILE-PLAN §10.1、§10.2)

- 方向**單向**:166 → NAS(原檔名鏡像)→ 配 UUID → WSL(UUID 副本);新系統自己上傳的檔案不寫回 166。
- **冪等、可重試、不刪**:每個檔案走 `sync_state` 狀態線;來源檔不見只標 `source_missing_at`;同名內容被覆蓋時舊列 `is_current = 0`、新增一列新 UUID,舊版保留。
- 掃描先比大小與修改時間,不變的檔案不重算 SHA-256、不重讀內容;大型目錄(例 `ESLearning` 影片)限速或獨立排程。
- 與資料庫的對照只出報表(斷鏈、孤兒),**不修改任何舊資料**。
- 要同步的目錄範圍、同名覆蓋處理、頻率、切換日等見 FILE-PLAN §13,**未定案前不要擴大範圍**。

### 7.6 BPM 附件(FILE-PLAN §3.5、§8.2、D10–D12)

- **唯讀**:不提供 BPM 附件的上傳、修改、刪除;BPM 仍是正本。
- 環境由設定 `BPM_ENV` 決定(測試 → 191、正式 → 190);**不提供** `/test/*` 這種以路徑切換環境的 API。
- 依單號查詢**完全比對**(不使用 `LIKE '%單號%'`);取檔優先用 `localAttachmentPath.filePath`,沒有才依目錄規則嘗試,找到的段數記入快取。
- 以 `file.bpm.read` 控管;每次下載寫 `file_access_log`(`action = bpm_download`)。

### 7.7 資料庫

- SQL Server 2012:只用 2012 支援的語法(不可用 JSON 函式、`CREATE OR ALTER`、`DROP … IF EXISTS`、`STRING_AGG`、`TRIM` 等,`DATABASE.md` §0);連線設定比照 Gateway(內網 SQL Server 2012 `encrypt: false`,已有決議)。
- 資料表與欄位 `snake_case`;`DATETIME2` 存 UTC,畫面轉台灣時間;`UNIQUEIDENTIFIER` 的值由**應用端**產生(v4),不依賴 DB。
- 只在容器 SQL Server(2022)驗證過的項目,**不可宣稱「已在 SQL Server 2012 驗證」**。
- 資料存取方式(Drizzle 或 `mssql` 直連)於 F1 建立骨架時依 Gateway `docs/TECH-STACK.md` 決定,決定後寫回本節。

---

## 8. API 規則(Gateway 接入)

通用規範以 `../giga-api-gateway-bff/docs/BACKEND-GUIDE.md` 與 `../giga-api-gateway-bff/samples/node-backend/AGENT.md` 為準,以下是本專案的重點:

| 項目 | 規範 |
| --- | --- |
| 新增 API 前先查 | 先查 Gateway 既有路由(`gw:lookup`,Gateway `AGENT.md` §10.4),查到相近的先回報並詢問;**查不到(沒有 `GW_BASE_URL` / API Key)要明確說「未查詢」**,不可當作沒有重複 |
| 路徑 | 後端 `/v1/{resource}`(名詞複數、kebab-case)對外自動成為 `/api/file/{resource}`;相容層需要不同對外路徑時以 `x-gateway-path` 指定 |
| 必填欄位 | 每支 API 的 `operationId`(`file.{resource}.{action}`)、`summary`、`description`、`x-permission`、`x-gherkin`;`npm test` 會檢查,**不要放寬** |
| 權限 | 讀 / 寫分開:`file.object.read` / `upload` / `delete`、`file.bpm.read`、`file.storage.read` / `manage`、`file.legacy.read`(FILE-PLAN §8);畫面節點由 GigaItApp 的 `deploy/gateway-rbac.yaml` 登記並綁定,不在本 repo |
| 身分 | 只信任 `X-Internal-Token`(`req.identity`),**dev 也不略過驗證**;資料層級(公司、部門、`source_system`)由後端依 Token 過濾,無權回 `403 DATA_ACCESS_DENIED` |
| 錯誤 | `throw new AppError(status, code, message, details?)`,格式 `{ code, message, requestId, details? }`;自訂代碼以 **`FILE_`** 開頭,不可用 `UNAUTHENTICATED`、`PERMISSION_DENIED`、`CSRF_INVALID`、`UPSTREAM_*`;不回傳堆疊或 SQL(相容層例外格式見 §7.4) |
| 冪等 | `GET` / `PUT` / `DELETE` 必須冪等(Gateway 只重試冪等方法);上傳 `POST` 建議支援 `Idempotency-Key` |
| 分頁 | `page`、`pageSize`(上限 100)、回應 `{ items, total, page, pageSize }`;**清單由後端篩選與分頁**;相容層 `/sql-files` 的特例見 FILE-PLAN §8.3 規則 8 |
| 大小 | 單檔上限 50 MB(D3);預設逾時 10 秒,下載與同步以串流與背景工作處理,不要把整個檔案讀進記憶體 |
| 標頭 | 不回 `Set-Cookie`、CORS、`Server`、`X-Powered-By` |
| 日誌 / 監控 | 寫入 `X-Request-Id`;接入 giga-observe(BACKEND-GUIDE §11);**不在日誌記錄原檔名以外的敏感內容、帳密、Token** |

---

## 9. 專案慣例

| 項目 | 規範 |
| --- | --- |
| 語言 / 框架 | TypeScript(ESM、`strict`、`noUncheckedIndexedAccess`)+ Fastify 5,路由以 plugin 組織;Gateway 共用功能一律用 `@giganexus/backend-sdk`(設定、Token 驗證、自動註冊、路由查詢),不自己重寫 |
| 命名 | 變數 / 函式 `camelCase`,型別 `PascalCase`,常數 `UPPER_SNAKE_CASE`,檔名 `kebab-case.ts`;資料表 / 欄位 `snake_case` |
| 格式 | Prettier(單引號、`printWidth` 160、尾逗號) |
| 註解語言 | 繁體中文,註明對應規格章節(例 `(FILE-PLAN §8.3)`、`(AGENT.md §7.3)`);同一檔案內統一 |
| 測試資料 | 一律用**假檔案與暫存目錄**;不對 166、NAS、190 / 191 的正式資料做寫入測試;不可在瀏覽器輸入真實帳密 |

### 9.1 專案地圖與設計原則

- **專案地圖:`docs/PROJECT-MAP.md`(尚未建立,F1 建立骨架時一併建立)**。開發新功能後,在同一個變更內更新(新增 / 搬移 / 刪除目錄或主要檔案、職責改變、新 API 都要反映),並更新開頭的「最後更新」;規則見 Gateway `AGENT.md` §10.7.1。
- 核心設計原則依 Gateway `AGENT.md` §10.7.2 的 **TypeScript / Node.js 後端**列。預計的分層(F1 建立後以專案地圖為準):

| 原則 | 本專案做法 |
| --- | --- |
| 職責分離 | `routes/`(新 API)與 `compat/`(舊格式相容層)只做 schema 驗證、權限宣告與格式轉換;儲存、備份、同步、BPM 取檔、對照表的邏輯放 `modules/<功能>/`(核心,不直接依賴 Fastify,I/O 以參數或介面注入);資料庫、檔案系統、NAS、5144 為基礎設施 |
| 原始碼根目錄 | `src/`;建置輸出 `dist/`(不進版控),`tsconfig.build.json` 只編 `src/` |
| 集中測試 | `test/`(與 `src/` 平行,`unit/`、`integration/`、`e2e/` 分開);同步與備份用暫存目錄與假檔案測 |

- 既有程式與原則不同之處列在專案地圖「已知差異」,不要為了符合原則大規模搬移(§3)。

### 常用指令

目前沒有程式碼;F1 建立骨架後補上。預期比照 `samples/node-backend`:`npm run dev`(`GW_ENV=dev`)、`npm test`、`npm run typecheck`、`npm run build`、`npm run -s openapi`、`npm run -s gw:lookup -- <關鍵字>`。

---

## 10. 參考文件

| 文件 | 路徑 | 說明 |
| --- | --- | --- |
| **附件服務計畫** | `docs/FILE-PLAN.md` | 決策 D1–D15、舊系統盤點、架構、儲存與備份、資料表、API(§8.1 新 API、§8.2 BPM、§8.3 相容層)、166 同步(§10.2)、安全、工作項目 F0–F7、待確認事項 |
| 專案地圖 | `docs/PROJECT-MAP.md` | 尚未建立(F1);建立後**開發新功能必須更新**(§9.1) |
| 本專案說明 | `README.md` | 定位與規劃摘要 |
| Gateway 開發手冊 | `../giga-api-gateway-bff/AGENT.md` | 通用準則來源;§10 多專案工作區、§10.8 AI 分工 |
| 下游後端準則 | `../giga-api-gateway-bff/samples/node-backend/AGENT.md` | 部署區、API 必填欄位、新增 API 前先查 |
| 後端規範 | `../giga-api-gateway-bff/docs/BACKEND-GUIDE.md` | §2.1 分工、§3 port 登記、§4 身分、§5 API 規範、§7.5 自動註冊、§11 監控 |
| 資料庫 | `../giga-api-gateway-bff/docs/DATABASE.md` | §0 SQL Server 2012 相容性限制 |
| 部署 | `../giga-api-gateway-bff/docs/DEPLOYMENT.md` | CI/CD、WSL2 Docker(§6)、機密 |
| 前端規範 | `../giga-api-gateway-bff/docs/FRONTEND-GUIDE.md` | §7.5 畫面權限(「檔案管理」頁的選單 / Tab / 按鈕) |
| 畫面範本 | `../GigaItApp/docs/UI-GUIDE.md` | F3「檔案管理」頁沿用 |
| 舊系統(唯讀) | `../../GeneralBackend/`、`../old_PortalSolar/`、`../../BPM/bpmcomonent/`、`../../BPMbackend/` | 對照舊 API、欄位與呼叫端;**只讀不改**(§7.1) |
| 工作區入口 | `../AGENT.md`、`../PROJECT-MAP.md` | 專案導航、主機連線、架構資料維護 |

---

## 11. 修正紀錄

每次修正都要留紀錄,**新紀錄加在檔案最上方**(檔案於第一次需要記錄時建立)。

| 文件 | 路徑 | 說明 |
| --- | --- | --- |
| Bug 修改紀錄 | `docs/DevelopmentProcess/BugFix.md` | Bug 修改 |
| 新增功能紀錄 | `docs/DevelopmentProcess/NewFeatures.md` | 新功能(含 F0–F7 各項完成) |
| 後端修改紀錄 | `docs/DevelopmentProcess/BackendCorrection.md` | `src/`、`deploy/`、migration |

動到 Gateway 專案(`nginx/`、`deploy/`、`docs/`)或 GigaItApp 時,**在那個 repo** 另留紀錄;每個 repo 各自 commit,訊息註明配合的另一個 repo 與 commit。

**開發新功能後,同一個變更內更新 `docs/PROJECT-MAP.md`**(§9.1),並在紀錄的「檔案」欄列出。規劃變更同步更新 `docs/FILE-PLAN.md` 的版本資訊。

### 紀錄格式
```
## YYYY-MM-DD 標題
- 工作項目:F0–F7(無則省略)
- 內容:改了什麼、為什麼
- 檔案:主要修改的檔案
- 驗證:執行的指令與結果(對照哪些舊服務回應、用了哪些假資料)
```
