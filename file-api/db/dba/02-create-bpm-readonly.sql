/*
  BPM 附件唯讀帳號(F6;API.md §3、LEGACY-INVENTORY.md §5、SECURITY-CHECKLIST S16)— BPM 主機 NaNa 資料庫
  由使用者以 sa 在各 BPM 主機執行一次;AI 不以 sa 連線、不經手密碼(AGENT.md §7.2)。
    - 測試區 10.10.130.191:2026-10-08 已建立並驗證(SELECT 成功)
    - 正式區 10.10.130.190:測試區驗收後再建,密碼與測試區不同

  權限:只給附件查詢用到的 5 張表 SELECT(與 BPMbackend AttachmentController 的查詢相同),
  不加入 db_datareader(否則可讀 NaNa 全部表單資料)。
  執行前把 <請自訂強密碼> 換成實際密碼;執行後密碼放進主機 2 機密(file-api/deploy/host2-set-bpm-secrets.sh)
  與開發機 file-api/.env 的 BPM_DB_PASSWORD(不進版控)。
*/

-- 1) 登入(master)
USE [master];
CREATE LOGIN [file_bpm_ro] WITH PASSWORD = N'<請自訂強密碼>',
    DEFAULT_DATABASE = [NaNa], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
GO

-- 2) NaNa 使用者與唯讀權限
USE [NaNa];
CREATE USER [file_bpm_ro] FOR LOGIN [file_bpm_ro] WITH DEFAULT_SCHEMA = [dbo];
GRANT SELECT ON [dbo].[ProcessInstance]     TO [file_bpm_ro];  -- serialNumber(單號)、subject、createdTime
GRANT SELECT ON [dbo].[LocalRelevantData]   TO [file_bpm_ro];  -- 流程 → 表單
GRANT SELECT ON [dbo].[FormInstance]        TO [file_bpm_ro];
GRANT SELECT ON [dbo].[NoCmDocument]        TO [file_bpm_ro];  -- 附件:OID、logicalName、physicalName、extentionName
GRANT SELECT ON [dbo].[localAttachmentPath] TO [file_bpm_ro];  -- 實體路徑索引
GO

-- 3) 驗證:可以查附件,不能寫入
EXECUTE AS LOGIN = 'file_bpm_ro';
SELECT TOP 1 OID, logicalName FROM [NaNa].[dbo].[NoCmDocument];   -- 應成功
-- UPDATE [NaNa].[dbo].[NoCmDocument] SET logicalName = logicalName WHERE 1 = 0;  -- 應被拒(權限不足)
REVERT;
GO
