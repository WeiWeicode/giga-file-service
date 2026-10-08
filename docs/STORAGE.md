# GigaNexus 附件服務 — 儲存與備份

> 本文件自 [PRD.md](PRD.md) §7 拆出(原 FILE-PLAN §6),為該主題的唯一維護來源;PRD 僅保留摘要與連結。
> 對應 PRD 版本:**v0.8**(2026-10-08)。相關決策:D5(WSL 存放)、D6(NAS 排程補傳)。主機掛載與機密見 [DEPLOYMENT.md](DEPLOYMENT.md) §3、§5。

---

## 1. 本機(WSL)

| 項目 | 設計 |
| --- | --- |
| 根目錄 | `/srv/giga-files/{env}`(env = `test` / `prod`),容器內固定 `/data/files`;**不放 `/mnt/c`**(跨 9P 慢、權限 / symlink 問題)。Windows 需要看時用 `\\wsl$\<發行版>\srv\giga-files` |
| 實體路徑 | `{yyyy}/{mm}/{file_uuid}`(**不帶副檔名、不帶原檔名**),避免單一目錄檔案過多,也避免依副檔名被執行 |
| 寫入 | 先寫 `tmp/` 並同時計算 SHA-256,完成後 rename 到正式路徑再寫 DB;失敗清掉暫存 |
| 路徑安全 | 組合路徑一律 `path.resolve` 後確認落在根目錄之下;不信任來自請求或資料庫的路徑片段(`AGENT.md` §7.3) |
| 容量 | WSL 虛擬磁碟(`ext4.vhdx`)是稀疏檔,上限預設約 1 TB、預設在 C 槽且只增不減,**上限不代表可用空間**。file-api 以 `HOST_DISK_PATH`(Compose 把主機 `/mnt/c/giga-files-probe` 唯讀掛到 `/host-disk`)讀取 Windows 主機磁碟容量,剩餘 = min(主機剩餘, 虛擬磁碟剩餘),顯示於「檔案管理 › 儲存與備份」(2026-10-08:主機 2 C: 200 GB、剩 148 GB;虛擬磁碟上限 1007 GB)。主機 2 只有 C 槽,虛擬磁碟無法搬到其他磁碟 |

## 2. NAS 備份

| 項目 | 設計 |
| --- | --- |
| 掛載 | WSL 以 cifs 掛載 `//10.10.130.31/docker-folder` 到 `/mnt/nas-docker`,帳密放 credentials 檔(權限 600);**帳密腳本由使用者執行**,AI 不經手 |
| 位置 | `giga-files/{env}/`(新服務備份);`giga-files/legacy/portalsolar/`(166 原檔名鏡像,[MIGRATION.md](MIGRATION.md) §3);兩者與舊服務備份目錄(`CP`、根目錄各平台)分開,互不覆蓋 |
| 時機 | 排程每 N 分鐘掃 `backup_status = pending` 補傳(**非上傳同時雙寫**);NAS 斷線時上傳不受影響,恢復後自動補 |
| 驗證 | 複製後比對 SHA-256,成功寫 `backup_status = done`、`backup_at`;失敗累計次數(`backup_attempts`),超過門檻告警(Email 經 Gateway `/api/notify/send`) |
| 刪除 | 軟刪除不動 NAS;實體清除(保留期限後)才同步刪 NAS,保留期限待定(PRD §11 #4) |
| 還原 | 提供 CLI:依 DB 紀錄從 NAS 拉回遺失的實體檔 |

- NAS 子目錄與服務帳號待 IT 提供,F2 前需要(PRD §11 #4)。

### 2.1 實作(F2,2026-10-08)

| 項目 | 實作 |
| --- | --- |
| 掛載 | `file-api/deploy/host2-mount-nas.sh`(使用者執行):帳密檔 `/etc/giganexus/nas.cred`(600)、`/etc/fstab` 加 cifs(`uid=1000`、`nofail`)、建立 `giga-files/{env}/` 與**標記檔** `.giga-files-backup`。容器內 `/data/backup`(`BACKUP_ROOT`);NAS 晚於容器掛載時需 `--force-recreate` |
| 標記檔 | 沒有標記檔視為 NAS 未掛載,整輪跳過、不累計失敗(Docker 在掛載點不存在時會建立本機空目錄,不可寫進去後標記完成) |
| 排程 | `BACKUP_INTERVAL_MINUTES`(預設 5),啟動時先跑一輪;上一輪未完成不重疊;每輪最多 200 筆 |
| 驗證 | 先比對本機檔與資料庫 SHA(不符不備份)→ 寫 `.part` → 比對 → rename → 再讀一次比對;NAS 已有相同內容視為完成 |
| 失敗 | `backup_attempts` 以單一 UPDATE 累加,達 `BACKUP_MAX_ATTEMPTS`(預設 5)改 `failed`;一輪合併告警一次:Gateway `/api/notify/send`、範本 `FILE_BACKUP_FAILED`、收件人 `BACKUP_ALERT_USERS`(工號,逐人 Email;未設定只記錄日誌)|
| 重試 | `POST /api/file/storage/backup/retry`;GigaItApp「儲存與備份」的「重試 / 全部重試」(`it.gw-file.backup-retry`) |
| 暫存檔 | 未綁定暫存檔逾期清除時,NAS 備份一併刪除;正式檔案軟刪除不動 NAS |
| 還原 | `npm run restore -- [--uuid …] [--apply]`(容器內 `node dist/src/cli/restore.js`):預設乾跑;本機遺失或內容不符、NAS SHA 相符才寫回;本機壞檔改名 `.corrupt-{時間}` 保留 |
- 失敗一律反映在 `backup_status`,**不可回報成功**(`AGENT.md` §5)。
