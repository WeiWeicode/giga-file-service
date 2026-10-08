# GigaNexus 附件服務 — 資安檢查清單

> 本文件自 [PRD.md](PRD.md) §9 拆出(原 FILE-PLAN §11),為該主題的唯一維護來源;格式比照 Gateway [SECURITY-CHECKLIST.md](../../giga-api-gateway-bff/docs/SECURITY-CHECKLIST.md)。
> 狀態:✅ 已實作並有驗證 ・ 🔶 已實作、待實測 ・ ⚠️ 已核准的例外 / 暫停 ・ ❌ 未做。
> 最後檢查:2026-10-08(F1 程式審查 + 單元測試 `file-api/test/files.test.ts`、`units.test.ts` + SQL Server 2012 整合測試;測試區尚未部署)。

## 身分與存取控制

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S1 | 只接受 Gateway 身分 | 只信任 `X-Internal-Token`(`@giganexus/backend-sdk` 驗證);dev 可設 `DEV_SKIP_TOKEN`,test / prod 設定即啟動失敗 | 單元:缺 Token、aud 不符回 401;設定測試 | ✅ |
| S2 | 網路隔離 | port 51272 防火牆只開 Gateway 主機 | 部署後自他主機連線應失敗 | ❌ |
| S3 | 權限宣告 | 每支 API 有 `x-permission`,`npm test` 檢查 | 單元(OpenAPI 檢查) | ✅ |
| S4 | 資料層級 | 第一版:自己上傳的或同公司(`cos`);系統身分只看自己上傳的(API §1.2);無權回 `403 DATA_ACCESS_DENIED` | 單元 + 整合(SQL Server 範圍條件) | 🔶 規則待 PRD §11 #5 |
| S5 | BPM 附件權限 | 第一版 `file.bpm.read`(D12);限申請人 / 簽核人列為後續 | 整合 | ❌ |
| S6 | 相容層例外 | `/api/file/compat/*` `auth_mode = public` + Nginx 內網白名單;**不得放寬新 API**([API.md](API.md) §4.4 規則 4) | E2E:外網來源被拒 | ⚠️ 待 IT 核准(PRD §11 #15) |

## 檔案處理

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S7 | 只用 UUID 取檔 | 不暴露遞增 id、實體路徑;**不提供依路徑 / 檔名取檔**(避免 [LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §2 的路徑穿越) | 單元(OpenAPI 不含 storageKey、非 UUID 回 400) | ✅ |
| S8 | 路徑安全 | `path.resolve` 後以帶分隔符的前綴比對(UNC / 磁碟根目錄不重複加分隔符);相容層以對照表查詢,不直接組路徑 | 單元:`../`、絕對路徑、指向 tmp、竄改的 storage_key 回 500 | ✅ |
| S9 | 檔案類型 | 副檔名白名單 + 檢查檔頭(magic number);執行檔、腳本、MZ / ELF / shebang 檔頭一律拒絕 | 單元 | 🔶 白名單為暫定(PRD §11 #6) |
| S10 | SVG / inline | `image/svg+xml` 一律以附件下載不 inline;`?inline=1` 只允許圖片 / PDF | 單元 | ✅ |
| S11 | 回應標頭 | `X-Content-Type-Options: nosniff`(所有回應);`Content-Disposition` ASCII 後備 + `filename*=UTF-8''` | 單元 | ✅ |
| S12 | 大小上限 | 單檔 30 MB(D3),Nginx(31m,含表頭)與 file-api 兩層檢查;直送路徑由 BFF `/_auth/verify` 驗登入、路由權限與 CSRF | 單元(30 MB 通過、+1 byte 回 413 且無殘留);2026-10-08 測試區實測 25 MB 成功、31 MB 回 413 `PAYLOAD_TOO_LARGE`、缺 CSRF 回 403 | ✅ |
| S13 | 原子寫入 | 先寫 `tmp/` 算 SHA-256 → 全部檢查通過 → rename → 寫 DB;失敗清暫存與已搬移的檔案 | 單元(整批拒絕無殘留) | ✅ |
| S14 | 防毒掃描 | ClamAV 擴充點保留在寫 DB 前,**暫不實作** | — | ⚠️ 範圍外 |

## 機密與舊系統

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S15 | BPM 取檔金鑰 | 5144 `X-API-Key` 只放 file-api 機密設定(`bpm_file_api_key`,`_FILE`),回應與 OpenAPI 不含金鑰、`physicalName`;資料庫的 physicalName 只接受英數才組 5144 路徑 | 單元(金鑰錯誤 502、路徑字元拒絕且不送出) | ⚠️ file-api 端 ✅;**金鑰未更換**:舊金鑰寫死在 NotesApp 前端與 BPMbackend 註解,使用者 2026-10-08 決定先沿用,待 NotesApp 改走 file-api 後再換(PRD §11 #8) |
| S16 | 唯讀帳號 | NaNa、166、NAS 舊備份目錄皆用唯讀帳號 / `ro` 掛載;盤點程式只有讀取介面(`ReadonlyFs`) | 單元(spy 只呼叫 readdir / stat / openRead)、真實來源前後快照相同;NaNa `file_bpm_ro` 只有附件 5 張表 SELECT,實測讀其他表被拒(2026-10-08);166 / NAS 舊目錄部署端待 F4 | 🔶 NaNa ✅ |
| S17 | 機密存放 | `*_FILE` Docker secret(test / prod 只接受 `_FILE`);不入版控、映像、日誌 | 設定測試、程式審查;測試區機密檔 400、uid 1000(`host2-set-secrets.sh`) | ✅ 測試區 |
| S18 | 舊服務漏洞 | SMB `localdownload` 路徑穿越:**依 D9 只記錄不修**,風險靠新服務上線後舊服務下線處理 | — | ⚠️ 已核准的例外 |

## 稽核與日誌

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S19 | 操作紀錄 | 上傳 / 下載 / 刪除 / 綁定寫 `file_access_log`,含 `X-Request-Id`;BPM 下載待 F6 | 單元 + 整合(四種 action 依序寫入) | ✅ |
| S20 | 日誌內容 | 不記錄帳密、Token(logger redact `x-internal-token`)、檔案內容 | 程式審查 | 🔶 |
| S21 | 錯誤回應 | 不回傳堆疊或 SQL;相容層舊格式不外洩到新 API(F7) | 單元(非預期錯誤回 INTERNAL_ERROR) | ✅ |

## 待辦

- 檔案類型白名單(PRD §11 #6)、相容路由公開與內網白名單(#15)、5144 金鑰更換(#8)定案後更新狀態。
