# giga-file-service 附件服務

GigaNexus 共用的附件(檔案)服務:上傳、下載、清單、軟刪除,檔案存放於主機 WSL,並備份到 NAS。
畫面在 GigaItApp「檔案管理」,經 Gateway BFF `/api/file/*` 呼叫。

> **狀態:規劃中**。整體規劃見 [docs/FILE-PLAN.md](docs/FILE-PLAN.md);時程以 NexusPlan 甘特圖為準。

| 項目 | 內容(規劃) |
| --- | --- |
| 服務代碼 / port | `file-api` / 51272(BACKEND-GUIDE §3.2「入口網 / 共用服務」區段) |
| 系統代碼 / API | `file`,`/api/file/*` |
| 檔案存放 | 主機 WSL 檔案系統 `/srv/giga-files/{env}`;排程備份到 NAS `\\10.10.130.31\docker-folder` |
| 資料庫 | SQL Server 10.10.130.220,測試 / 正式分開(待定案,見 FILE-PLAN §4) |
| BPM 附件 | 唯讀查詢 / 下載:查 NaNa `NoCmDocument`,經 BPM 主機取檔服務 :5144(測試 191、正式 190) |
| 舊系統 | GeneralBackend `filebackend`(5124)、`SMBbackend`(5125)、old_PortalSolar 持續沿用,盤點後再決策 |
