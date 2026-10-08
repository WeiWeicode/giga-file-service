# giga-file-service — 目前進度與待處理事項

> 最後更新:2026-10-08。分批進行(使用者 2026-10-08 指示):每完成一批就給使用者測試,測試期間同步做下一批。時程以甘特圖 W11 為準。
> 細節以各文件為準:[PRD](PRD.md)(決策 D1–D17、待確認 §11)、[IMPL-PLAN](IMPL-PLAN.md)(F0–F7)、[DEPLOYMENT](DEPLOYMENT.md) §2.1。

## 1. 已完成

| 批次 | 內容 | commit | 驗證 |
| --- | --- | --- | --- |
| 文件 | FILE-PLAN 拆成 PRD + 主題文件;D16(畫面放 Gateway 管理)、D17(Drizzle)、D7 改用 `giganexus_gw` schema `file_svc` | 7ba9950 | — |
| 第一批(F1 + F0) | `file-api/`:上傳 / 清單 / 資訊 / 下載 / 綁定 / 軟刪除 / 暫存清除 / 儲存統計;唯讀盤點 CLI;Dockerfile、Compose、CI、主機 2 機密腳本 | giga-file-service d7bfb79 | 單元 53、SQL Server 2012 整合 5、真實 NAS / 166 唯讀 3 全過;migration 已套用 `giganexus_gw_test` |
| 第一批(Gateway) | BACKEND-GUIDE §3.3 登記 51272 | Gateway def7793 | — |
| 第二批(F3 第一批) | GigaItApp「Gateway 管理 › 檔案管理」:檔案清單、儲存與備份 | GigaItApp adb51a3(**只推 GitHub**) | typecheck、build;瀏覽器未實測 |
| F0 | NAS(filebackend 110、CP 101,含 SHA-256)、166(55,169 檔)唯讀盤點 | — | LEGACY-INVENTORY §6 |

## 2. 下一步(依序)

### 2.1 需要使用者執行

1. **主機 2 機密**:把 `file-api/deploy/host2-set-secrets.sh` 帶到主機 2,在 WSL `sudo sh host2-set-secrets.sh`(輸入 `file_app` 密碼;會建立 `/srv/giga-files/test`、Gateway API Key、監控 Key、`/srv/giganexus/deploy/file.env`)。
2. 完成後告訴 Claude,由 Claude:
   - 推 giga-file-service `develop`(GitLab)→ CI 部署 file-api 到測試區;
   - 確認 file-api 自動註冊的 7 條路由草稿出現在 Gateway。
3. **發佈路由**(本人在 GigaItApp「服務與路由 › 發佈版本」):審查 `file` 系統的草稿並發佈(發佈會一併發佈所有草稿)。
4. 之後由 Claude 推 GigaItApp `develop`(GitLab)→ 前端部署 + gateway-rbac 套用(此時 `file.*` 已存在,Tab 的 includes 才會綁上)。
5. **測試**:測試區 `/it/` → Gateway 管理 › 檔案管理(Gherkin:GigaItApp `docs/Gherkin/gateway/files.feature`)。經 BFF 上傳單檔上限 10 MB。

### 2.2 Claude 下一批(使用者測試期間進行)

| 項目 | 內容 | 前置 |
| --- | --- | --- |
| F2 NAS 備份 | worker:pending → 複製到 NAS `giga-files/{env}/`、SHA-256 驗證、失敗告警、還原 CLI、重試 API + 「儲存與備份」重試按鈕 | NAS 子目錄與服務帳號(PRD §11 #4);主機 2 cifs 掛載由使用者執行 |
| F6 BPM 附件 | `/api/file/bpm/*` 三支(NaNa 唯讀 + 5144 代理)、GigaItApp「BPM 附件」Tab | NaNa 唯讀帳號、5144 金鑰更換(PRD §11 #8) |
| D4-B 50 MB 直送 | Gateway Nginx 上傳 location `auth_request` 直送 file-api | **跨 repo,需使用者同意** |
| F7 相容層 | `/api/file/compat/fb|smb/*`,以舊前端對測 | 相容路由公開 + 內網白名單、CORS(PRD §11 #15、#16);歷史檔先搬完(F4) |
| F4 對照與同步 | NAS 拉取乾跑、166 同步、`legacy_file_map` | `WebAppDb` 唯讀帳號(逐筆對照)、166 同步範圍(PRD §11 #12、#13) |

## 3. 待使用者 / 需求方決定(摘自 PRD §11)

- #4 NAS 子目錄與服務帳號、軟刪除保留期限 → F2 需要
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
