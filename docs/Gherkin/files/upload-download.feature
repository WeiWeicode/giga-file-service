# language: zh-TW
# 附件上傳、綁定、下載、軟刪除(API.md §2;IMPL-PLAN F1)
@F1
功能: 新服務檔案的上傳與下載
  為了讓各系統不再各自存檔
  身為已登入的使用者或系統
  我要上傳附件拿到 file_uuid,單據存檔時再綁定,之後以 UUID 下載

  背景:
    假如 file-api 已啟動,檔案根目錄為空的暫存目錄
    而且 使用者 S112009 屬於公司 "碩禾"、擁有 file.object.read、file.object.upload、file.object.delete

  場景: 上傳單一檔案後取得 UUID,狀態為暫存
    當 使用者以 multipart 上傳 "報價單.pdf"(內容為合法 PDF)到 POST /api/file/files
    那麼 回應 201
    而且 回應 items 有 1 筆,fileUuid 為 UUID v4 格式
    而且 originalName 為 "報價單.pdf"、refNo 為 null、backupStatus 為 "pending"
    而且 實體檔存在於 "{yyyy}/{mm}/{fileUuid}",檔名不含副檔名與原檔名
    而且 資料庫記錄的 sha256 與檔案內容相符
    而且 file_access_log 有一筆 action 為 "upload"

  場景: 一次上傳多個檔案
    當 使用者在同一個請求上傳 "a.png" 與 "b.xlsx"
    那麼 回應 201,items 有 2 筆且 fileUuid 不同

  場景: 上傳時一併指定單號
    當 使用者上傳 "規格.pdf",欄位 refType 為 "ecr"、refNo 為 "ECR-2026-001"
    那麼 回應 201,refNo 為 "ECR-2026-001",boundAt 不為 null

  場景: 單據存檔時綁定暫存檔
    假如 使用者已上傳 2 個暫存檔
    當 呼叫 POST /api/file/files/bind,內容為 uuids 兩筆、refType "ecr"、refNo "ECR-2026-002"
    那麼 回應 200,bound 為 2
    而且 兩筆檔案的 refNo 皆為 "ECR-2026-002"
    而且 file_access_log 各有一筆 action 為 "bind"

  場景: 不可綁定他人上傳的暫存檔
    假如 使用者 S100001 上傳了一個暫存檔
    當 使用者 S112009 嘗試綁定該檔案
    那麼 回應 403,code 為 "DATA_ACCESS_DENIED"
    而且 該檔案仍為暫存

  場景: 下載時帶 UTF-8 檔名
    假如 已上傳 "電子發票設定.docx"
    當 呼叫 GET /api/file/files/{fileUuid}/content
    那麼 回應 200,內容與上傳時完全相同
    而且 Content-Disposition 為 attachment,含 ASCII 後備檔名與 filename*=UTF-8''%E9%9B%BB...
    而且 X-Content-Type-Options 為 "nosniff"
    而且 file_access_log 有一筆 action 為 "download"

  場景: 圖片與 PDF 可以 inline 預覽
    假如 已上傳 "照片.png"
    當 呼叫 GET /api/file/files/{fileUuid}/content?inline=1
    那麼 Content-Disposition 為 inline

  場景: 其他類型即使要求 inline 仍以附件下載
    假如 已上傳 "清單.xlsx"
    當 呼叫 GET /api/file/files/{fileUuid}/content?inline=1
    那麼 Content-Disposition 為 attachment

  場景: 查詢清單依單號篩選並分頁
    假如 已上傳 3 個檔案,其中 2 個綁定 refNo "ECR-2026-003"
    當 呼叫 GET /api/file/files?refNo=ECR-2026-003&page=1&pageSize=1
    那麼 回應 total 為 2、items 有 1 筆、page 為 1、pageSize 為 1

  場景: 軟刪除後清單與下載都看不到,但實體檔保留
    假如 已上傳 "待刪.pdf"
    當 呼叫 DELETE /api/file/files/{fileUuid}
    那麼 回應 204
    而且 GET /api/file/files/{fileUuid} 回應 404,code 為 "FILE_NOT_FOUND"
    而且 清單不包含該檔案
    而且 實體檔仍存在(不刪實體檔、不刪 NAS)
    而且 file_access_log 有一筆 action 為 "delete"

  場景: 已刪除的檔案再刪除回 404
    假如 檔案已被軟刪除
    當 再次呼叫 DELETE /api/file/files/{fileUuid}
    那麼 回應 404,code 為 "FILE_NOT_FOUND"

  場景: 超過 24 小時未綁定的暫存檔由排程清除
    假如 有一個暫存檔建立於 25 小時前、一個已綁定檔建立於 25 小時前、一個暫存檔建立於 1 小時前
    當 執行暫存檔清除
    那麼 只有 25 小時前的暫存檔被標記刪除(deleted_by 為 "system:temp-cleanup")
    而且 其實體檔被移除;已綁定檔與 1 小時前的暫存檔不受影響

  場景: 儲存與備份統計
    假如 已上傳 2 個檔案(備份狀態 pending)
    當 擁有 file.storage.read 的使用者呼叫 GET /api/file/storage
    那麼 回應 files 為 2、bytes 為兩檔大小總和、backup.pending 為 2
