# Gherkin 場景 ↔ 自動化測試對照表

> 比照 Gateway:Gherkin 維持驗收規格文件,自動化以 Node 內建測試(`node:test` + tsx)執行,本表記錄每個場景由哪個測試涵蓋。
> 「未自動化」註明原因;新增場景或測試時同步更新本表(IMPL-PLAN §6 完成定義)。
> 縮寫(皆在 `file-api/`):`F` = `test/files.test.ts`;`U` = `test/units.test.ts`;`I` = `test/inventory.test.ts`;`INT` = `test/int/files.int.test.ts`(SQL Server 2012,`npm run test:int`);`B` = `test/backup.test.ts`;`P` = `test/bpm.test.ts`(NaNa 記憶體 repo + 模擬 5144);`LB` = `test/legacy/bpm.legacy.test.ts`(真實 191 NaNa / 5144 唯讀,`npm run test:legacy`);`L` = `test/legacy/shares.legacy.test.ts`(真實 NAS / 166 唯讀,`npm run test:legacy`)。場景名稱與測試名稱相同。

## files/upload-download.feature(F1)

| 場景 | 測試 |
| --- | --- |
| 上傳單一檔案後取得 UUID,狀態為暫存 | F;INT(完整流程) |
| 一次上傳多個檔案 | F |
| 上傳時一併指定單號 | F |
| 單據存檔時綁定暫存檔 | F;INT(OUTPUT 回報筆數) |
| 不可綁定他人上傳的暫存檔 | F |
| 下載時帶 UTF-8 檔名 | F;U(Content-Disposition) |
| 圖片與 PDF 可以 inline 預覽 | F |
| 其他類型即使要求 inline 仍以附件下載 | F |
| 查詢清單依單號篩選並分頁 | F;INT(OFFSET FETCH) |
| 軟刪除後清單與下載都看不到,但實體檔保留 | F;INT |
| 已刪除的檔案再刪除回 404 | F;INT |
| 超過 24 小時未綁定的暫存檔由排程清除 | F;INT(expiredTemps) |
| 儲存與備份統計 | F;INT |

## files/file-safety.feature(F1)

| 場景 | 測試 |
| --- | --- |
| 沒有內部 Token 一律拒絕 | F |
| Token 的 audience 不是 file-api 時拒絕 | F |
| 拒絕執行檔與腳本(6 例) | F;U |
| 副檔名與檔頭不符時拒絕 | F;U |
| 多檔上傳其中一個不合格時整批拒絕 | F |
| 超過 30 MB 拒絕 | F(另測剛好 30 MB 可以上傳);Nginx 層(31m)測試區人工驗證 |
| SVG 不 inline | F |
| 不接受非 UUID 的檔案識別 | F |
| 實體路徑不可逃出檔案根目錄 | F;U |
| 只能看到自己公司的檔案 | F;INT(SQL 範圍條件) |
| 系統身分只能存取自己上傳的檔案 | F;INT |
| 原檔名的路徑片段被移除 | F;U |

## files/backup.feature(F2)

| 場景 | 測試 |
| --- | --- |
| 補傳到 NAS 並驗證 SHA-256 | B(NAS 以暫存目錄模擬);INT(markBackupDone) |
| NAS 未掛載時跳過,不累計失敗,恢復後自動補 | B |
| 失敗達門檻改為 failed 並告警一次 | B;INT(單一 UPDATE 累加與門檻);告警 Email 實寄待測試區人工驗證 |
| 本機檔案內容與資料庫不符時不備份 | B |
| 未綁定暫存檔清除時一併移除 NAS 備份 | B |
| 軟刪除不動 NAS 備份 | B |
| 重試失敗的備份 | B;INT(retryBackups) |
| 未設定 NAS 備份的環境 | B;U(設定) |
| 刪除本機檔後以 CLI 還原且 SHA 相符(預設乾跑) | B(restore 模組);INT(backedUp 逐批掃描);CLI 本身測試區人工執行 |
| 本機內容不符時保留壞檔再還原;NAS 也不符時不寫入 | B |

## bpm/attachments.feature(F6)

| 場景 | 測試 |
| --- | --- |
| 依單號完全比對 | P;LB(前綴相同的單號不混入) |
| 單號格式錯誤回 400;查無附件回空清單 | P |
| 查詢單一附件;Doid 不是 32 碼十六進位回 400,不存在回 404 | P;LB |
| 下載 BPM 附件並帶 UTF-8 檔名,寫入操作紀錄 | P;LB(真實 5144 取檔,預測段數第一次命中) |
| 預測段數找不到時改試 11 / 10 / 12,找到的段數快取,下次只打一次 | P(另有目錄規則單元:BPMbackend 註解範例、各長度候選段數) |
| 原檔名沒有副檔名時補上;?inline=1 只對 PDF / 圖片 | P |
| 實體檔找不到回 404 FILE_BPM_NOT_FOUND,不寫操作紀錄 | P |
| 5144 金鑰錯誤回 502 FILE_BPM_UPSTREAM | P |
| 5144 連不上回 502 | P |
| 資料庫的 physicalName 含路徑字元時拒絕,不送到 5144 | P |
| 未設定 BPM 的環境 | P |

## legacy/inventory.feature(F0)

| 場景 | 測試 |
| --- | --- |
| 盤點 NAS 上 filebackend 各平台目錄 | I(暫存目錄模擬);L(真實 NAS BPM / OTHER) |
| 盤點 SMB 備份(CP)辨識中文原檔名 | I;L(真實 NAS CP) |
| 盤點 166 PortalSolar 只掃資料目錄 | I;L(真實 166 EHS) |
| 來源連不到時明確標示未查詢 | I |
| 個別檔案讀不到屬性時列入錯誤清單 | I |
| 盤點絕不修改來源 | I(spy:只呼叫 readdir / stat / openRead,前後快照相同);L(真實來源含 SHA-256 掃描前後快照相同) |
| 盤點報告寫到本機輸出目錄 | 未自動化(CLI `npm run inventory` 手動執行;輸出目錄位於來源之下時拒絕,程式審查) |
