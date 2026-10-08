# giga-file-service — 目前進度與待處理事項

> 最後更新:2026-10-08 14:50(§2.1.1、F2 NAS 備份測試區驗收通過;下一批 F6 待帳號)。分批進行(使用者 2026-10-08 指示):每完成一批就給使用者測試,測試期間同步做下一批。時程以甘特圖 W11 為準。
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
| F0 | NAS(filebackend 110、CP 101,含 SHA-256)、166(55,169 檔)唯讀盤點 | — | LEGACY-INVENTORY §6 |

## 2. 下一步(依序)

### 2.1 需要使用者執行

1. ~~主機 2 機密~~ ✅(2026-10-08 12:10 完成)。
2. ~~推 develop、部署 file-api~~ ✅;路由草稿已自動註冊(upstream `file-api`、系統 `file`)。
3. ~~發佈路由~~ ✅(已發佈,`/api/file/*` 經 Gateway 可用)。原說明:GigaItApp「服務與路由 › 發佈版本」發佈 `file` 系統的 7 條草稿(發佈會一併發佈所有草稿)。未發佈前 `/api/file/*` 經 Gateway 會 404。
4. ~~推 GigaItApp `develop`~~ ✅ adb51a3(deploy-test 628、rbac-test 629 成功;`it.gw-file.*` 已套用)。
5. **測試**:測試區 `/it/` → Gateway 管理 › 檔案管理(Gherkin:GigaItApp `docs/Gherkin/gateway/files.feature`)。單檔上限 30 MB(Nginx 直送)。
6. file-api 需重建容器時(例:機密檔重建):`ssh host2 "wsl -u root -- sh /mnt/c/Users/user/file-recreate.sh"`(腳本已放在主機 2 的 C:\Users\user\,以 CI 建好的映像 `--force-recreate`;映像標籤要改成最新 commit)。

### 2.1.1 ~~新討論串接續時先做~~ ✅ 2026-10-08 全部通過(見 §1「測試區驗收」)

### 2.2 F2 NAS 備份 — 已完成(2026-10-08)

- 路由 `file.storage.backup.retry` 已發佈;NAS 以 `docker-backup` 帳號 cifs 掛載於主機 2 `/mnt/nas-docker`(fstab、`nofail`),備份根目錄 `giga-files/test/`。
- `C:\Users\user\file-recreate.sh` 的映像標籤已改為 `997dd4cf`;之後 file-api 有新版本要重建時同步改標籤,否則會退回舊版。
- **尚未設定(選用)**:備份失敗告警 Email — Gateway 負責人為 `file-api` 的 API Key 加 `notify.message.send`(會換發 Key → 重寫主機 2 `gw_api_key`)、建立範本 `FILE_BACKUP_FAILED`(變數 `env`、`count`、`items`、`linkUrl`),`file.env` 設 `FILE_BACKUP_ALERT_USERS`。未設定時失敗只記日誌與畫面「備份失敗」。
- 軟刪除後的實體清除(含 NAS)待保留期限決定(PRD §11 #4)。

### 2.3 Claude 下一批

| 項目 | 內容 | 前置 |
| --- | --- | --- |
| F6 BPM 附件 | `/api/file/bpm/*` 三支(NaNa 唯讀 + 5144 代理)、GigaItApp「BPM 附件」Tab | NaNa 唯讀帳號、5144 金鑰更換(PRD §11 #8);5144 取檔服務的位置與 `localAttachmentPath` 寫入方式(#7) |
| F7 相容層 | `/api/file/compat/fb|smb/*`,以舊前端對測 | 相容路由公開 + 內網白名單、CORS(PRD §11 #15、#16);歷史檔先搬完(F4) |
| F4 對照與同步 | NAS 拉取乾跑、166 同步、`legacy_file_map` | `WebAppDb` 唯讀帳號(逐筆對照)、166 同步範圍(PRD §11 #12、#13) |

## 3. 待使用者 / 需求方決定(摘自 PRD §11)

- #4 NAS 服務帳號 → F2 掛載需要(子目錄已依 STORAGE §2 用 `giga-files/{env}/`);軟刪除保留期限 → 實體清除(未實作)需要
- #5 資料範圍第一版(自己上傳的或同公司)是否可以 → 目前已這樣實作
- #6 允許的檔案類型(目前暫定:pdf、圖片、Office、msg、txt、csv、zip、7z、rar)
- #8 5144 金鑰更換、NaNa 唯讀帳號 → F6 需要
- #12 166 同步範圍(`html` 佔 52,572 檔 / 1.1 GB、`ESLearning` 不在此分享)
- `WebAppDb` 唯讀帳號:NAS 檔案數與資料表筆數不一致(filebackend 110 檔 / 151 筆、CP 101 檔 / 83 筆),需逐筆對照

## 4. 注意事項

- 程式一律放 `file-api/`;repo 根目錄只放文件與 CI。
- 舊來源(NAS、166)一律唯讀;`npm run test:legacy` 會比對掃描前後快照。
- `npm run test:int` 只能指向 `giganexus_gw_poc_test`(會清空 `file_svc`)。
- `.env` 由使用者建立,AI 不開啟;主機機密由使用者執行腳本寫入。

## 5. 部署中學到的事

- **Gateway 匯入規則**:`x-timeout-ms` 必須 100~60000(已加入 OpenAPI 單元測試);其他規則見 Gateway `bff/src/cli/openapi.ts`,新增 OpenAPI 擴充欄位前先對照。
- **主機 2 密碼輸入**:隱藏輸入時從 `.env` 複製貼上;檢查(不顯示內容):`/mnt/c/Users/user/file-secret-check.sh` 只輸出位元組數與不可見字元數。
- 機密檔是 bind mount,刪檔重建後容器要 `--force-recreate` 才讀得到新檔。
- 登入失敗時容器會不停重啟;`file_app` 有 `CHECK_POLICY = ON`,為避免鎖帳號先 `docker stop`。
