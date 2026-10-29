# language: zh-TW
# filebackend / SMBbackend 舊檔匯入(MIGRATION.md §2;IMPL-PLAN F4;LEGACY-SWITCH-PLAN.md §3 A1)
@F4
功能: 從 WebAppDb 與 NAS 備份匯入舊檔
  為了讓相容層切換後仍查得到歷史附件
  身為附件服務
  我唯讀讀取舊表與 NAS,先產生對照報表,確認後才複製進新服務

  場景: 乾跑只產生報表
    假如 NAS 有 BPM/a.pdf、OTHER/b.pdf(內容相同)、BPM/orphan.png,舊表有 a、b、已不存在的 gone.pdf、無效列、執行檔
    當 執行 npm run legacy:import -- --source fb
    那麼 報表分為可匯入 2、斷鏈 1、無效列 1、擋下 1,孤兒檔 BPM/orphan.png,重複內容 1 組
    而且 沒有寫入任何檔案或資料列

  場景: 加 --apply 匯入並驗證 SHA-256,可重跑
    當 加 --apply 執行
    那麼 檔案複製到檔案根目錄、SHA-256 與 NAS 相同,寫入 file_object 與 legacy_file_map(legacy_key = 舊 id)
    而且 NAS 上的來源檔沒有被修改
    當 再執行一次
    那麼 已匯入的舊 id 跳過,不重複寫入

  場景: 切換前舊服務刪除的檔案在新服務軟刪除
    假如 舊 id 9 已匯入,之後舊表改為 Effective = 0
    當 加 --apply 執行
    那麼 新服務的檔案軟刪除,相容層下載回 404

  場景: NAS 無法存取時停止
    當 NAS 根目錄不存在
    那麼 匯入失敗並說明無法存取(未查詢),不當作 0 個檔案
