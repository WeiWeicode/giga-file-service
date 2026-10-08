# giga-file-service 附件服務

GigaNexus 共用的附件(檔案)服務:上傳、下載、清單、軟刪除,檔案存放於主機 WSL,並備份到 NAS。
畫面在 GigaItApp「Gateway 管理 › 檔案管理」,經 Gateway BFF `/api/file/*` 呼叫。

> **狀態:F1 file-api 主體完成(待測試區部署)**。程式在 [`file-api/`](file-api/);總綱見 [docs/PRD.md](docs/PRD.md)(文件索引在 §12);時程以 NexusPlan 甘特圖(W11)為準。

| 項目 | 內容(規劃) |
| --- | --- |
| 服務代碼 / port | `file-api` / 51272(BACKEND-GUIDE §3.2「入口網 / 共用服務」區段,尚待登記) |
| 系統代碼 / API | `file`,`/api/file/*`;舊格式相容層 `/api/file/compat/*` |
| 檔案存放 | 主機 WSL 檔案系統 `/srv/giga-files/{env}`;排程備份到 NAS `\\10.10.130.31\docker-folder` |
| 資料庫 | SQL Server 10.10.130.220:沿用 Gateway 的 `giganexus_gw` / `giganexus_gw_test`,schema `file_svc`(Drizzle ORM) |
| BPM 附件 | 唯讀查詢 / 下載:查 NaNa `NoCmDocument`,經 BPM 主機取檔服務 :5144(測試 191、正式 190) |
| 舊系統 | GeneralBackend `filebackend`(5124)、`SMBbackend`(5125)、old_PortalSolar 持續沿用,盤點後再決策 |

## 文件

| 文件 | 內容 |
| --- | --- |
| [AGENT.md](AGENT.md) | AI 協作準則 |
| [docs/PRD.md](docs/PRD.md) | 總綱、決策、畫面、待確認事項 |
| [docs/IMPL-PLAN.md](docs/IMPL-PLAN.md) | 工作項目 F0–F7 |
| [docs/PROJECT-MAP.md](docs/PROJECT-MAP.md) | 專案地圖 |
