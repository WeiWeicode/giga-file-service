/*
  WebAppDb 唯讀帳號(F4 匯入 filebackend / SMBbackend 舊資料列;LEGACY-SWITCH-PLAN.md §5 Q3)— SQL Server 2012(10.10.130.220)
  由使用者以 sa 在 master 執行一次;AI 不以 sa 連線、不經手密碼(AGENT.md §7.2)。

  建立:
    - 登入 file_legacy_ro:只能 SELECT WebAppDb.dbo.webFileUpload、dbo.smbFileUpload 兩張表(舊表唯讀,D8)
  WebAppDb 只有一個(122 正式舊服務在用),測試區與正式區的匯入都讀它。

  執行前把 <請自訂強密碼> 換成實際密碼;執行後:
    - 開發機:giga-file-service/file-api/.env 加 WEBAPPDB_PASSWORD(AI 不開啟 .env)
    - 主機 2:ssh -t host2 "wsl -u root -- sh /mnt/c/Users/user/host2-set-legacy-secrets.sh"
  執行後驗證(以 file_legacy_ro 登入):
    SELECT COUNT(*) FROM WebAppDb.dbo.webFileUpload;   -- 應回筆數(2026-10-08 為 151)
    SELECT COUNT(*) FROM WebAppDb.dbo.smbFileUpload;   -- 應回筆數(2026-10-08 為 83)
    DELETE FROM WebAppDb.dbo.webFileUpload WHERE 1 = 0; -- 應回「DELETE permission was denied」
*/

USE [master];
GO
CREATE LOGIN [file_legacy_ro] WITH PASSWORD = N'<請自訂強密碼>', DEFAULT_DATABASE = [WebAppDb], CHECK_POLICY = ON;
GO

USE [WebAppDb];
GO
CREATE USER [file_legacy_ro] FOR LOGIN [file_legacy_ro];
GRANT SELECT ON [dbo].[webFileUpload] TO [file_legacy_ro];
GRANT SELECT ON [dbo].[smbFileUpload] TO [file_legacy_ro];
GO
