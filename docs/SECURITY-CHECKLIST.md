# GigaNexus 附件服務 — 資安檢查清單

> 本文件自 [PRD.md](PRD.md) §9 拆出(原 FILE-PLAN §11),為該主題的唯一維護來源;格式比照 Gateway [SECURITY-CHECKLIST.md](../../giga-api-gateway-bff/docs/SECURITY-CHECKLIST.md)。
> 狀態:✅ 已實作並有驗證 ・ 🔶 已實作、待實測 ・ ⚠️ 已核准的例外 / 暫停 ・ ❌ 未做。
> 最後檢查:2026-10-08(**尚無程式碼**,全部為規劃;F1 起逐項更新)。

## 身分與存取控制

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S1 | 只接受 Gateway 身分 | 只信任 `X-Internal-Token`(`@giganexus/backend-sdk` 驗證),dev 也不略過 | 單元:缺 / 偽造 / 過期 Token 回 401 | ❌ |
| S2 | 網路隔離 | port 51272 防火牆只開 Gateway 主機 | 部署後自他主機連線應失敗 | ❌ |
| S3 | 權限宣告 | 每支 API 有 `x-permission`,`npm test` 檢查 | 單元(OpenAPI 檢查) | ❌ |
| S4 | 資料層級 | 依 Token 的公司、部門與 `source_system` 過濾;無權回 `403 DATA_ACCESS_DENIED`;細節依接入系統再定 | 整合 | ❌ |
| S5 | BPM 附件權限 | 第一版 `file.bpm.read`(D12);限申請人 / 簽核人列為後續 | 整合 | ❌ |
| S6 | 相容層例外 | `/api/file/compat/*` `auth_mode = public` + Nginx 內網白名單;**不得放寬新 API**([API.md](API.md) §4.4 規則 4) | E2E:外網來源被拒 | ⚠️ 待 IT 核准(PRD §11 #15) |

## 檔案處理

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S7 | 只用 UUID 取檔 | 不暴露遞增 id、實體路徑、原檔名;**不提供依路徑 / 檔名取檔**(避免 [LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §2 的路徑穿越) | 單元 | ❌ |
| S8 | 路徑安全 | `path.resolve` 後確認落在根目錄之下;相容層以對照表查詢,不直接組路徑 | 單元:`../`、絕對路徑、編碼繞過 | ❌ |
| S9 | 檔案類型 | 副檔名白名單 + 檢查檔頭(magic number);拒絕執行檔、腳本(白名單待定,PRD §11 #6) | 單元 | ❌ |
| S10 | SVG / inline | `image/svg+xml` 一律以附件下載不 inline;`?inline=1` 只允許圖片 / PDF | 單元 | ❌ |
| S11 | 回應標頭 | `X-Content-Type-Options: nosniff`;`Content-Disposition` ASCII 後備 + `filename*=UTF-8''` | 單元 | ❌ |
| S12 | 大小上限 | 單檔 50 MB(D3),Nginx 與 file-api 兩層檢查 | E2E | ❌ |
| S13 | 原子寫入 | 先寫 `tmp/` 算 SHA-256 → rename → 寫 DB;失敗清暫存 | 單元 | ❌ |
| S14 | 防毒掃描 | ClamAV 擴充點保留在寫 DB 前,**暫不實作** | — | ⚠️ 範圍外 |

## 機密與舊系統

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S15 | BPM 取檔金鑰 | 5144 `X-API-Key` 只放 file-api 機密設定;瀏覽器與其他系統拿不到(D10);**建議更換**(舊金鑰已在 BPM repo 註解中) | 程式審查 | ❌(PRD §11 #8) |
| S16 | 唯讀帳號 | NaNa、166、NAS 舊備份目錄皆用唯讀帳號 / `ro` 掛載 | 部署檢查:試寫應失敗 | ❌ |
| S17 | 機密存放 | `*_FILE` Docker secret;不入版控、映像、日誌 | 程式審查、`git grep` | ❌ |
| S18 | 舊服務漏洞 | SMB `localdownload` 路徑穿越:**依 D9 只記錄不修**,風險靠新服務上線後舊服務下線處理 | — | ⚠️ 已核准的例外 |

## 稽核與日誌

| # | 項目 | 做法 | 驗證 | 狀態 |
| --- | --- | --- | --- | --- |
| S19 | 操作紀錄 | 上傳 / 下載 / 刪除 / 綁定 / BPM 下載寫 `file_access_log`,含 `X-Request-Id` | 整合 | ❌ |
| S20 | 日誌內容 | 不記錄帳密、Token、檔案內容 | 程式審查 | ❌ |
| S21 | 錯誤回應 | 不回傳堆疊或 SQL;相容層舊格式不外洩到新 API | 單元 | ❌ |

## 待辦

- 檔案類型白名單(PRD §11 #6)、相容路由公開與內網白名單(#15)、5144 金鑰更換(#8)定案後更新狀態。
