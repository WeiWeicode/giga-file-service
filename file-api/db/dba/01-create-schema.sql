/*
  附件服務 schema 與帳號(DATABASE.md §0、§0.2;D7)— SQL Server 2012(10.10.130.220)
  由使用者以 sa 在 master 執行一次;AI 不以 sa 連線、不經手密碼(AGENT.md §7.2)。

  建立(不另建資料庫,放在 Gateway 既有的資料庫):
    - giganexus_gw_test      開發 + 測試區共用,schema file_svc
    - giganexus_gw_poc_test  整合測試專用(npm run test:int 會清空並重建 file_svc 的資料表,不可指向前者)
    - 登入 file_app(讀寫 file_svc)/ file_migrate(file_svc 建表、migration)
  正式庫 giganexus_gw(帳號 file_prod_app / file_prod_migrate)隨正式區(2026-12)另建,不在本檔。

  權限(只授權 schema file_svc,不碰 gw.*):
    - file_migrate:資料庫層 CREATE TABLE(建表需要)+ schema file_svc CONTROL;不加入 db_ddladmin(否則可改 gw.*)
    - file_app:經 file_app_role 讀寫 schema file_svc;不能改結構
  執行前把兩個 <請自訂強密碼> 換成實際密碼;執行後把帳密放進 giga-file-service/.env(不進版控)與主機 2 機密。
  執行後驗證(以 file_app 登入):SELECT TOP 1 * FROM gw.api_route 應回「SELECT permission was denied」。
*/

USE [master];
GO
CREATE LOGIN [file_app]     WITH PASSWORD = N'<請自訂強密碼>', DEFAULT_DATABASE = [master], CHECK_POLICY = ON;
CREATE LOGIN [file_migrate] WITH PASSWORD = N'<請自訂強密碼>', DEFAULT_DATABASE = [master], CHECK_POLICY = ON;
GO

-- ---------- giganexus_gw_test ----------
USE [giganexus_gw_test];
GO
CREATE SCHEMA [file_svc] AUTHORIZATION [dbo];
GO
CREATE USER [file_migrate] FOR LOGIN [file_migrate] WITH DEFAULT_SCHEMA = [file_svc];
GRANT CREATE TABLE TO [file_migrate];
GRANT CONTROL ON SCHEMA::[file_svc] TO [file_migrate];
GO
CREATE ROLE [file_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[file_svc] TO [file_app_role];
CREATE USER [file_app] FOR LOGIN [file_app] WITH DEFAULT_SCHEMA = [file_svc];
EXEC sp_addrolemember N'file_app_role', N'file_app';
GO

-- ---------- giganexus_gw_poc_test(權限同上) ----------
USE [giganexus_gw_poc_test];
GO
CREATE SCHEMA [file_svc] AUTHORIZATION [dbo];
GO
CREATE USER [file_migrate] FOR LOGIN [file_migrate] WITH DEFAULT_SCHEMA = [file_svc];
GRANT CREATE TABLE TO [file_migrate];
GRANT CONTROL ON SCHEMA::[file_svc] TO [file_migrate];
GO
CREATE ROLE [file_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[file_svc] TO [file_app_role];
CREATE USER [file_app] FOR LOGIN [file_app] WITH DEFAULT_SCHEMA = [file_svc];
EXEC sp_addrolemember N'file_app_role', N'file_app';
GO
