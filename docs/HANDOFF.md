# giga-file-service — 目前進度與待處理事項

> 最後更新:2026-10-08 17:00 — **本階段收尾**:F1(file-api 主體)、F2(NAS 備份)、F3(檔案管理頁)、F6(BPM 附件,191 / 190)測試區驗收完成,里程碑「測試區附件服務可用」達成。下一階段 F4 / F7 待需求方決定(§3)。分批進行(使用者 2026-10-08 指示):每完成一批就給使用者測試,測試期間同步做下一批。時程以甘特圖 W11 為準。
> 細節以各文件為準:[PRD](PRD.md)(決策 D1–D17、待確認 §11)、[IMPL-PLAN](IMPL-PLAN.md)(F0–F7)、[DEPLOYMENT](DEPLOYMENT.md) §2.1。

## 1. 已完成

| 批次 | 內容 | commit | 驗證 |
| --- | --- | --- | --- |
| 文件 | FILE-PLAN 拆成 PRD + 主題文件;D16(畫面放 Gateway 管理)、D17(Drizzle)、D7 改用 `giganexus_gw` schema `file_svc` | 7ba9950 | — |
| 第一批(F1 + F0) | `file-api/`:上傳 / 清單 / 資訊 / 下載 / 綁定 / 軟刪除 / 暫存清除 / 儲存統計;唯讀盤點 CLI;Dockerfile、Compose、CI、主機 2 機密腳本 | giga-file-service d7bfb79 | 單元 53、SQL Server 2012 整合 5、真實 NAS / 166 唯讀 3 全過;migration 已套用 `giganexus_gw_test` |
| 第一批(Gateway) | BACKEND-GUIDE §3.3 登記 51272 | Gateway def7793 | — |
| 測試區部署 | 主機 2 機密(使用者執行 host2-set-secrets.sh;第一次密碼與 `.env` 不同,刪檔重跑後正確)、file-api 部署、自動註冊 | develop c06562d(修正 `x-timeout-ms` 上限 60000) | CI check 623 / deploy-test 624 成功;`/readyz` sql / storage ok;**7 條路由、4 個權限已註冊為草稿,待發佈** |
| 第二批(F3 第一批) | GigaItApp「Gateway 管理 › 檔案管理」:檔案清單、儲存與備份 | GigaItApp adb51a3 | typecheck、build;瀏覽器未實測 |
| 測試回饋修正 | ① 單檔上限 50 → **30 MB**(D3);上傳 `POST /api/file/files` 改由 Gateway Nginx `auth_request` **直送 file-api**(D4-B 已實作),BFF `/_auth/verify` 對非 GET 補驗 CSRF ② 「主機磁碟」原顯示 WSL 虛擬磁碟上限 1007 GB,改以 Windows 主機磁碟為準(`HOST_DISK_PATH`,C: 200 GB / 剩 148 GB) | Gateway f360b46、file-service 6589792、GigaItApp bf5d45a | 單元:file-api 54、BFF 226 通過;13:20 已部署測試區 |
| 測試區驗收 | 發現並修正 Gateway nginx:① `/_auth/verify` 子請求沿用預設 10m 上限,>10 MB 直送上傳回 500 → 設 `client_max_body_size 0` ② `/api/file/files` 自訂 `error_page` 後不繼承 `json-errors.conf`,413 回 HTML → 重列 413/429/5xx | Gateway c0b8fc3 | 2026-10-08 以使用者登入的瀏覽器實測:25 MB 上傳 201、31 MB 413 `PAYLOAD_TOO_LARGE`、缺 CSRF 403 `PERMISSION_DENIED`;清單 / 資訊 / 下載(UTF-8 檔名)/ 綁定 / 刪除正常;「儲存與備份」顯示 52.6 GB / 200 GB、剩 147 GB 並註明 WSL 上限 1007 GB;測試檔已刪除。甘特圖 W11-3 完成、W11-6 80% |
| F2 NAS 備份(程式) | 備份排程(標記檔防呆、SHA-256 驗證、失敗門檻 + Gateway 通知告警)、重試 API `POST /api/file/storage/backup/retry`(`file.storage.manage`)、還原 CLI `npm run restore`、暫存檔清除連帶刪 NAS;Compose 掛 `/data/backup`;`deploy/host2-mount-nas.sh`;GigaItApp「重試 / 全部重試」(`it.gw-file.backup-retry`) | 見 commit 紀錄 | 單元 69、SQL Server 2012 整合 6 全過;GigaItApp typecheck、build;**2026-10-08 測試區驗收通過**:① 上傳後 4 分鐘 `done`,NAS 檔 SHA 相符 ② 標記檔移除期間上傳維持 `pending`、日誌「本輪跳過」,恢復後下一輪自動補 ③ 刪本機檔 → `restore` 乾跑列出 → `--apply` 還原,SHA 相符、頁面下載正常;測試檔已刪除 |
| F6 BPM 附件 | `/api/file/bpm/sources`、`/forms/:sn/attachments`、`/attachments/:doid`、`/:doid/content`;測試區 191 / 正式區 190 兩個來源(`?env=test|prod`);NaNa 唯讀 + 5144 代理(預測段數優先 + 11/10/12 備援、LRU 快取)、下載寫 `bpm_download`(含 env);GigaItApp「BPM 附件」Tab 可切換來源;Compose 以目錄掛載 `file-secrets/bpm/{test,prod}_*` | file-service 37916c1 → a264a99 → ae69d2e、GigaItApp b9045ba、e84f82a | 單元 87、真實 191 唯讀 3;**2026-10-08 測試區驗收**:191 / 190 經 Gateway 查詢(完全比對)、下載 xlsx / xls / docx 中文檔名、jpg 預覽、Doid 搭錯來源回 404;使用者於畫面以正式區單號實測下載正常 |
| Gateway 修正 | 轉給上游的 `X-Forwarded-For` 順序相反,經 BFF 的操作紀錄 ip 都是 Nginx 容器 `172.19.0.6` → 改為用戶端在前 | Gateway eb03b79 | BFF 227 通過;部署後紀錄 ip 為 `10.10.112.13` |
| F0 | NAS(filebackend 110、CP 101,含 SHA-256)、166(55,169 檔)唯讀盤點 | — | LEGACY-INVENTORY §6 |

## 2. 下一步

### 2.1 測試區現況(維運)

- file-api 映像標籤 = develop 最新 commit 的 `git rev-parse --short=8 HEAD`(CI deploy-test 自動部署);重建容器:`ssh host2 "wsl -u root -- sh /mnt/c/Users/user/file-recreate.sh"`。腳本內 `IMAGE_TAG` 寫死,**重建前改成目前部署的 `git rev-parse --short=8 HEAD`**,並以 `docker image inspect giganexus/file-api:<tag>` 確認存在,否則會退回舊版或找不到映像。
- NAS:`docker-backup` 帳號 cifs 掛載主機 2 `/mnt/nas-docker`(fstab、`nofail`),備份根目錄 `giga-files/test/`(標記檔 `.giga-files-backup`)。
- BPM:主機 2 `file.env` 有 `BPM_TEST_*`(191)、`BPM_PROD_*`(190),機密 `file-secrets/bpm/{test,prod}_db_password`、`{test,prod}_file_api_key`;開發機 `.env` 同(`.env.example`)。
- 路由:`file` 系統 12 條已發佈(檔案 6、儲存 2、BPM 4 — 以 Gateway「服務與路由」為準)。

### 2.2 先不做 / 暫緩(使用者 2026-10-08 決定)

- 備份失敗告警 Email:需 `file-api` API Key 加 `notify.message.send`(會換發 Key → 重寫主機 2 `gw_api_key`)、範本 `FILE_BACKUP_FAILED`(變數 `env`、`count`、`items`、`linkUrl`)、`file.env` 設 `FILE_BACKUP_ALERT_USERS`。未設定時失敗只記日誌與畫面「備份失敗」。
- 5144 金鑰更換、重新打包 FileAPI.exe:舊金鑰寫死在 NotesApp 前端 9 支 API 與 BPMbackend 註解;待 NotesApp 改走 file-api 後再換(做法:5144 改為 `API_KEY` + `API_KEYS` 並行)。

### 2.3 未實測(選用)

- 無檔案權限的帳號看不到「檔案管理」與按鈕(需另一個帳號)。
- 「儲存與備份」的「重試」按鈕實際按一次(需有備份失敗的檔案;API 由單元測試涵蓋)。

### 2.4 下一階段

| 項目 | 內容 | 前置 |
| --- | --- | --- |
| F4 對照與同步 | NAS 拉取乾跑、166 同步、`legacy_file_map`;GigaItApp「舊系統」Tab(原屬 F3) | `WebAppDb` 唯讀帳號(逐筆對照)、166 同步範圍(PRD §11 #12、#13) |
| F7 相容層 | `/api/file/compat/fb|smb/*`,以舊前端對測 | 相容路由公開 + 內網白名單、CORS(PRD §11 #15、#16);歷史檔先搬完(F4) |
| NotesApp 改走 file-api | NotesApp 9 支 API 改呼叫 `/api/file/bpm/*`,之後才能更換 5144 金鑰 | NotesApp 負責人;Gateway 登入整合 |
| 正式區部署 | 主機 3、`giganexus_gw` schema `file_svc`、190 `file_bpm_ro`(已建)、NAS `giga-files/prod/` | 2026-12(Gateway 正式區) |
| 軟刪除實體清除 | 保留期限後刪 WSL 與 NAS | 保留期限(PRD §11 #4) |

## 3. 待使用者 / 需求方決定(摘自 PRD §11)

- #4 ~~NAS 服務帳號~~ ✅(`docker-backup`);軟刪除保留期限 → 實體清除(未實作)需要
- #5 資料範圍第一版(自己上傳的或同公司)是否可以 → 目前已這樣實作
- #6 允許的檔案類型(目前暫定:pdf、圖片、Office、msg、txt、csv、zip、7z、rar)
- #8 5144 金鑰更換 → 暫緩(沿用既有金鑰,待 NotesApp 改走 file-api);NaNa 唯讀帳號 ✅ 191、190 已建
- #12 166 同步範圍(`html` 佔 52,572 檔 / 1.1 GB、`ESLearning` 不在此分享)
- `WebAppDb` 唯讀帳號:NAS 檔案數與資料表筆數不一致(filebackend 110 檔 / 151 筆、CP 101 檔 / 83 筆),需逐筆對照

## 4. 注意事項

- 程式一律放 `file-api/`;repo 根目錄只放文件與 CI。
- 舊來源(NAS、166)一律唯讀;`npm run test:legacy` 會比對掃描前後快照。
- `npm run test:int` 只能指向 `giganexus_gw_poc_test`(會清空 `file_svc`)。
- `.env` 由使用者建立,AI 不開啟;主機機密由使用者執行腳本寫入(含密碼);不含機密的主機 2 操作 Claude 可直接以 `ssh host2` 執行(使用者 2026-10-08 加了允許規則)。

## 5. 部署中學到的事

- **Gateway 匯入規則**:`x-timeout-ms` 必須 100~60000(已加入 OpenAPI 單元測試);其他規則見 Gateway `bff/src/cli/openapi.ts`,新增 OpenAPI 擴充欄位前先對照。
- **主機 2 密碼輸入**:隱藏輸入時從 `.env` 複製貼上;檢查(不顯示內容):`/mnt/c/Users/user/file-secret-check.sh` 只輸出位元組數與不可見字元數。
- 機密檔是 bind mount,刪檔重建後容器要 `--force-recreate` 才讀得到新檔。
- 登入失敗時容器會不停重啟;`file_app` 有 `CHECK_POLICY = ON`,為避免鎖帳號先 `docker stop`。
- **Nginx `auth_request`**:子請求套用自己 location 的 `client_max_body_size`;location 內自訂任何 `error_page` 後不再繼承 server 層的(要重列)。
- **NaNa**:`ProcessInstance.subject` 等為 `ntext`,DISTINCT 前要轉 nvarchar;`datetime` 為台灣時間。
- **測試區 Access Token 很短**:用瀏覽器 `fetch` 驗收時遇到 401 就重新整理頁面讓前端換發。
- **Compose 未設定的變數會是空字串**(`${X:-}`),設定讀取要用 `||` 不是 `??`。
