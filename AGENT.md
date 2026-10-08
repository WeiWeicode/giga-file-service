# GigaNexus 附件服務(giga-file-service)— AI 協作準則(AGENT.md)

> 本文件是 AI 程式助手(Claude、Gemini 等)在本專案中的行為準則,所有 AI 協作開發必須遵守。
> 由 Gateway 專案(`giga-api-gateway-bff`)根目錄 `AGENT.md`、下游後端樣本 `samples/node-backend/AGENT.md` 與 `GigaItApp/AGENT.md` 整理合併,並依本專案調整。
> Gateway 的規格(`../giga-api-gateway-bff/docs/`)仍是上位規範;本文件與之不一致時,**先指出差異,不要自行決定以哪一邊為準**。
> 本專案的設計決策(D1–D17)以 **[docs/PRD.md](docs/PRD.md)** 為準,各主題見 PRD §12 文件索引,工作項目(F0–F7)見 [docs/IMPL-PLAN.md](docs/IMPL-PLAN.md);跨專案規則(相對路徑、用 BFF 路由表找 API、跨 repo 修改)見 `../giga-api-gateway-bff/AGENT.md` **§10 多專案工作區**。

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

## Claude 子代理 — 必讀

同 `../giga-api-gateway-bff/AGENT.md` §10.9(有出入時以該節為準)。**只適用 Claude Code**,Gemini 等其他 AI 略過本節。

Claude 把搜尋、審查、資安檢查、除錯、測試、重構交給子代理,主對話只收結論。子代理定義放在**使用者層級** `~/.claude/agents/`(Windows:`%USERPROFILE%\.claude\agents\`),所有專案共用;範本在 `../giga-api-gateway-bff/docs/claude-agents/`。

| 子代理 | 用途 | 模型 | 權限 |
| --- | --- | --- | --- |
| `explore` | 快速搜尋、分析大型程式碼庫結構 | `haiku`(Haiku 5.5) | 唯讀 |
| `code-reviewer` | 檢查程式碼品質、命名與最佳實踐 | `sonnet`(Sonnet 5.5) | 唯讀 |
| `security-auditor` | 偵測安全漏洞(硬編碼密鑰、注入、權限缺漏、不安全的 API) | `opus`(Opus 5.5) | 唯讀 |
| `debugger` | 追蹤錯誤日誌,做根本原因分析 | `sonnet`(Sonnet 5.5) | 唯讀 |
| `test-runner` | 執行既有測試並分析覆蓋率 | `haiku`(Haiku 5.5) | 唯讀(只執行指令,不改檔) |
| `refactor-assistant` | 安全地重構與拆分模組 | `sonnet`(Sonnet 5.5) | 可修改檔案 |

檔名是「子代理名稱 + `.md`」。模型欄寫別名,自動對應該系列的最新版(括號內是 2026-10 的版本)。

**開工前檢查**(每個工作階段一次):

1. 確認 `~/.claude/agents/` 有上表 6 個檔案。
2. 缺少任何一個時,**先列出缺少的子代理,詢問使用者是否建立**;未經同意不要建立。使用者不建立時照常工作,改由主對話自己做。
3. 使用者同意後,從範本複製缺少的檔案;**已存在的同名檔不覆蓋**(內容與範本不同時列出差異,詢問是否更新):

   ```bash
   mkdir -p ~/.claude/agents && cp -n ../giga-api-gateway-bff/docs/claude-agents/*.md ~/.claude/agents/
   ```

   範本不在工作區(沒有 clone `giga-api-gateway-bff`)時,說明「範本未讀取」,詢問使用者要先 clone 該 repo,還是依上表欄位建立。
4. 建立後告訴使用者:**重新開啟 Claude Code 工作階段**後子代理才會載入。

**何時使用**:

| 情境 | 子代理 |
| --- | --- |
| 不熟的模組、要跨多個目錄找東西、回答「X 在哪裡 / 怎麼串」 | `explore` |
| 一批修改完成、commit 前 | `code-reviewer` |
| 動到登入、權限(RBAC)、Token / API Key、機密與 `.env*`、檔案上傳下載、對外 API、Nginx / 部署設定 | `security-auditor`(可與 `code-reviewer` 同時進行) |
| 錯誤 log、測試失敗或線上異常,原因不明 | `debugger` |
| 修改後跑 lint / 型別檢查 / 測試、查覆蓋率 | `test-runner` |
| 改名、搬檔、拆模組等不改變行為的重構 | `refactor-assistant` |

- 單一檔案、位置已知的小任務不必開子代理。
- 子代理看不到主對話的內容:委派時寫清楚任務範圍,以及本 AGENT.md 的相關規則(外科手術式修改、跨 repo 修改要先同意、測試失敗不得改測試、寫入測試區或共用資料庫前要先問)。
- 子代理的結果由主對話**檢查後**才採用或回報;回報時說明哪些是子代理做的。子代理回報「通過」不等於已驗證。
- 子代理不經手密碼與機密值;`security-auditor` 回報時遮蔽密鑰,只寫檔案與行號。

---

## 0. 專案定位(先讀)

| 項目 | 內容 |
| --- | --- |
| 做什麼 | GigaNexus 共用的附件(檔案)服務:上傳 / 下載 / 清單 / 軟刪除 / 單據綁定;檔案存放於主機 WSL 並排程備份到 NAS;**BPM 表單附件唯讀查詢與下載**;**舊系統(GeneralBackend `filebackend` / `SMBbackend`、166 PortalSolar)檔案的 UUID 對照與同步**;舊格式相容層 |
| 狀態 | **F1 file-api 主體已實作並通過測試(待測試區部署)**;程式在 `file-api/`(repo 根目錄只放文件與 CI)。規劃文件以 [docs/PRD.md](docs/PRD.md) 為總綱(決策 D1–D17 已定案,§11 仍有待確認事項;主題文件見 §12);工作項目 F0–F7 的時程**以 NexusPlan 甘特圖為準**,文件不列日期 |
| 系統代碼 / API | `file`;新 API `/api/file/files*`、`/api/file/bpm/*`;盤點 `/api/file/inventory/*`;舊格式相容層 `/api/file/compat/{fb,smb,portal}/*`(D15) |
| 服務代碼 / port | `file-api` / **51272**(D2 定案;**尚未登記**於 `../giga-api-gateway-bff/docs/BACKEND-GUIDE.md` §3.3,開發前先向 Gateway 負責人登記,不可自行換 port) |
| 登入 | **後端不實作登入**,只信任 Gateway 的 `X-Internal-Token`。唯一例外:舊格式相容路由(舊前端沒有 Gateway 登入,規劃 `auth_mode = public` + Nginx 內網白名單,需 IT 核准,`docs/API.md` §4.4 規則 4) |
| 檔案存放 | 主機 WSL `/srv/giga-files/{env}`(容器內 `/data/files`),實體路徑 `{yyyy}/{mm}/{file_uuid}`(不帶副檔名與原檔名);不放 `/mnt/c`(D5) |
| 備份 | WSL 以 cifs 掛載 NAS `\\10.10.130.31\docker-folder`,排程補傳並驗 SHA-256(D6);NAS 上 `giga-files/{env}/` 為新服務備份,`giga-files/legacy/portalsolar/` 為 166 原檔名鏡像 |
| 資料庫 | SQL Server 10.10.130.220:**沿用 Gateway 的 `giganexus_gw`**(正式)/ `giganexus_gw_test`(開發 + 測試)/ `giganexus_gw_poc_test`(整合測試),資料表放 schema **`file_svc`**,本服務自有帳號只授權 `file_svc`、分 app / migrate(D7);存取用 Drizzle(D17);SQL Server 2012 限制見 `../giga-api-gateway-bff/docs/DATABASE.md` §0 |
| 畫面 | 不在本 repo:GigaItApp「Gateway 管理 › 檔案管理」選單(D16、PRD §8;F3,`../GigaItApp/`),上傳元件之後進 `@giganexus/web-kit` |
| 工作區 | 與 `../giga-api-gateway-bff/`(上位規範、SDK、路由表)、`../GigaItApp/`(畫面與選單權限)同層;舊系統唯讀參考:`../old_PortalSolar/`、`../../GeneralBackend/`(`filebackend`、`SMBbackend`)、`../../BPM/bpmcomonent/`(舊前端 `FileUpload.vue`、`SPfileUpload.vue`)、`../../BPM/BPMbackend/`(BPM 附件查詢,`db/controllers/BPM/AttachmentController.js`;注意 `../../BPMbackend/` 是另一個專案)。後三者不在 GigaNexus 工作區同層,**不在你的環境時說明「未讀取」,不要猜內容** |
| 登記 | 已加入 Gateway `AGENT.md` §10.2 專案登記表、工作區 `AGENT.md` §3 導航、`PROJECT-MAP.md` 與 `GigaNexusAIPlan/architecture/workspace.json`(2026-10-08);port 51272 **尚未**登記於 Gateway BACKEND-GUIDE §3.3。其他 repo 的修改**先說明並取得同意** |

---

## 1. 先思考再動手

- **動手之前,先說明你的理解與假設**:用 1–3 句話摘要打算做什麼、為什麼這樣做。
- **有疑問先問,不要猜**;需求有多種解讀時,列出選項讓人類選擇。PRD §11 列出的待確認事項,**未定案前不要自行決定**。
- 規格以 Gateway `docs/` 與 [docs/](docs/PRD.md)(PRD 與主題文件) 為準;程式與規格不一致時先指出差異。

```
❌ 看到舊 SMB 有路徑穿越問題,順手去修 ../../GeneralBackend/SMBbackend
✅ 「SMB localdownload 未檢查 ../(LEGACY-INVENTORY §2)。D9 決定舊服務程式一律不動,
    我只在 LEGACY-INVENTORY §2 記錄,新服務只用 UUID 取檔、不接受路徑參數。這樣對嗎?」
```

## 2. 簡單優先

- 用最少的程式碼解決當前問題,不寫「未來可能用到」的程式碼(例:防毒掃描只保留擴充點,不實作,SECURITY-CHECKLIST S14)。
- 不要「順便」引入新套件、設計模式或抽象層;新增套件前先說明理由(Gateway `docs/TECH-STACK.md` 已列的優先)。
- 舊格式相容層是**過渡用**,不為它設計通用框架;舊端點只做 API §4 列的、有人使用的那幾支。

## 3. 外科手術式修改

- **只改必須改的地方**;不順手整理、重構、改名不相關的程式碼,不改動既有格式(格式交給 Prettier)。
- **不要修改已套用的 migration**;資料表變更一律新增 migration。
- **舊系統的程式碼、資料表、檔案目錄一律不改**(§7.1)。
- 修改 Gateway 專案(`nginx/`、`deploy/`、`docs/`)時同樣只動必要的幾行,並在 Gateway 的 `docs/DevelopmentProcess/` 留紀錄;其他 repo 先說明並取得同意。
- 每次修改都要能用一句話解釋為什麼改。

## 4. 目標導向執行

- 先定義成功標準,**優先對應 IMPL-PLAN 的工作項目(F0–F7)與驗收條件**,自己迭代到達成為止;遇到阻塞(缺資訊、權限不足、尚未登記 port、缺帳密)才停下來回報。
- 行為變更時同步更新:PRD(決策)/ API.md / DATABASE.md→ OpenAPI `x-gherkin` 場景 → 測試;API 變更同步 `docs/` 對應章節。
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
| 資料庫(schema `file_svc`) | `giganexus_gw_test` | `giganexus_gw_test` | `giganexus_gw` |
| `BPM_ENV`(BPM 附件環境,D10) | `test`(對 191) | `test`(對 191) | `prod`(對 190) |
| 檔案根目錄 | 本機暫存目錄(不要寫入 `/srv/giga-files`) | `/srv/giga-files/test` | `/srv/giga-files/prod` |
| 日誌等級預設 | `debug` | `info` | `info` |

- 部署區只有這三個值;不要新增 `staging`、`product` 之類的名稱。缺少必要設定時**啟動失敗**,不要加預設值繞過檢查。
- 部署沿用 Gateway 的 GitLab 流程:`develop` → 主機 2 測試區,`main` → 主機 3 正式區,容器加入 Gateway Docker 網路(`../giga-api-gateway-bff/docs/DEPLOYMENT.md`、BACKEND-GUIDE §3.1)。**本 repo 目前尚未建立 GitLab remote。**
- 上傳走 Nginx `auth_request` 直送 file-api、放寬到 31m(單檔 30 MB 加 multipart 表頭)(D4-B)需要改 Gateway 的 `nginx/`:**跨 repo 修改,先說明並取得同意**;BFF 全域 10 MB 限制不動。
- 主機連線慣例(`ssh host1` / `host2`、WSL 內 Docker 指令)見工作區 `../AGENT.md` §5;需要 root 的指令請本人執行。

---

## 7. 檔案服務專屬規則

### 7.1 舊系統一律唯讀

- **不修改**:GeneralBackend `filebackend`、`SMBbackend`(含 `localdownload` 路徑穿越問題,D9)、`old_PortalSolar`、BPM 的 `BPMbackend` 與 `bpmcomonent`。只讀程式碼以確認 API 欄位與行為。
- **不改舊資料表**:`webFileUpload`、`smbFileUpload`、PortalSolar 各表只讀(D8);對照一律寫在本專案資料庫的 `legacy_file_map`。
- **不寫入舊來源**:166 `PortalSolar`、190 `SDSFILES`、NAS 的 `CP` / 備份目錄對同步與搬遷程式皆**唯讀**(掛載用 `ro`、帳號用唯讀帳號)。NAS 上只寫本專案自己的 `giga-files/` 目錄。
- 舊來源有多個值得注意的現況(中文原檔名、同名覆蓋、備份是時間點快照、`robocopy /is /e` 不刪除),見 LEGACY-INVENTORY、MIGRATION §2、§3,**處理前先讀**。

### 7.2 機密與帳密

- 帳密、金鑰(DB、NAS、166 唯讀帳號、NaNa 唯讀帳號、BPM 5144 的 `X-API-Key`)**不入版控、不寫進映像檔、不貼進對話或日誌**;以 `<NAME>_FILE` 指向 Docker secret,dev 用 `.gitignore` 已涵蓋的 `.env`。
- **AI 不開啟 `.env`、不讀取機密檔、不要求使用者貼帳密**:需要寫入主機機密時,寫成腳本(隱藏輸入)交給使用者執行。
- BPM 5144 金鑰**只放 file-api 機密設定**(D10);`../../BPM/BPMbackend` 的註解裡有明碼金鑰,**不要複製到本專案**,也不要貼進文件或對話。

### 7.3 儲存與下載安全(STORAGE、SECURITY-CHECKLIST)

- **對外只用 `file_uuid`**:不暴露遞增 id、實體路徑、原檔名;**不提供依路徑或檔名取檔的 API**(舊 SMB `localdownload` 的問題不可重現);相容層以對照表查詢,不直接組路徑。
- 寫檔:先寫 `tmp/` 並同時計算 SHA-256,完成後 `rename` 到正式路徑,**再寫資料庫**;失敗清掉暫存,不留資料庫有紀錄但沒有檔案(反之亦然)。
- 組合路徑時一律 `path.resolve` 後確認落在根目錄之下(含分隔符的前綴比對),不信任任何來自請求或資料庫的路徑片段。
- 副檔名白名單 + 檢查檔頭(magic number);拒絕執行檔與腳本;`image/svg+xml` 一律以附件下載、不 inline。
- 回應標頭:`X-Content-Type-Options: nosniff`;`Content-Disposition` 同時給 ASCII 後備名與 `filename*=UTF-8''…`;下載需要暴露此標頭給跨來源前端。
- 軟刪除只設 `deleted_at`,**不刪實體檔、不刪 NAS**;實體清除是保留期限後的獨立排程(期限待定,PRD §11 #4)。
- 上傳、下載、刪除、綁定寫 `file_access_log`(含 `X-Request-Id`)。

### 7.4 舊格式相容層(`/api/file/compat/*`,API §4)

- 路徑與 JSON **照舊服務**(`success`、`message`、`file(s)`、`data`、`total`、欄位大小寫),以 `../../GeneralBackend/filebackend/controllers/sqlFileController.js`、`../../GeneralBackend/SMBbackend/controllers/smbFileUploadController.js` 與舊前端實際解析的欄位為準;**不要憑印象改欄位**。
- **隔離**:相容層程式放在獨立目錄,新 API(Gateway 統一錯誤格式、UUID)與舊格式互不影響;錯誤回舊式 `{ success:false, message, error }` 只限相容路由,**不可外洩到新 API**。
- 只做 API §4.1、§4.2 列的端點;舊的不寫 DB 直接存取、目錄瀏覽、`/api/localdownload` 等**不複製**。
- 資料原樣存取:`platform`、`sourceApplication`(`{應用}_{類別}`,**不拆**)、`sourceNumber`;舊 `id` 對照 `legacy_file_map.legacy_key`,新檔 `id` 用 UUID;SMB 的 `path` 兩種格式(`{uuid}{副檔名}`、中文原檔名)都要查得到。
- 相容層測試要用舊服務回應當 golden 樣本比對欄位;**舊前端切換前**,該來源的歷史檔案必須已搬完並驗證(API §4.4 規則 5)。

### 7.5 166 同步與 NAS 拉取(MIGRATION §2、§3)

- 方向**單向**:166 → NAS(原檔名鏡像)→ 配 UUID → WSL(UUID 副本);新系統自己上傳的檔案不寫回 166。
- **冪等、可重試、不刪**:每個檔案走 `sync_state` 狀態線;來源檔不見只標 `source_missing_at`;同名內容被覆蓋時舊列 `is_current = 0`、新增一列新 UUID,舊版保留。
- 掃描先比大小與修改時間,不變的檔案不重算 SHA-256、不重讀內容;大型目錄(例 `ESLearning` 影片)限速或獨立排程。
- 與資料庫的對照只出報表(斷鏈、孤兒),**不修改任何舊資料**。
- 要同步的目錄範圍、同名覆蓋處理、頻率、切換日等見 PRD §11 #12、#13,**未定案前不要擴大範圍**。

### 7.6 BPM 附件(LEGACY-INVENTORY §5、API §3、D10–D12)

- **唯讀**:不提供 BPM 附件的上傳、修改、刪除;BPM 仍是正本。
- 環境由設定 `BPM_ENV` 決定(測試 → 191、正式 → 190);**不提供** `/test/*` 這種以路徑切換環境的 API。
- 依單號查詢**完全比對**(不使用 `LIKE '%單號%'`);取檔優先用 `localAttachmentPath.filePath`,沒有才依目錄規則嘗試,找到的段數記入快取。
- 以 `file.bpm.read` 控管;每次下載寫 `file_access_log`(`action = bpm_download`)。

### 7.7 資料庫

- SQL Server 2012:只用 2012 支援的語法(不可用 JSON 函式、`CREATE OR ALTER`、`DROP … IF EXISTS`、`STRING_AGG`、`TRIM` 等,`DATABASE.md` §0);連線設定比照 Gateway(內網 SQL Server 2012 `encrypt: false`,已有決議)。
- 資料表與欄位 `snake_case`;`DATETIME2` 存 UTC,畫面轉台灣時間;`UNIQUEIDENTIFIER` 的值由**應用端**產生(v4),不依賴 DB。
- 只在容器 SQL Server(2022)驗證過的項目,**不可宣稱「已在 SQL Server 2012 驗證」**。
- **資料存取(D17)**:`file_svc.*` 用 Drizzle ORM + drizzle-kit,版本鎖定與 Gateway 相同,升版須重新驗證;舊資料庫唯讀查詢用 `mssql` 參數化 SQL(比照 Gateway `bff/src/db/external/`)。
- **與 Gateway 共用 `giganexus_gw`**(`docs/DATABASE.md` §0.2):只讀寫 schema `file_svc`,**不碰 `gw.*`、不與 `gw.*` 建 FK**;migration 紀錄表放 `file_svc`(不可用 `drizzle` schema,Gateway 測試重設會清掉);`test:int` 只清 `file_svc`、只用 `giganexus_gw_poc_test`。

---

## 8. API 規則(Gateway 接入)

通用規範以 `../giga-api-gateway-bff/docs/BACKEND-GUIDE.md` 與 `../giga-api-gateway-bff/samples/node-backend/AGENT.md` 為準,以下是本專案的重點:

| 項目 | 規範 |
| --- | --- |
| 新增 API 前先查 | 先查 Gateway 既有路由(`gw:lookup`,Gateway `AGENT.md` §10.4),查到相近的先回報並詢問;**查不到(沒有 `GW_BASE_URL` / API Key)要明確說「未查詢」**,不可當作沒有重複 |
| 路徑 | 後端 `/v1/{resource}`(名詞複數、kebab-case)對外自動成為 `/api/file/{resource}`;相容層需要不同對外路徑時以 `x-gateway-path` 指定 |
| 必填欄位 | 每支 API 的 `operationId`(`file.{resource}.{action}`)、`summary`、`description`、`x-permission`、`x-gherkin`;`npm test` 會檢查,**不要放寬** |
| 權限 | 讀 / 寫分開:`file.object.read` / `upload` / `delete`、`file.bpm.read`、`file.storage.read` / `manage`、`file.legacy.read`(API §1.1);畫面節點由 GigaItApp 的 `deploy/gateway-rbac.yaml` 登記並綁定,不在本 repo |
| 身分 | 只信任 `X-Internal-Token`(`req.identity`),**dev 也不略過驗證**;資料層級(公司、部門、`source_system`)由後端依 Token 過濾,無權回 `403 DATA_ACCESS_DENIED` |
| 錯誤 | `throw new AppError(status, code, message, details?)`,格式 `{ code, message, requestId, details? }`;自訂代碼以 **`FILE_`** 開頭,不可用 `UNAUTHENTICATED`、`PERMISSION_DENIED`、`CSRF_INVALID`、`UPSTREAM_*`;不回傳堆疊或 SQL(相容層例外格式見 §7.4) |
| 冪等 | `GET` / `PUT` / `DELETE` 必須冪等(Gateway 只重試冪等方法);上傳 `POST` 建議支援 `Idempotency-Key` |
| 分頁 | `page`、`pageSize`(上限 100)、回應 `{ items, total, page, pageSize }`;**清單由後端篩選與分頁**;相容層 `/sql-files` 的特例見 API §4.4 規則 8 |
| 大小 | 單檔上限 30 MB(D3);預設逾時 10 秒,下載與同步以串流與背景工作處理,不要把整個檔案讀進記憶體 |
| 標頭 | 不回 `Set-Cookie`、CORS、`Server`、`X-Powered-By` |
| 日誌 / 監控 | 寫入 `X-Request-Id`;接入 giga-observe(BACKEND-GUIDE §11);**不在日誌記錄原檔名以外的敏感內容、帳密、Token** |

---

## 9. 專案慣例

| 項目 | 規範 |
| --- | --- |
| 語言 / 框架 | TypeScript(ESM、`strict`、`noUncheckedIndexedAccess`)+ Fastify 5,路由以 plugin 組織;Gateway 共用功能一律用 `@giganexus/backend-sdk`(設定、Token 驗證、自動註冊、路由查詢),不自己重寫 |
| 命名 | 變數 / 函式 `camelCase`,型別 `PascalCase`,常數 `UPPER_SNAKE_CASE`,檔名 `kebab-case.ts`;資料表 / 欄位 `snake_case` |
| 格式 | Prettier(單引號、`printWidth` 160、尾逗號) |
| 註解語言 | 繁體中文,註明對應規格章節(例 `(API.md §4.4)`、`(AGENT.md §7.3)`);同一檔案內統一 |
| 測試資料 | 一律用**假檔案與暫存目錄**;不對 166、NAS、190 / 191 的正式資料做寫入測試;不可在瀏覽器輸入真實帳密 |

### 9.1 專案地圖與設計原則

- **專案地圖:`docs/PROJECT-MAP.md`**。開發新功能後,在同一個變更內更新(新增 / 搬移 / 刪除目錄或主要檔案、職責改變、新 API 都要反映),並更新開頭的「最後更新」;規則見 Gateway `AGENT.md` §10.7.1。
- 核心設計原則依 Gateway `AGENT.md` §10.7.2 的 **TypeScript / Node.js 後端**列。分層(以專案地圖為準):

| 原則 | 本專案做法 |
| --- | --- |
| 程式目錄 | **程式與套件一律放 `file-api/`**(使用者要求,2026-10-08);repo 根目錄只放 `AGENT.md`、`GEMINI.md`、`README.md`、`docs/`、`.gitlab-ci.yml`、`.gitignore` |
| 職責分離 | `routes/`(新 API)與 `compat/`(舊格式相容層)只做 schema 驗證、權限宣告與格式轉換;儲存、備份、同步、BPM 取檔、對照表的邏輯放 `modules/<功能>/`(核心,不直接依賴 Fastify,I/O 以參數或介面注入);資料庫、檔案系統、NAS、5144 為基礎設施 |
| 原始碼根目錄 | `file-api/src/`;建置輸出 `file-api/dist/`(不進版控),`tsconfig.build.json` 只編 `src/` |
| 集中測試 | `file-api/test/`(與 `src/` 平行):`*.test.ts` 單元(暫存目錄、記憶體 repo)、`int/` SQL Server 整合、`legacy/` 真實舊來源唯讀冒煙;同步與備份用暫存目錄與假檔案測 |

- 既有程式與原則不同之處列在專案地圖「已知差異」,不要為了符合原則大規模搬移(§3)。

### 常用指令

皆在 `file-api/` 執行;`.env` 由 `.env.example` 複製(使用者填密碼,AI 不開啟)。

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 本機啟動(`GW_ENV=dev`,可設 `DEV_SKIP_TOKEN=1` 直連) |
| `npm test` | 單元測試(不連資料庫、不碰舊來源) |
| `npm run test:int` | SQL Server 2012 整合測試(`FILE_TEST_DB_NAME` = `giganexus_gw_poc_test`,會清空該庫的 `file_svc`) |
| `npm run test:legacy` | 真實 NAS / 166 唯讀冒煙(掃描前後快照相同才通過) |
| `npm run typecheck`、`npm run build`、`npm run format:check` | 型別、建置、格式 |
| `npm run db:generate` | schema 變更後產生 migration(離線;產生後人工審查並加註) |
| `npm run db:check-2012` | migration 的 SQL Server 2012 語法檢查 |
| `npm run db:migrate` | 以 `file_migrate` 套用 migration(紀錄表 `file_svc.__file_migrations`) |
| `npm run inventory -- [--source …] [--hash]` | 舊來源唯讀盤點,報告寫到 `data/inventory/` |
| `npm run -s openapi` | 輸出 OpenAPI |

---

## 10. 參考文件

| 文件 | 路徑 | 說明 |
| --- | --- | --- |
| **產品需求(總綱)** | `docs/PRD.md` | 概述、目標、**決策 D1–D17**、畫面(GigaItApp「Gateway 管理 › 檔案管理」)、**待確認事項(§11)**、文件索引與 FILE-PLAN 舊章節對照(§12) |
| 架構 | `docs/ARCHITECTURE.md` | 架構圖、Gateway 限制與上傳直送(D4-B) |
| API | `docs/API.md` | §2 新 API、§3 BPM 附件、§4 舊格式相容層(規則 1–12) |
| 資料庫 | `docs/DATABASE.md` | `file_object`、`file_access_log`、`legacy_file_map` |
| 儲存與備份 | `docs/STORAGE.md` | WSL 存放、NAS 備份 |
| 對照與同步 | `docs/MIGRATION.md` | §2 NAS 備份拉取、§3 166 同步 |
| 舊系統盤點 | `docs/LEGACY-INVENTORY.md` | filebackend、SMB、PortalSolar、122 使用統計、BPM 附件現況 |
| 資安檢查 | `docs/SECURITY-CHECKLIST.md` | S1–S21 做法與狀態 |
| 實作計畫 | `docs/IMPL-PLAN.md` | F0–F7 交付物 / 驗收、前置工作、測試策略、完成定義 |
| 部署 | `docs/DEPLOYMENT.md` | 部署區、CI/CD、掛載、機密、Gateway 端變更 |
| 行為規格 | `docs/Gherkin/` | README(預計場景)、TEST-MAP(場景 ↔ 測試) |
| 專案地圖 | `docs/PROJECT-MAP.md` | 目錄與職責;**開發新功能必須更新**(§9.1) |
| 本專案說明 | `README.md` | 定位與規劃摘要 |
| Gateway 開發手冊 | `../giga-api-gateway-bff/AGENT.md` | 通用準則來源;§10 多專案工作區、§10.8 AI 分工 |
| 下游後端準則 | `../giga-api-gateway-bff/samples/node-backend/AGENT.md` | 部署區、API 必填欄位、新增 API 前先查 |
| 後端規範 | `../giga-api-gateway-bff/docs/BACKEND-GUIDE.md` | §2.1 分工、§3 port 登記、§4 身分、§5 API 規範、§7.5 自動註冊、§11 監控 |
| 資料庫 | `../giga-api-gateway-bff/docs/DATABASE.md` | §0 SQL Server 2012 相容性限制 |
| 部署 | `../giga-api-gateway-bff/docs/DEPLOYMENT.md` | CI/CD、WSL2 Docker(§6)、機密 |
| 前端規範 | `../giga-api-gateway-bff/docs/FRONTEND-GUIDE.md` | §7.5 畫面權限(「檔案管理」頁的選單 / Tab / 按鈕) |
| 畫面範本 | `../GigaItApp/docs/UI-GUIDE.md` | F3「檔案管理」頁沿用 |
| 舊系統(唯讀) | `../../GeneralBackend/`、`../old_PortalSolar/`、`../../BPM/bpmcomonent/`、`../../BPM/BPMbackend/` | 對照舊 API、欄位與呼叫端;**只讀不改**(§7.1) |
| 工作區入口 | `../AGENT.md`、`../PROJECT-MAP.md` | 專案導航、主機連線、架構資料維護 |

---

## 11. 修正紀錄

每次修正都要留紀錄,**新紀錄加在檔案最上方**。

| 文件 | 路徑 | 說明 |
| --- | --- | --- |
| Bug 修改紀錄 | `docs/DevelopmentProcess/BugFix.md` | Bug 修改 |
| 新增功能紀錄 | `docs/DevelopmentProcess/NewFeatures.md` | 新功能(含 F0–F7 各項完成) |
| 後端修改紀錄 | `docs/DevelopmentProcess/BackendCorrection.md` | `file-api/src/`、`file-api/deploy/`、migration |

動到 Gateway 專案(`nginx/`、`deploy/`、`docs/`)或 GigaItApp 時,**在那個 repo** 另留紀錄;每個 repo 各自 commit,訊息註明配合的另一個 repo 與 commit。

**開發新功能後,同一個變更內更新 `docs/PROJECT-MAP.md`**(§9.1),並在紀錄的「檔案」欄列出。規劃變更同步更新 `docs/PRD.md` 的版本紀錄,以及受影響的主題文件(PRD §12)。

### 紀錄格式
```
## YYYY-MM-DD 標題
- 工作項目:F0–F7(無則省略)
- 內容:改了什麼、為什麼
- 檔案:主要修改的檔案
- 驗證:執行的指令與結果(對照哪些舊服務回應、用了哪些假資料)
```
