# language: zh-TW
# 舊系統唯讀盤點(LEGACY-INVENTORY;IMPL-PLAN F0;AGENT.md §7.1)
@F0
功能: 舊來源檔案唯讀盤點
  為了知道 NAS 備份(filebackend / SMB)與 166 PortalSolar 實際有哪些檔案
  身為附件服務
  我只讀取來源目錄的清單與屬性,產出盤點報告,絕不寫入、改名或刪除來源

  場景: 盤點 NAS 上 filebackend 各平台目錄
    假如 來源 "filebackend" 的根目錄為 NAS docker-folder,範圍為 BPM、CRM、MES、OTHER
    當 執行盤點
    那麼 報告列出每個目錄的檔案數、總大小、副檔名分布
    而且 檔名為 "{uuid}{副檔名}" 與其他檔名分開計數
    而且 空目錄的檔案數為 0(有讀到,不是未查詢)

  場景: 盤點 SMB 備份(CP)辨識中文原檔名
    假如 來源 "smbbackend" 的根目錄為 NAS docker-folder\CP
    當 執行盤點
    那麼 報告列出 UUID 檔名與原檔名的筆數
    而且 列出同名但大小不同的檔案(可能被覆蓋過)

  場景: 盤點 166 PortalSolar 只掃資料目錄
    假如 來源 "portalsolar" 的根目錄為 \\10.10.130.166\PortalSolar,範圍為 Document、EHS、PropertyFile 等資料目錄
    當 執行盤點
    那麼 報告不包含程式目錄(Bin、App_Code、Scripts…)與 .aspx / .cs 原始碼

  場景: 來源連不到時明確標示未查詢
    假如 來源根目錄不存在或沒有權限
    當 執行盤點
    那麼 該來源的狀態為 "unavailable",並附上錯誤訊息
    而且 不可回報為 0 個檔案

  場景: 個別檔案讀不到屬性時列入錯誤清單
    假如 範圍內有一個檔案無法取得屬性
    當 執行盤點
    那麼 該檔案列入 errors,其餘檔案照常統計

  場景: 盤點絕不修改來源
    當 對任一來源執行盤點(含計算 SHA-256 的選項)
    那麼 程式只呼叫讀取類操作(列目錄、取屬性、以唯讀模式開檔)
    而且 來源目錄的檔案數、大小與修改時間在盤點前後完全相同

  場景: 盤點報告寫到本機輸出目錄
    當 執行盤點並指定輸出目錄
    那麼 報告(JSON 與 Markdown 摘要)寫入輸出目錄
    而且 輸出目錄不可位於任何來源根目錄之下,否則拒絕執行
