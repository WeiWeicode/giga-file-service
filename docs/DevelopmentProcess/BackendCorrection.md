# 後端修改紀錄

> 新紀錄加在最上方;範圍 `src/`、`deploy/`、migration;格式見 `AGENT.md` §11。

## 2026-10-08 單檔上限 30 MB、容量以 Windows 主機磁碟為準
- 內容:使用者測試回饋。① `MAX_FILE_BYTES` 50 → 30 MB(D3),上傳改由 Gateway Nginx 直送(D4-B 已實作,Gateway 另有紀錄)。② 「儲存與備份」的磁碟容量原本讀檔案根目錄所在的檔案系統,在 WSL 內是 `ext4.vhdx` 稀疏檔的上限(1007 GB),不代表主機實際可用(C: 200 GB、剩 148 GB)。新增 `HOST_DISK_PATH`(Compose 把 `/mnt/c/giga-files-probe` 唯讀掛到 `/host-disk`),容量改為主機磁碟總量與 min(主機剩餘, 虛擬磁碟剩餘),回應加 `basis`、`filesystem`
- 檔案:`file-api/src/config.ts`、`src/modules/storage/local-store.ts`、`src/modules/files/file-service.ts`、`src/routes/files.ts`、`src/server.ts`、`deploy/docker-compose.yml`、`test/units.test.ts`、`test/files.test.ts`、`docs/`(PRD v0.9、API、ARCHITECTURE、STORAGE、DEPLOYMENT、SECURITY-CHECKLIST、Gherkin)
- 驗證:`npm test` 54 項通過(含 30 MB 通過 / +1 byte 回 413、容量 basis);主機 2 `df -h /mnt/c` = 200G / 剩 148G、`/` = 1007G,確認 `/mnt/c` 讀到的是 Windows C:
