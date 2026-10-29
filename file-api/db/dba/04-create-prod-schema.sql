/*
  附件服務正式庫 schema 與帳號(DATABASE.md §0、§0.2;D7)— SQL Server 2012(10.10.130.220)
  由使用者以 sa 在 master 執行一次;AI 不以 sa 連線、不經手密碼(AGENT.md §7.2)。
  權限與 01-create-schema.sql 相同,只是放在正式庫、帳號與測試區分開(測試區帳號不能進正式庫)。

  建立(不另建資料庫,放在 Gateway 既有的正式庫):
    - giganexus_gw          schema file_svc
    - 登入 file_prod_app(讀寫 file_svc)/ file_prod_migrate(file_svc 建表、migration)
  執行前把兩個 <請自訂強密碼> 換成實際密碼(與測試區不同);執行後:
    - file_prod_app:主機 3 執行 sudo sh /srv/giganexus/deploy/host3-set-file-db.sh(寫入 file_db_password、file.env 的 FILE_DB_USER)
    - file_prod_migrate:開發機執行一次 migration(docs/DEPLOYMENT.md「正式區」),之後不放在任何主機
  執行後驗證(以 file_prod_app 登入 giganexus_gw):SELECT TOP 1 * FROM gw.api_route 應回「SELECT permission was denied」。
*/

USE [master];
GO
CREATE LOGIN [file_prod_app]     WITH PASSWORD = N'<請自訂強密碼>', DEFAULT_DATABASE = [master], CHECK_POLICY = ON;
CREATE LOGIN [file_prod_migrate] WITH PASSWORD = N'<請自訂強密碼>', DEFAULT_DATABASE = [master], CHECK_POLICY = ON;
GO

USE [giganexus_gw];
GO
CREATE SCHEMA [file_svc] AUTHORIZATION [dbo];
GO
CREATE USER [file_prod_migrate] FOR LOGIN [file_prod_migrate] WITH DEFAULT_SCHEMA = [file_svc];
GRANT CREATE TABLE TO [file_prod_migrate];
GRANT CONTROL ON SCHEMA::[file_svc] TO [file_prod_migrate];
GO
CREATE ROLE [file_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[file_svc] TO [file_app_role];
CREATE USER [file_prod_app] FOR LOGIN [file_prod_app] WITH DEFAULT_SCHEMA = [file_svc];
EXEC sp_addrolemember N'file_app_role', N'file_prod_app';
GO
