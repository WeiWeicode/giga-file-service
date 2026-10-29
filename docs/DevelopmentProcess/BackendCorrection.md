# 後端修改紀錄

> 新紀錄加在最上方;範圍 `src/`、`deploy/`、migration;格式見 `AGENT.md` §11。

## 2026-10-29 正式區部署:build-prod / deploy-prod 與正式庫帳號
- 內容:`main` 原本沒有正式區部署。主機 3 的 WSL 查不到外部 DNS(Docker Hub、npmjs 不通),改為 `build-prod`(`main`,主機 2)建置推送 `$CI_REGISTRY_IMAGE/file-api:<SHA>`,`deploy-prod`(`main` 手動,`prod-deploy`)拉取後 `up --no-build --wait file-api` 並做與測試區相同的冒煙測試;compose 映像名稱改 `${FILE_IMAGE_PREFIX:-giganexus}/file-api`(測試區不設定,行為不變)。正式庫盤點:主機 3 `file.env` 用的是測試區帳號 `file_app`,該帳號在 `giganexus_gw` 沒有使用者(登入失敗),也與 01-create-schema.sql「正式庫另建 file_prod_app / file_prod_migrate」及 DEPLOYMENT §5「測試與正式分開」不符;新增 `db/dba/04-create-prod-schema.sql`(使用者以 sa 執行)與 `deploy/host3-set-file-db.sh`(使用者執行,隱藏輸入)
- 檔案:`.gitlab-ci.yml`、`file-api/deploy/docker-compose.yml`、`file-api/deploy/host3-set-file-db.sh`、`file-api/db/dba/04-create-prod-schema.sql`、`AGENT.md`、`docs/DEPLOYMENT.md`、`docs/PROJECT-MAP.md`
- 驗證:`.gitlab-ci.yml` YAML 解析通過;主機 3 以 `file_app` 唯讀連線:`master`、`giganexus_gw_test`(file_svc 4 張表)成功,`giganexus_gw` 登入失敗;compose 乾跑見 MR。Pipeline 尚未執行

## 2026-10-08 單檔上限 30 MB、容量以 Windows 主機磁碟為準
- 內容:使用者測試回饋。① `MAX_FILE_BYTES` 50 → 30 MB(D3),上傳改由 Gateway Nginx 直送(D4-B 已實作,Gateway 另有紀錄)。② 「儲存與備份」的磁碟容量原本讀檔案根目錄所在的檔案系統,在 WSL 內是 `ext4.vhdx` 稀疏檔的上限(1007 GB),不代表主機實際可用(C: 200 GB、剩 148 GB)。新增 `HOST_DISK_PATH`(Compose 把 `/mnt/c/giga-files-probe` 唯讀掛到 `/host-disk`),容量改為主機磁碟總量與 min(主機剩餘, 虛擬磁碟剩餘),回應加 `basis`、`filesystem`
- 檔案:`file-api/src/config.ts`、`src/modules/storage/local-store.ts`、`src/modules/files/file-service.ts`、`src/routes/files.ts`、`src/server.ts`、`deploy/docker-compose.yml`、`test/units.test.ts`、`test/files.test.ts`、`docs/`(PRD v0.9、API、ARCHITECTURE、STORAGE、DEPLOYMENT、SECURITY-CHECKLIST、Gherkin)
- 驗證:`npm test` 54 項通過(含 30 MB 通過 / +1 byte 回 413、容量 basis);主機 2 `df -h /mnt/c` = 200G / 剩 148G、`/` = 1007G,確認 `/mnt/c` 讀到的是 Windows C:
