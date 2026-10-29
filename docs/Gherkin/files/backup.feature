# language: zh-TW
# NAS 備份補傳、重試、還原(STORAGE.md §2;IMPL-PLAN F2)
@F2
功能: 附件備份到 NAS
  為了在主機 2 的磁碟損壞時仍能取回附件
  身為 IT 管理者
  我要每個附件都自動複製一份到 NAS,並能重試失敗的備份、從 NAS 還原遺失的檔案

  背景:
    假如 file-api 已啟動,BACKUP_ROOT 指向 NAS giga-files/{env}/,根目錄有標記檔 .giga-files-backup
    而且 BACKUP_MAX_ATTEMPTS 為 3

  場景: 補傳到 NAS 並驗證 SHA-256
    假如 已上傳 "報價單.pdf" 與 "b.txt",backup_status 為 pending
    當 備份排程執行一輪
    那麼 兩個檔案都複製到 NAS 的 {yyyy}/{mm}/{file_uuid},內容 SHA-256 與資料庫相同
    而且 backup_status 為 done、backup_at 有值,NAS 上不留 .part
    當 備份排程再執行一輪
    那麼 不重複備份

  場景: NAS 未掛載時跳過,不累計失敗,恢復後自動補
    假如 NAS 根目錄沒有標記檔(未掛載,Docker 建立的是本機空目錄)
    當 備份排程執行一輪
    那麼 整輪跳過,不寫入任何檔案,backup_attempts 不增加
    當 NAS 恢復(標記檔存在)後排程再執行
    那麼 檔案補傳完成

  場景: 失敗達門檻改為 failed 並告警一次
    假如 "a.pdf" 的本機實體檔遺失
    當 備份排程執行 3 輪
    那麼 前 2 輪仍為 pending,第 3 輪改為 failed
    而且 經 Gateway /api/notify/send 以範本 FILE_BACKUP_FAILED 寄 Email 給 BACKUP_ALERT_USERS 一次
    而且 其他檔案正常備份,failed 的檔案不再自動重試

  場景: 本機檔案內容與資料庫不符時不備份
    假如 "a.txt" 的本機內容被改動
    當 備份排程執行一輪
    那麼 不寫入 NAS,累計一次失敗

  場景: 未綁定暫存檔清除時一併移除 NAS 備份
    假如 未綁定的暫存檔已備份到 NAS
    當 超過 24 小時由排程清除
    那麼 本機與 NAS 的檔案都移除

  場景: 軟刪除不動 NAS 備份
    當 刪除已備份的檔案
    那麼 NAS 上的檔案仍在

  場景: 重試失敗的備份
    假如 有 2 個檔案備份失敗
    當 呼叫 POST /api/file/storage/backup/retry,指定其中 1 個 UUID
    那麼 回應 retried 為 1
    當 再呼叫一次,body 為 {}
    那麼 回應 retried 為 1,GET /api/file/storage 的 backup 為 pending 2、failed 0,失敗次數歸零

  場景: 未設定 NAS 備份的環境
    假如 未設定 BACKUP_ROOT
    那麼 GET /api/file/storage 的 backupEnabled 為 false
    而且 POST /api/file/storage/backup/retry 回 409 FILE_BACKUP_DISABLED

  場景: 刪除本機檔後以 CLI 還原且 SHA 相符(預設乾跑)
    假如 已備份的 "a.pdf" 本機實體檔被刪除
    當 執行 npm run restore(未加 --apply)
    那麼 列出 a.pdf 為 missing / dry-run,本機不寫入
    當 執行 npm run restore -- --apply
    那麼 a.pdf 從 NAS 還原,SHA-256 與資料庫相同

  場景: 本機內容不符時保留壞檔再還原;NAS 也不符時不寫入
    假如 "a.txt" 本機內容不符,"b.txt" 本機遺失且 NAS 上的內容也不符
    當 執行 npm run restore -- --apply
    那麼 a.txt 的壞檔改名為 {uuid}.corrupt-{時間} 保留後還原
    而且 b.txt 標記 nas-mismatch,不寫入本機
