# GigaNexus 附件服務 — API 規格(草案)

> 本文件自 [PRD.md](PRD.md) §7 拆出(原 FILE-PLAN §8),為該主題的唯一維護來源;PRD 僅保留摘要與連結。
> 對應 PRD 版本:**v0.8**(2026-10-08)。**尚無程式碼**;實作後以 file-api 的 OpenAPI(`/openapi.json`,自動註冊到 Gateway 路由表)為準,本文件同步更新。
> 通用規範見 Gateway [BACKEND-GUIDE.md](../../giga-api-gateway-bff/docs/BACKEND-GUIDE.md) §4–§5、§7.5;本專案重點見 `AGENT.md` §8。

---

## 1. 共通規範

| 項目 | 內容 |
| --- | --- |
| 對外路徑 | 經 Gateway `/api/file/*`;後端路徑 `/v1/{resource}` 自動對應 `/api/file/{resource}`,相容層以 `x-gateway-path` 指定(§4) |
| 身分 | 只信任 Gateway 的 `X-Internal-Token`;權限由 BFF 依 `x-permission` 檢查,file-api 只做資料層級過濾(公司、部門、`source_system`) |
| 錯誤 | Gateway 統一格式 `{ code, message, requestId, details? }`,自訂代碼 `FILE_` 開頭;**相容層例外**(§4 規則 1) |
| 分頁 | `page`、`pageSize`(上限 100),回應 `{ items, total, page, pageSize }`;相容層 `/sql-files` 特例見 §4 規則 8 |
| 大小 | 單檔 50 MB(D3);大於 10 MB 的上傳走 Nginx `auth_request` 直送(D4-B,[ARCHITECTURE.md](ARCHITECTURE.md) §2) |
| 下載標頭 | `Content-Disposition` 同時給 ASCII 後備名與 `filename*=UTF-8''…`;`X-Content-Type-Options: nosniff` |
| 稽核 | 上傳 / 下載 / 刪除 / 綁定寫 `file_access_log`([DATABASE.md](DATABASE.md) §2) |

### 1.1 權限代碼

| 代碼 | 用途 |
| --- | --- |
| `file.object.read` | 新服務檔案清單、資訊、下載 |
| `file.object.upload` | 上傳、綁定單據 |
| `file.object.delete` | 軟刪除 |
| `file.bpm.read` | BPM 表單附件查詢 / 下載(D12) |
| `file.storage.read` | 容量與備份狀態 |
| `file.storage.manage` | 重試失敗的備份 |
| `file.legacy.read` | 舊系統盤點結果(唯讀) |

畫面節點與這些權限的綁定見 [PRD.md](PRD.md) §8。

## 2. 新服務檔案

| 方法 | 路徑 | 說明 | 權限 |
| --- | --- | --- | --- |
| POST | `/api/file/files` | 上傳(multipart `file`,可多檔;選填 `sourceApp`、`refType`、`refNo`) | `file.object.upload` |
| GET | `/api/file/files` | 清單(篩選來源系統、單號、上傳者、日期;分頁) | `file.object.read` |
| GET | `/api/file/files/:uuid` | 檔案資訊 | `file.object.read` |
| GET | `/api/file/files/:uuid/content` | 下載(`Content-Disposition` 含 UTF-8 檔名;`?inline=1` 預覽圖片 / PDF) | `file.object.read` |
| POST | `/api/file/files/bind` | 將暫存檔綁定到單據(`uuids[]`、`refType`、`refNo`) | `file.object.upload` |
| DELETE | `/api/file/files/:uuid` | 軟刪除 | `file.object.delete` |
| GET | `/api/file/storage` | 容量、備份統計、失敗清單 | `file.storage.read` |
| POST | `/api/file/storage/backup/retry` | 重試失敗的備份 | `file.storage.manage` |
| GET | `/api/file/inventory/*` | 舊系統盤點結果(唯讀) | `file.legacy.read` |
| GET | `/healthz`、`/openapi.json` | 健康檢查、Gateway 匯入 | 內網 |

**上傳兩段式(建議)**:畫面先上傳拿到 `file_uuid`(此時 `ref_no` 為空,屬暫存),單據存檔時再呼叫 `bind`;超過 24 小時未綁定的暫存檔由排程清除。避免「單據沒存成、檔案留下垃圾」。

## 3. BPM 附件(唯讀)

| 方法 | 路徑 | 說明 | 權限 |
| --- | --- | --- | --- |
| GET | `/api/file/bpm/forms/:serialNumber/attachments` | 依單號**完全比對**列出附件(Doid、原檔名、副檔名、表單名稱、主旨、建立日期) | `file.bpm.read` |
| GET | `/api/file/bpm/attachments/:doid` | 單一附件資訊 | `file.bpm.read` |
| GET | `/api/file/bpm/attachments/:doid/content` | 下載:先用 `localAttachmentPath.filePath`,沒有才依 [LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §5 目錄規則(11 → 10 → 12 段)向 5144 取檔;串流回傳,`filename*=UTF-8''` 中文檔名 | `file.bpm.read` |

- file-api 直接查 NaNa(唯讀帳號)並向 5144 取檔,不經 BPMbackend;5144 金鑰只放 file-api 機密設定(D10)。不複製檔案,即時代理(D11)。
- 環境由 file-api 設定決定(`BPM_ENV`:測試 → 191、正式 → 190),**不提供** `/test/*` 這類以路徑切換正式 / 測試的 API。
- 每次下載寫 `file_access_log`(`action = bpm_download`,記 Doid 與單號)。
- 找到正確的目錄段數後記在快取(Redis 或記憶體 LRU,key = physicalName),同一檔案不重複試。

## 4. 舊格式相容層(`/api/file/compat/*`,D15)

新舊 API 的網址**分開**:`/api/file/files*`、`/api/file/bpm/*` 是新 API(§2、§3,UUID、Gateway 統一格式);`/api/file/compat/{fb|smb|portal}/*` 是**舊格式相容層**,路徑與 JSON 照舊服務原樣,讓舊前端只換「基底網址」就能改打新服務。相容層是過渡用,舊前端都切換後下線。

| 舊服務 | 舊基底網址 | 相容層基底網址 | 舊前端 |
| --- | --- | --- | --- |
| GeneralBackend `filebackend` | `http://10.10.130.122:5124` | `https://<gateway>/api/file/compat/fb` | BPM `bpmcomonent/FileUpload.vue` |
| GeneralBackend `SMBbackend` | `http://10.10.130.122:5125` | `https://<gateway>/api/file/compat/smb` | BPM `bpmcomonent/SPfileUpload.vue` |
| 166 PortalSolar | `http://10.10.130.166/PortalSolar/...`(靜態網址,無 JSON) | `https://<gateway>/api/file/compat/portal/{目錄}/{原檔名}` | ASP.NET 頁面連結(選用,切換時才需要) |

### 4.1 filebackend 相容(`/api/file/compat/fb/…`)

共 7 支,回傳格式與 `sqlFileController.js` 一致。`FileUpload.vue` 實際使用其中 5 支(`/sql-files`、`/sql-upload`、`/sql-upload-multiple`、`/sql-download/:id`、`/sql-delete/:id`),`/sql-files-by-source`、`/sql-stats` 沒有已知呼叫者,列為選用:

| 方法 | 相容路徑 | 請求 | 回傳(沿用舊欄位) |
| --- | --- | --- | --- |
| POST | `/sql-upload` | multipart `file` + `platform`、`sourceApplication`、`sourceNumber`、`userNumber`、`description`、`version` | `{ success, message, file:{ id, filename, originalName, size, mimetype, path, destination, platform, uploadDate }, databaseLogged }` |
| POST | `/sql-upload-multiple` | multipart `files[]`(最多 10)+ 同上欄位 | `{ success, message, files:[…], databaseLogged }` |
| GET | `/sql-files` | `platform`、`limit`(預設 50)、`offset` | `{ success, total, files:[{ id, filename, originalName, size, mimetype, platform, uploadDate, description, sourceApplication, sourceNumber, version }] }` |
| GET | `/sql-files-by-source` | `sourceNumber`(必填) | 同 `/sql-files` |
| GET | `/sql-download/:id` | — | 檔案串流;`Content-Disposition: attachment; filename="ASCII 後備"; filename*=UTF-8''…`,並帶 `Access-Control-Expose-Headers: Content-Disposition` |
| DELETE | `/sql-delete/:id` | — | `{ success, message }`(軟刪除) |
| GET | `/sql-stats` | — | `{ success, stats:{ totalFiles, totalSize, averageSize, platforms[], fileTypes[] } }` |

### 4.2 SMBbackend 相容(`/api/file/compat/smb/…`)

相容層基底後面**保留舊的 `/api/…` 尾段**,舊前端只改基底常數、不改呼叫路徑。`SPfileUpload.vue` 實際使用 4 支(`/api/db/upload`、`/api/db/search`、`/api/db/delete`、`/api/download`),`/api/db/files`、`/api/db/files/:id` 沒有已知呼叫者,列為選用:

| 方法 | 相容路徑 | 請求 | 回傳 |
| --- | --- | --- | --- |
| POST | `/api/db/upload` | multipart `file` + `path`、`description`、`sourcePlatform`、`sourceApplication`、`sourceNumber`、`userNumber`、`storageType`、`version` | `{ success, message, data:{ id, fileName, originalFileName, path, size, mimetype, uploadDate, description, userNumber, ip, effective } }`;失敗另有 `errorCode`、`data.errorDescription` |
| GET | `/api/db/search` | `sourceNumber`、`effective`、`originalName`、`sourceApplication`、`userNumber`、`startDate`、`endDate`… | `{ success, count, data:[資料列全欄位] }` |
| GET | `/api/db/files`、`/api/db/files/:id` | `includeInactive` | `{ success, count, data }` / `{ success, data }` |
| DELETE | `/api/db/delete` | `path` | `{ success, message, data }` |
| GET | `/api/download` | `path` | 檔案串流 |

資料列欄位(`data[]` 與 `/db/files`)沿用 `smbFileUpload`:`id, filename, originalName, filesize, mimetype, path, destination, Description, SourcePlatform, SourceApplication, SourceNumber, userAgent, userNumber, Effective, storageType, ip, version, nasPath, uploadDate`。

### 4.3 不複製的舊端點

`filebackend` 的 `/upload`、`/files/:platform/:filename`(不寫 DB 的直接存取)、`SMBbackend` 的 `/api/files`(目錄瀏覽)、`/api/delete`、`/api/upload`、`/api/localdownload`(含路徑穿越問題,[LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §2)—— 沒有已知前端使用,相容層不提供。

### 4.4 相容層規則

1. **只有這一組路由使用舊格式**:錯誤也回舊式 `{ success:false, message, error }`,不是 Gateway 的 `{ code, message, requestId }`;新 API(§2、§3)一律用 Gateway 格式。
2. **對照舊欄位**:舊 `id`(整數)對照 `legacy_file_map.legacy_key`,新上傳的檔案以 UUID 字串當 `id`(舊前端把 `id` 當不透明值帶回 URL,不做數值運算);`/sql-download/:id`、`/sql-delete/:id` 同時接受舊整數 id 與 UUID。`path`、`filename` 在 SMB 沿用 `{目錄}/{uuid}{副檔名}` 格式。
3. **欄位對應**:`SourcePlatform → source_system`、`SourceApplication → source_app`、`SourceNumber → ref_no`、`userNumber → uploaded_by`、`Effective → deleted_at IS NULL`、`filesize → size_bytes`、`mimetype → mime`。
4. **身分**:舊前端(嵌在 BPM 表單內)沒有 Gateway 登入,和現況一樣只帶 `userNumber`。相容路由建議 `auth_mode = public`(需 IT 核准,PRD §11 #15)並由 Nginx **只放行內網來源**,等同現況的暴露程度;不得因此放寬新 API(§2)的驗證。
5. **上傳進哪裡**:切換之後,舊前端的新上傳進新服務(UUID 檔),舊服務不再收到新檔。因此**某個舊服務的歷史檔案([MIGRATION.md](MIGRATION.md) §2)搬完並驗證後,才切換該服務的前端**。
6. **大小**:相容上傳路由比照 D3 / D4 的 50 MB 直送路徑(舊 SMB 上限 100 MB,超過者先在畫面提示)。
7. 資料庫連不上時舊 `filebackend` 會「退回只存檔案系統」(`databaseLogged:false`);相容層**不退回**,直接回 503,避免檔案沒記錄。
8. **`/sql-files` 預設筆數**([LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §4.1 觀察 4):舊預設只回 50 筆,而 `FileUpload.vue` 在前端篩 `sourceNumber`,造成較舊單據查不到。相容層**沒帶 `limit` 時回傳全部有效檔(上限 1000)**,有帶 `limit` / `offset` 時照舊;這是**刻意與舊行為不同**的缺陷修正(PRD §11 #16)。前端若之後改用 `/sql-files-by-source` 則不受影響。
9. **CORS**:舊前端是瀏覽器跨來源直接呼叫。改走 Gateway 後 CORS 由 Gateway 處理,需請 Gateway 負責人把 BPM 前端的來源加入白名單,並暴露 `Content-Disposition`(舊服務已設 `Access-Control-Expose-Headers`),否則下載的中文檔名會取不到(PRD §11 #16)。
10. **平台白名單**:上傳時 `platform` 只接受 `MES`、`BPM`、`CRM`、`ERP`、`OTHER`(不分大小寫,轉大寫),其他值回 400 `{ success:false, message:"無效的平台名稱" }`,與舊服務一致;`platform` 值照呼叫端原樣存入([LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §4.2 觀察 6)。
11. **`sourceApplication` 原樣存取**:不拆 `{應用}_{類別}`([LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §4.2 觀察 8);`/sql-files` 回傳的 `sourceApplication`、`platform`、`sourceNumber` 與寫入時完全相同,前端才能繼續用它們做篩選。
12. **SMB 的 `path` 查找**([LEGACY-INVENTORY.md](LEGACY-INVENTORY.md) §4.3):舊前端以 `path` 下載與刪除。舊資料列的 `path` 有 `{uuid}{副檔名}` 與中文原檔名兩種,相容層以 `legacy_file_map`(`legacy_source = smbbackend`,`legacy_dir` + `legacy_name` 或 `legacy_key` = 舊 `id`)查找,**兩種都要查得到**;新上傳的檔案 `path` 為 `{uuid}{副檔名}`。因為新檔一律是 UUID,相容層不會再回 `409 FILE_EXISTS`(舊前端處理該情形的程式保留無害)。`sourcePlatform` 預設 `Web`、`sourceApplication` 預設 `SMB文件管理系統`、`version` 預設 `1.0`、`storageType` 預設 `Local`,與舊服務一致。
