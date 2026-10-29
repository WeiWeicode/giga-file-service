# language: zh-TW
# 舊格式相容層(API.md §4、規則 1–17;IMPL-PLAN F7;LEGACY-SWITCH-PLAN.md)
@F7
功能: BPM 舊前端只換基底網址就能改用新服務
  為了讓 FileUpload.vue(filebackend)與 SPfileUpload.vue(SMBbackend)不改程式就能切換
  身為附件服務
  我以舊服務的路徑與 JSON 回應,但檔案一律存成新服務的 UUID 檔

  場景: filebackend 單檔上傳回應與舊服務相同
    當 以 multipart 欄位 file 上傳 "報價單.pdf" 到 /compat/fb/sql-upload,platform "BPM"、sourceNumber "ECR-2026-001"
    那麼 回應 success 為 true、databaseLogged 為 true
    而且 file 的欄位為 id、filename、originalName、size、mimetype、path、destination、platform、uploadDate,id 為 UUID

  場景: 無效的平台名稱與執行檔回舊式錯誤
    當 platform 為 "HRM" 上傳
    那麼 回應 400 { success:false, message:"無效的平台名稱" }
    當 上傳 "setup.exe"
    那麼 回應 415,success 為 false,沒有 Gateway 格式的 code,也沒有留下任何檔案

  場景: /sql-files 沒帶 limit 回全部有效檔
    假如 有 55 筆有效檔
    當 呼叫 /compat/fb/sql-files
    那麼 total 與 files 都是 55 筆(舊服務只回 50 筆)

  場景: 舊整數 id 與新 UUID 都能下載與刪除
    假如 已匯入舊 id 140 的檔案
    當 呼叫 /compat/fb/sql-download/140
    那麼 回應 200,Content-Disposition 含 filename*=UTF-8 中文檔名
    當 呼叫 DELETE /compat/fb/sql-delete/140 兩次
    那麼 兩次都回 { success:true, message:"檔案刪除成功" },實體檔保留

  場景: SMB 舊中文原檔名 path 與新 UUID path 都查得到
    假如 已匯入 path 為 "電子發票設定.pdf" 的舊檔
    當 呼叫 /compat/smb/api/download?path=電子發票設定.pdf
    那麼 回應 200
    當 呼叫 /compat/smb/api/db/search?sourceNumber=SP-1&effective=true
    那麼 data[] 的欄位為 smbFileUpload 全欄位,id 為舊整數 id

  場景: SMB 上傳的目錄參數不可穿越
    當 以 path "../etc" 上傳到 /compat/smb/api/db/upload
    那麼 回應 400,沒有寫入任何檔案

  場景: 相容層上傳不會被暫存清除
    當 沒帶 sourceNumber 上傳到 /compat/fb/sql-upload
    而且 經過 48 小時
    那麼 暫存清除排程不會刪除這個檔案
