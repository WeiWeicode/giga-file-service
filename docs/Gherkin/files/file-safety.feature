# language: zh-TW
# 檔案安全(SECURITY-CHECKLIST S1、S4、S7–S13;AGENT.md §7.3)
@F1 @security
功能: 檔案安全檢查
  為了避免舊系統「逐號猜下載、路徑穿越、上傳執行檔」的問題重現
  身為附件服務
  我只接受 Gateway 身分、只用 UUID 取檔,並檢查檔案類型與大小

  場景: 沒有內部 Token 一律拒絕
    當 不帶 X-Internal-Token 呼叫 GET /api/file/files
    那麼 回應 401,code 為 "FILE_INTERNAL_TOKEN_INVALID"

  場景: Token 的 audience 不是 file-api 時拒絕
    當 以 audience 為 "go-mes" 的 Token 呼叫 GET /api/file/files
    那麼 回應 401

  場景大綱: 拒絕執行檔與腳本
    當 使用者上傳 "<檔名>"
    那麼 回應 415,code 為 "FILE_TYPE_NOT_ALLOWED"
    而且 檔案根目錄與暫存目錄沒有留下任何檔案

    例子:
      | 檔名        |
      | setup.exe   |
      | run.bat     |
      | script.ps1  |
      | macro.vbs   |
      | page.html   |
      | 無副檔名     |

  場景: 副檔名與檔頭不符時拒絕
    當 使用者上傳 "偽裝.pdf",內容實際為 Windows 執行檔(檔頭 MZ)
    那麼 回應 415,code 為 "FILE_CONTENT_MISMATCH"
    而且 沒有留下暫存檔與資料庫紀錄

  場景: 多檔上傳其中一個不合格時整批拒絕
    當 使用者在同一個請求上傳 "ok.pdf" 與 "bad.exe"
    那麼 回應 415
    而且 "ok.pdf" 也沒有被保存

  場景: 超過 30 MB 拒絕
    當 使用者上傳 30 MB + 1 byte 的 "大檔.zip"
    那麼 回應 413,code 為 "FILE_TOO_LARGE"
    而且 暫存目錄沒有殘留檔案

  場景: SVG 不 inline
    假如 已上傳 "圖.svg"
    當 呼叫 GET /api/file/files/{fileUuid}/content?inline=1
    那麼 Content-Disposition 為 attachment

  場景: 不接受非 UUID 的檔案識別
    當 呼叫 GET /api/file/files/123/content
    那麼 回應 400,code 為 "VALIDATION_FAILED"

  場景: 實體路徑不可逃出檔案根目錄
    假如 資料庫中某筆 storage_key 被竄改為 "../../etc/passwd"
    當 下載該檔案
    那麼 回應 500,code 為 "INTERNAL_ERROR"
    而且 不讀取根目錄以外的任何檔案

  場景: 只能看到自己公司的檔案(第一版資料範圍,PRD §11 #5 待定)
    假如 公司 "碩禾" 的 S112009 上傳了一個檔案
    當 只屬於公司 "禾迅" 的 S200001 查詢該檔案
    那麼 回應 403,code 為 "DATA_ACCESS_DENIED"

  場景: 系統身分只能存取自己上傳的檔案
    假如 系統 client:bpm 上傳了一個檔案
    當 系統 client:crm 查詢該檔案
    那麼 回應 403,code 為 "DATA_ACCESS_DENIED"

  場景: 原檔名的路徑片段被移除
    當 使用者上傳檔名為 "..\\..\\evil.pdf" 的合法 PDF
    那麼 回應 201,originalName 為 "evil.pdf"
