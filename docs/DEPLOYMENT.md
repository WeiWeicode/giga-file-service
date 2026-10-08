# GigaNexus 附件服務 — 部署與設定

> 對應 PRD 版本:**v0.8**(2026-10-08)。F1 已有 Dockerfile、Compose 與 CI(`file-api/Dockerfile`、`file-api/deploy/`、`.gitlab-ci.yml`);**測試區尚未部署**,步驟見 §2.1。
> 通用流程以 Gateway [DEPLOYMENT.md](../../giga-api-gateway-bff/docs/DEPLOYMENT.md)(CI/CD、WSL2 Docker §6、機密)與 [BACKEND-GUIDE.md](../../giga-api-gateway-bff/docs/BACKEND-GUIDE.md) §3 為準。

---

## 1. 部署區

| 項目 | `dev`(本機開發) | `test`(測試區,主機 2) | `prod`(正式區,主機 3) |
| --- | --- | --- | --- |
| `GW_ENV` | `dev` | `test` | `prod` |
| 自動註冊 API | 不註冊 | 啟動時註冊為 Gateway **草稿** | 啟動時註冊為 Gateway **草稿** |
| 機密(DB 帳密、5144 金鑰、166 / NAS 帳密) | 可由 `.env` 給值 | `*_FILE`(Docker secret) | **只接受** `*_FILE` |
| 資料庫(schema `file_svc`) | `giganexus_gw_test` | `giganexus_gw_test` | `giganexus_gw` |
| `BPM_ENV`(D10) | `test`(對 191) | `test`(對 191) | `prod`(對 190) |
| 檔案根目錄 | 本機暫存目錄(不要寫入 `/srv/giga-files`) | `/srv/giga-files/test` | `/srv/giga-files/prod` |
| 日誌等級預設 | `debug` | `info` | `info` |

- 部署區只有這三個值;缺少必要設定時**啟動失敗**,不加預設值繞過。
- 正式區(主機 3)時程依甘特圖(2026-12 起改用 WSL2 Docker)。

## 2. 服務與 CI/CD(規劃)

| 項目 | 內容 |
| --- | --- |
| 服務代碼 / port | `file-api` / **51272**(D2;**尚未登記**於 Gateway BACKEND-GUIDE §3.3,開發前先向 Gateway 負責人登記) |
| 系統代碼 | `file`;對外 `/api/file/*` |
| 映像 | `file-api`(API 與 worker 同一映像,compose 以不同指令啟動;比照 Gateway `bff` / `worker`) |
| 分支 | `develop` → 主機 2 測試區;`main` → 主機 3 正式區(手動核可) |
| 網路 | 容器加入 Gateway 的 Docker 網路,BFF 以服務名稱呼叫;port 51272 防火牆只開 Gateway 主機 |
| 建置 | 主機 2 建置一律 `--pull`(`node:22-alpine` 標籤會被覆寫) |
| 套件 | `@giganexus/backend-sdk` 來自 GitLab npm Registry(Deploy Token,比照其他 repo) |

### 2.1 測試區第一次部署

1. **主機 2(本人)**:把 `file-api/deploy/host2-set-secrets.sh` 帶到主機 2,在 WSL 執行 `sudo sh host2-set-secrets.sh`:建立 `/srv/giga-files/test`(uid 1000)、`/srv/giganexus/file-secrets/`(`file_app` 密碼隱藏輸入、Gateway API Key `client:create --code file-api`、giga-observe 監控 Key)、`/srv/giganexus/deploy/file.env`。
2. **migration**:開發機 `cd file-api && npm run db:migrate`(以 `file_migrate`;`giganexus_gw_test` 已於 2026-10-08 套用)。
3. **推 `develop`**:CI `check:file-api` → `deploy-test`(建置映像、`up -d --wait`、`/readyz`、無 Token 回 401)。
4. **發佈路由**:file-api 啟動後自動註冊為 Gateway **草稿**;在 GigaItApp「服務與路由」審查 `file` 系統的 7 條路由後發佈。
5. **畫面權限**:GigaItApp `deploy/gateway-rbac.yaml` 的 `it.gw-file.*`(PRD §8)隨 GigaItApp develop 部署套用。
6. 上傳由 Nginx 直送 file-api(§4),單檔 30 MB。

## 3. 主機目錄與掛載

| 路徑(WSL) | 模式 | 用途 |
| --- | --- | --- |
| `/srv/giga-files/{env}` | 讀寫,bind mount 到容器 `/data/files` | 實體檔([STORAGE.md](STORAGE.md) §1) |
| `/mnt/nas-docker`(cifs `//10.10.130.31/docker-folder`) | 讀寫,**只寫 `giga-files/`** | 新服務備份、166 原檔名鏡像 |
| NAS `CP`、舊服務備份根目錄 | **唯讀**掛載(`ro`) | NAS 備份拉取([MIGRATION.md](MIGRATION.md) §2) |
| `\\10.10.130.166\PortalSolar` | **唯讀**掛載、唯讀帳號 | 166 同步([MIGRATION.md](MIGRATION.md) §3) |

- WSL 虛擬磁碟容量:建議搬到 D 槽或設上限([STORAGE.md](STORAGE.md) §1)。
- 需要 root 的掛載與 `/etc/fstab` 設定由使用者執行;主機連線慣例見工作區 `AGENT.md` §5。

## 4. Gateway 端需要的變更(跨 repo)

| 項目 | 位置 | 說明 |
| --- | --- | --- |
| 上傳直送 | Gateway `nginx/conf.d/portal.conf` | 上傳路由 `auth_request` 後直送 file-api,`client_max_body_size 50m` 只套在該 location(D4-B,[ARCHITECTURE.md](ARCHITECTURE.md) §2) |
| 相容路由 | Gateway `nginx/` + BFF 路由 | `/api/file/compat/*` `auth_mode = public` + 內網白名單(PRD §11 #15) |
| CORS | Gateway | BPM 前端來源加入白名單、暴露 `Content-Disposition`(PRD §11 #16) |
| port 登記 | Gateway `docs/BACKEND-GUIDE.md` §3.3 | `file-api` 51272 |
| 畫面權限 | GigaItApp `deploy/gateway-rbac.yaml` | 「Gateway 管理 › 檔案管理」選單(PRD §8),F3 一併登記 |

**跨 repo 修改先說明並取得同意**,並在該 repo 的 `docs/DevelopmentProcess/` 留紀錄。

## 5. 機密

| 機密 | 用途 | 寫入方式 |
| --- | --- | --- |
| 本服務 app / migrate 帳密(只授權 schema `file_svc`;測試與正式分開,比照 Gateway) | 資料庫 | 使用者執行腳本(隱藏輸入)建立 LOGIN 與授權、寫入主機機密檔 |
| NAS 服務帳號 | cifs 掛載 credentials 檔(權限 600) | 同上 |
| 166 唯讀帳號 | 166 同步 | 同上 |
| NaNa 唯讀帳號 `file_bpm_ro` | BPM 附件查詢(`db/dba/02-create-bpm-readonly.sql`) | `deploy/host2-set-bpm-secrets.sh` → `file-secrets/bpm/bpm_db_password`(目錄唯讀掛載 `/run/secrets/bpm`) |
| BPM 5144 `X-API-Key` | 取檔服務(**建議更換**,PRD §11 #8;目前沿用既有金鑰) | 同上 → `file-secrets/bpm/bpm_file_api_key`;**只放 file-api** |

- 不入版控、不寫進映像檔、不貼進對話或日誌;以 `<NAME>_FILE` 指向 Docker secret。
- **AI 不開啟 `.env`、不讀取機密檔、不要求使用者貼帳密**(`AGENT.md` §7.2)。

## 6. 上線前檢查(每個部署區一次)

- [ ] schema `file_svc` 與本服務帳號已建立(只授權 `file_svc`,試寫 `gw.*` 應失敗),migration 以 migrate 帳號套用、紀錄表在 `file_svc`(測試區 ✅ 2026-10-08)
- [ ] port 51272 已登記、防火牆只開 Gateway 主機
- [ ] `/srv/giga-files/{env}` 已建立、擁有者與容器使用者一致(測試區 ✅ 2026-10-08)
- [ ] NAS 掛載可寫 `giga-files/{env}/`,舊來源掛載為唯讀(試寫應失敗)(測試區 ✅ 2026-10-08)
- [ ] 機密檔皆就位,容器以 `*_FILE` 讀取(測試區 ✅ 2026-10-08)
- [ ] `/healthz` 200;自動註冊的路由在 Gateway 為草稿,審查後發佈(測試區 ✅ 2026-10-08)
- [ ] 上傳 30 MB 測試檔經 Nginx 直送成功,BFF 記憶體無明顯上升(測試區 ✅ 2026-10-08)
- [ ] NAS 補傳成功、SHA-256 相符;中斷 NAS 後恢復可自動補(測試區 ✅ 2026-10-08)
