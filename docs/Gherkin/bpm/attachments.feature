# language: zh-TW
# BPM 表單附件唯讀查詢與下載(API.md §3;IMPL-PLAN F6;D10 / D11 / D12)
@F6
功能: BPM 表單附件
  為了不必經過 BPMbackend、也不讓前端持有 5144 金鑰
  身為有 file.bpm.read 的使用者
  我要依 BPM 單號查詢表單附件並下載,由 file-api 唯讀查 NaNa、向 5144 即時取檔

  背景:
    假如 file-api 設定了 BPM 來源(各自的 NaNa 唯讀帳號 file_bpm_ro、5144 位址與金鑰)
    而且 使用者 S112009 擁有 file.bpm.read

  場景: 依單號完全比對
    假如 BPM 有單號 "CustomerComplaintProcess00000014" 與 "CustomerComplaintProcess000000140" 的表單附件
    當 呼叫 GET /api/file/bpm/forms/CustomerComplaintProcess00000014/attachments
    那麼 回應 200,只列出 CustomerComplaintProcess00000014 的附件,依建立時間排序
    而且 每筆有 doid、originalName、ext、formName、subject、createdAt(台灣時間轉 UTC),不含 physicalName

  場景: 單號格式錯誤回 400;查無附件回空清單
    當 單號含英數、底線、連字號以外的字元
    那麼 回應 400
    當 單號格式正確但沒有附件
    那麼 回應 200,items 為空

  場景: 查詢單一附件;Doid 不是 32 碼十六進位回 400,不存在回 404
    當 呼叫 GET /api/file/bpm/attachments/{doid}(大小寫皆可)
    那麼 回應 200,含所屬單號

  場景: 下載 BPM 附件並帶 UTF-8 檔名,寫入操作紀錄
    當 呼叫 GET /api/file/bpm/attachments/{doid}/content
    那麼 file-api 以 X-API-Key 向 5144 取 /download/{目錄}/{physicalName}.{副檔名},串流回傳
    而且 Content-Disposition 含 filename*=UTF-8 中文原檔名,Content-Type 依副檔名
    而且 file_access_log 新增 action = bpm_download、detail = "{doid} {單號}"

  場景: 預測段數找不到時改試 11 / 10 / 12,找到的段數快取,下次只打一次
    假如 實體檔不在「去掉第一段與最後一段」推算的目錄
    當 下載該附件
    那麼 依序改試 11、10、12 段,找到後記住段數
    當 再下載一次
    那麼 只向 5144 發一次請求

  場景: 原檔名沒有副檔名時補上;?inline=1 只對 PDF / 圖片
    當 原檔名 "IT11150520 黏度過低異常"、副檔名 xls 的附件以 ?inline=1 下載
    那麼 下載檔名為 "IT11150520 黏度過低異常.xls",以附件下載(不 inline)

  場景: 實體檔找不到回 404 FILE_BPM_NOT_FOUND,不寫操作紀錄
  場景: 5144 金鑰錯誤回 502 FILE_BPM_UPSTREAM
  場景: 5144 連不上回 502
  場景: 資料庫的 physicalName 含路徑字元時拒絕,不送到 5144
    假如 NoCmDocument 的 physicalName 為 "../../../etc/passwd"
    當 下載該附件
    那麼 回應 500 FILE_BPM_BAD_RECORD,不向 5144 發出請求

  場景: 列出 BPM 來源;?env= 切換來源,未指定用預設來源
    假如 file-api 設定了測試區 191(BPM_TEST_*)與正式區 190(BPM_PROD_*)
    當 呼叫 GET /api/file/bpm/sources
    那麼 items 有 test(測試區 10.10.130.191)與 prod(正式區 10.10.130.190),defaultEnv 為 test
    當 呼叫 GET /api/file/bpm/forms/{單號}/attachments?env=prod
    那麼 查的是正式區 NaNa,回應 env 為 prod
    而且 正式區的 Doid 不帶 env=prod 查詢時回 404

  場景: 下載紀錄含來源 env
    當 下載 ?env=prod 的附件
    那麼 file_access_log 的 detail 結尾為 " prod"

  場景: 只設定其中一個來源時,另一個回 409
    假如 只設定測試區
    那麼 ?env=prod 回 409 FILE_BPM_DISABLED(訊息含「正式區」),sources 只有 test

  場景: 未設定 BPM 的環境
    假如 未設定 BPM_DB_HOST
    那麼 /api/file/bpm/* 回 409 FILE_BPM_DISABLED,路由仍在 OpenAPI(自動註冊到 Gateway)
