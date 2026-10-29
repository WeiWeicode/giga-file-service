/*
  compat — 由 drizzle-kit generate 產生(DATABASE.md §1;LEGACY-SWITCH-PLAN.md §4),人工審查 SQL Server 2012 相容性:未調整。
  - file_object 加 compat_ns / compat_key / legacy_meta(舊格式相容層、filebackend / SMBbackend 匯入);皆可為 NULL,既有資料不受影響
  - 索引鍵長度 varchar(10) + nvarchar(300) = 610 bytes,低於 900 上限;legacy_meta 為 nvarchar(max)(2005 起支援),不進索引
  已執行 `npm run db:check-2012`:無 2016+ 語法。
*/
ALTER TABLE [file_svc].[file_object] ADD [compat_ns] varchar(10);--> statement-breakpoint
ALTER TABLE [file_svc].[file_object] ADD [compat_key] nvarchar(300);--> statement-breakpoint
ALTER TABLE [file_svc].[file_object] ADD [legacy_meta] nvarchar(max);--> statement-breakpoint
CREATE INDEX [ix_file_object_compat] ON [file_svc].[file_object] ([compat_ns],[compat_key]);--> statement-breakpoint
CREATE INDEX [ix_file_object_compat_ref] ON [file_svc].[file_object] ([compat_ns],[ref_no]);