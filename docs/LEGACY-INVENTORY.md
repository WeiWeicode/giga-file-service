# GigaNexus 附件服務 — 舊系統盤點

> 本文件自 [PRD.md](PRD.md) §4 拆出(原 FILE-PLAN §3.1–§3.5),為該主題的唯一維護來源;PRD 僅保留摘要與連結。
> 對應 PRD 版本:**v0.7**(2026-10-08)。舊系統程式碼、資料表與檔案目錄**一律只讀、不修改**(D9,`AGENT.md` §7.1)。
> 本文件**不記錄帳密與連線字串**;主機位址只列判斷用途所需者。

---

## 1. GeneralBackend `filebackend`(:5124,過去主要的檔案後端)

| 項目 | 現況 |
| --- | --- |
| 存放 | 容器 `/usr/src/app/files/{SourcePlatform}/`,docker-compose bind mount 到主機 `./filebackend/files`;目前有 `BPM`、`CRM`、`ERP`、`MES` |
| 實體檔名 | `{uuid}{副檔名}`(multer diskStorage + `sanitize-filename`) |
| 資料表 | `WebAppDb.dbo.webFileUpload`(10.10.130.220);主鍵 `id INT IDENTITY` |
| 欄位 | `filename`、`originalName`、`filesize`、`mimetype`、`path`、`destination`、`Description`、`SourcePlatform`、`SourceApplication`、`SourceNumber`(來源單號)、`userAgent`、`userNumber`、`Effective`(軟刪除)、`storageType`、`ip`、`version`、`nasPath`、`uploadDate` |
| API | `/sql-upload`、`/sql-upload-multiple`、`/sql-files`、`/sql-files-by-source?sourceNumber=`、`/sql-download/:id`、`/sql-delete/:id`;另有不寫 DB 的 `/upload`、`/files/:platform/:filename` |
| 問題 | 下載以**遞增整數 id**,可被逐號猜測;無登入驗證(靠內網);`nasPath` 欄位有定義但沒有實際備份流程 |

## 2. GeneralBackend `SMBbackend`(:5125)

| 項目 | 現況 |
| --- | --- |
| 由來 | 原本以 SMB 連 166 主機(舊員工入口網)目錄;需求方要求放到新主機後改為本機存放,SMB 設定只保留未使用 |
| 存放 | 容器 `/usr/src/app/files/{使用者自訂路徑}/`;multer memoryStorage,上限 100 MB |
| 實體檔名 | `/db/upload` 為 `{uuid}{副檔名}`;**從舊主機搬來的檔案仍是中文原檔名**(例 `電子發票設定.docx`) |
| 資料表 | `WebAppDb.dbo.smbFileUpload`,**欄位與 `webFileUpload` 完全相同,但為不同資料表** |
| 差異 | `path` 意義不同:filebackend 是「平台 / uuid」,SMB 是「使用者選的目錄 / uuid」,並提供目錄瀏覽(`/files`)與依路徑下載 |
| 問題 | `localdownload` 以 `path.join(localFilesPath, 參數)` 取檔,**未檢查 `../`**,可讀到 files 目錄以外的容器檔案;找不到時還會以檔名在整個目錄樹搜尋(同名檔可能拿錯)。**依 D9 只記錄、不修改**,新服務不提供依路徑取檔([SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md)) |

## 3. old_PortalSolar(ASP.NET WebForms,166 主機)

實體檔案以**原檔名**存在 `D:\WWW\PortalSolar\` 下(UNC `\\10.10.130.166\PortalSolar\`),資料庫只存檔名;下載是**不需登入**的公開網址。程式碼中找到的存檔位置:

| 目錄 | 用途 | 程式 | 資料庫存法 |
| --- | --- | --- | --- |
| `EHS\License` | 環安證照 | `EHS/EHLicense`、`EHS/EHItemEdit` | 檔名;**同名直接覆蓋** |
| `PropertyFile` | 部門 / 個人財產照片 | `DeptPropertyInfo`、`PersonalPropertyInfo`、`GAffairs` | `PicFile`(檔名) |
| `Document` | 行事曆 PDF、TV 輪播圖、代理人名單 | `Schedule`、`TVDemo`、`TVDemoSetting`、`HR` | `ImgPath`;同名加 `_n` |
| `PersonalPic`、`PearsonPic` | 員工照片(工號.jpg) | `ExtensionTable`、`HRPromoteMap` | 不存 DB,以工號組檔名 |
| `html` | 公告內容 | `html/PublicContentX` | — |
| `EIP` | 同意書簽名圖 | `Consent8`、`GSCConsentX`、`GSMCConsentX` | — |
| QA 附件 | 問卷題目附件 | `QA/QuestSetting` | — |
| `ESLearning`(166 網站根) | 教育訓練影片 mp4 | `ES_ELearning` | 下拉選單值組路徑 |
| **`SDSFILES`(10.10.130.190)** | 化學品安全資料表 | `EHS/EHCHEMICALInfo` | `physicalName` + `extentionName`(與 BPM `NoCmDocument` 同樣的欄位命名,**推測為 BPM 附件**,見 §5,待確認 PRD §11 #10) |

- 涉及資料庫:`PortalSolar`、`Budget`、`LOS`、`LearnDB`、`MBO`,分布在 10.10.10.174、10.10.130.190、10.10.130.220。
- 以上只來自程式碼搜尋,**實際目錄與檔案數量需 F0 盤點確認**(可能還有程式未引用的目錄)。
- 166 的同步與 UUID 對照方式見 [MIGRATION.md](MIGRATION.md) §3(D14)。

## 4. 舊服務實際使用情形(122 生產區 log 與資料表統計)

### 4.1 filebackend log

來源:122 主機 `D:\GeneralBackend\filebackend\logs\`(`error.log`、`file-upload.log` 最後修改 2026-08-04、輪替檔 `file-upload1.log` 最後修改 2026-10-05)。每行一筆 JSON(winston),欄位:`ip`、`method`、`url`、`userAgent`、`message`、`timestamp`;下載另有 `id`、`filename`、`originalName`、`platform`、`size`。範例:

```json
{"ip":"::ffff:172.19.0.1","message":"GET /sql-download/140","method":"GET","url":"/sql-download/140","userAgent":"Mozilla/5.0 … Chrome/150.0.0.0 Safari/537.36","timestamp":"2026-08-04T08:58:44.780Z"}
{"id":140,"filename":"5aab33ac-7d26-482d-9abc-3159ee49f887.png","originalName":"20260312-KQ09.png","platform":"BPM","message":"SQL 檔案下載","size":34892}
{"count":66,"returned":50,"platform":"all","message":"從資料庫檢索檔案列表"}
```

觀察:

1. **仍在使用**:最新輪替檔在 2026-10-05 仍有寫入。
2. **呼叫者是瀏覽器**(`userAgent` 為 Chrome),從使用者電腦直接呼叫 `122:5124`,主要是 `GET /sql-files` 與 `GET /sql-download/{id}`,和 BPM `FileUpload.vue` 的行為一致。
3. **看不到真實來源 IP**:`ip` 一律是 Docker 橋接閘道(`::ffff:172.19.0.1`),不能用 IP 判斷誰在用。要判斷哪些平台 / 應用還在用,改查資料庫 `webFileUpload` 的 `SourcePlatform`、`SourceApplication`、`userNumber` 與最近上傳時間(§4.2)。
4. **`/sql-files` 的既有缺陷**:前端不帶參數(`platform:"all"`),後端預設只回 50 筆;log 顯示 `count: 66, returned: 50`。`FileUpload.vue` 拿到這 50 筆後才在前端依 `sourceNumber` 篩選,所以**有效檔超過 50 筆之後,較舊單據的附件在畫面上就查不到**。相容層需處理([API.md](API.md) §4.4 規則 8)。
5. **量體很小**:2026-08-04 有效檔 66 筆、`id` 至少到 140(含已刪除);filebackend 的搬遷量小,不需要分批。

### 4.2 `webFileUpload` 依平台 / 應用統計

2026-10-08 於 122 生產區查詢(`SourcePlatform`、`SourceApplication`、筆數、有效筆數、最近上傳)。`SourceApplication` 的格式是 `{應用}_{類別}`(`FileUpload.vue` 以網址參數 `sourceApplication` 加 `class` 組成):

| 應用 | 類別(筆數 / 有效) | 合計 | 有效 | 最近上傳 |
| --- | --- | --- | --- | --- |
| 太陽能ECRECN | 內容說明(BPM 46 / 28、OTHER 11 / 9)、規格(BPM 6 / 4) | 63 | 41 | 2026-10-01 |
| 特用膠材ECRECN | 內容說明(BPM 18 / 17、OTHER 2 / 1)、規格(BPM 4 / 4、OTHER 1 / 1)、其他(BPM 4 / 4) | 29 | 27 | 2026-08-05 |
| SpecialGlueApprovalDocs(OTHER) | PPAP(5 / 5)、客戶回簽(9 / 5)、承認書(6 / 0) | 20 | 10 | 2026-08-28 |
| 碩禾ECRECN會簽系統 | 內容說明(7 / 7)、規格(3 / 3) | 10 | 10 | 2026-05-07 |
| MIS反應單 | User上傳(5 / 1)、User資料(2 / 0)、報修單(2 / 1)、測試(4 / 0)、測試_User上傳(2 / 0) | 15 | 2 | 2025-09-04 |
| NotesApp / Notes / NoteAPp | NotesApp_碩禾特用膠材ECRECN(5 / 5)、…_User資料(1 / 1)、Notes(1 / 1)、NoteAPp(1 / 1) | 8 | 8 | 2025-10-09 |
| BPM_測試(OTHER) | — | 6 | 5 | 2025-09-04 |
| **合計** | | **151** | **103** | |

6. **只有 `BPM`、`OTHER` 兩種平台**:`CRM`、`ERP`、`MES` 在資料庫裡沒有任何資料列(`files/` 下雖有同名目錄,F0 要確認是否為測試檔或孤兒檔)。`platform` 由呼叫端的網址參數決定,同一個應用(例如 `太陽能ECRECN_內容說明`)同時出現 `BPM` 與 `OTHER`,**搬遷與相容層都不正規化**,照原值保留。
7. **呼叫者全部是 BPM 表單**:ECR / ECN(工程變更)系列三套、特用膠材承認書(`SpecialGlueApprovalDocs`)、MIS 反應單、NotesApp,皆經 `FileUpload.vue`;沒有其他系統的資料列。最近的上傳是 2026-10-01(`太陽能ECRECN_內容說明`),使用中;`MIS反應單`、`NotesApp` 最近上傳停在 2025-09 / 10,疑似已停用。
8. **`SourceApplication` 不要拆**:`_` 之後是類別,但名稱本身也可能含 `_`(例 `MIS反應單_測試_User上傳`),無法可靠地拆回「應用」與「類別」。新服務 `source_app` 存**完整字串**,相容層原樣回傳。
9. **測試與已刪除資料**:`*_測試`、`BPM_測試`、`承認書`(有效 0 筆)等是測試或已全數刪除的資料,F0 搬遷時以 `Effective` 為準,測試資料是否搬由需求方決定(預設只搬 `Effective = 1`,其餘只留對照紀錄)。

### 4.3 `smbFileUpload` 統計

2026-10-08 於 122 生產區查詢:

| `SourcePlatform` | `SourceApplication` | `destination` | 筆數 | 有效 | UUID 檔名 | 其他檔名 | 最近上傳 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Web | BPM系統 | 根目錄 | 83 | 54 | 8 | 75 | 2026-10-07 18:31 |

- **只有一個呼叫者**:全部是 `Web` / `BPM系統`,即 BPM `SPfileUpload.vue`;最近上傳在 2026-10-07,使用中。
- **全部放在根目錄**:沒有任何子目錄(`destination` 全為「根目錄」),所以 SMB 的目錄瀏覽 / 自訂路徑功能實際上沒有被使用,`path` 就等於實體檔名。
- **檔名**:只有 8 筆是 `{uuid}{副檔名}`,**75 筆不是**(推測為舊主機搬來、或 UUID 機制上線前上傳的中文原檔名,F0 以 NAS `CP` 實際檔案確認)。這 75 筆的 `path` 就是原檔名,舊前端用它下載與刪除,相容層必須查得到([API.md](API.md) §4.4 規則 12)。
- **量體很小**(83 筆,有效 54 筆),可一次完成。有效筆數 × 檔名類型的交叉、以及這 83 筆在 NAS `CP` 是否都有實體檔,待 F0。

兩個舊服務合計:**234 筆,有效 157 筆**,皆為 BPM 表單附件。

## 5. BPM 表單附件(Attachment)

BPM(NaNa)的表單附件由 BPM 系統自己存放;需求方已在 BPM 主機架設取檔服務,另有 `D:\檔案分享\程式碼\BPM\BPMbackend`(:5149)提供查詢與轉發下載。

| 項目 | 現況 |
| --- | --- |
| 主機 | 正式區 **10.10.130.190**、測試區 **10.10.130.191**;資料庫皆為 `NaNa` |
| 附件資料 | `NoCmDocument`:`OID`(Doid)、`logicalName`(中文原檔名)、`physicalName`(加密檔名,例 `x5491d50x140f277331dx1005`)、`extentionName`、`formInstanceOID` |
| 與表單的關聯 | `ProcessInstance.serialNumber`(單號)→ `LocalRelevantData` → `FormInstance` → `NoCmDocument.formInstanceOID` |
| 路徑索引 | `NaNa.dbo.localAttachmentPath`:`fileName`(= physicalName,PK)、`fileWholeName`、`fileType`、`filePath`、`URL`、`fileCreation`;查詢時 LEFT JOIN,**目前下載邏輯沒有使用它** |
| 取檔服務 | `http://{190 / 191}:5144/download/{目錄}/{physicalName}{副檔名}`,標頭 `X-API-Key` |
| 目錄規則 | physicalName 每 2 字元切段、去掉第 1 段後**反向**組成目錄;段數不固定,BPMbackend 依序嘗試 11 → 10 → 12 段,前一次回 `File not found` 才試下一個 |
| BPMbackend API | `/attachment/serialNumber/:serialNumber`、`/attachment/physicalName/:physicalName`、`/attachment/download/:Doid`、`/attachment/url/:Doid`;`/test/attachment/*` 對應測試區 |

問題:

1. **X-API-Key 由呼叫端帶入、BPMbackend 原樣轉送**,等於呼叫 BPMbackend 的一方要持有 5144 的金鑰;且金鑰明碼寫在 `AttachmentController.js` 註解並已進 git,**建議更換金鑰**(PRD §11 #8)。
2. 依單號查詢用 `LIKE '%單號%'`,部分字串會比對到其他表單的附件。
3. 最多打 3 次 5144 才找到檔案;`localAttachmentPath.filePath` 若完整,可直接取得路徑。
4. 下載的 `Content-Disposition` 只有 `filename="%E4..."`,部分瀏覽器中文檔名會顯示成編碼字串。
5. 沒有使用者身分與權限檢查:知道 Doid 就能下載任何表單的附件。

新服務的做法(D10–D12)見 [API.md](API.md) §3。
