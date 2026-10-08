/*
  init — 由 drizzle-kit generate 產生(DATABASE.md §1–§3),人工審查 SQL Server 2012 相容性:未調整。
  - schema file_svc 由 db/dba/01-create-schema.sql 建立(sa),本檔不建立;不碰 gw.*(§0.2)
  - uq_legacy_file_map_current 為篩選索引(2008 起支援)
  已執行 `npm run db:check-2012`:無 2016+ 語法。
*/
CREATE TABLE [file_svc].[file_access_log] (
	[id] bigint IDENTITY(1, 1),
	[file_uuid] uniqueidentifier,
	[action] varchar(20) NOT NULL,
	[user_id] nvarchar(64) NOT NULL,
	[ip] nvarchar(50),
	[request_id] nvarchar(100),
	[detail] nvarchar(500),
	[created_at] datetime2(3) NOT NULL CONSTRAINT [file_access_log_created_at_default] DEFAULT (sysutcdatetime()),
	CONSTRAINT [file_access_log_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE TABLE [file_svc].[file_object] (
	[id] bigint IDENTITY(1, 1),
	[file_uuid] uniqueidentifier NOT NULL,
	[original_name] nvarchar(255) NOT NULL,
	[ext] nvarchar(20),
	[mime] nvarchar(100),
	[size_bytes] bigint NOT NULL,
	[sha256] char(64) NOT NULL,
	[storage_key] nvarchar(200) NOT NULL,
	[source_system] nvarchar(50) NOT NULL,
	[source_app] nvarchar(200),
	[ref_type] nvarchar(50),
	[ref_no] nvarchar(100),
	[company_id] nvarchar(50),
	[uploaded_by] nvarchar(64) NOT NULL,
	[uploaded_ip] nvarchar(50),
	[created_at] datetime2(3) NOT NULL CONSTRAINT [file_object_created_at_default] DEFAULT (sysutcdatetime()),
	[bound_at] datetime2(3),
	[deleted_at] datetime2(3),
	[deleted_by] nvarchar(64),
	[backup_status] varchar(10) NOT NULL CONSTRAINT [file_object_backup_status_default] DEFAULT ('pending'),
	[backup_at] datetime2(3),
	[backup_attempts] int NOT NULL CONSTRAINT [file_object_backup_attempts_default] DEFAULT ((0)),
	CONSTRAINT [file_object_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE TABLE [file_svc].[legacy_file_map] (
	[id] bigint IDENTITY(1, 1),
	[file_uuid] uniqueidentifier NOT NULL,
	[legacy_source] varchar(30) NOT NULL,
	[legacy_dir] nvarchar(300),
	[legacy_name] nvarchar(255) NOT NULL,
	[legacy_db] nvarchar(100),
	[legacy_table] nvarchar(100),
	[legacy_key] nvarchar(200),
	[size_bytes] bigint NOT NULL,
	[mtime_utc] datetime2(3) NOT NULL,
	[sha256] char(64),
	[is_current] bit NOT NULL CONSTRAINT [legacy_file_map_is_current_default] DEFAULT ((1)),
	[nas_path] nvarchar(500),
	[nas_copied_at] datetime2(3),
	[wsl_copied_at] datetime2(3),
	[first_seen_at] datetime2(3) NOT NULL,
	[last_seen_at] datetime2(3) NOT NULL,
	[source_missing_at] datetime2(3),
	[sync_state] varchar(20) NOT NULL,
	CONSTRAINT [legacy_file_map_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE INDEX [ix_file_access_log_uuid] ON [file_svc].[file_access_log] ([file_uuid]);--> statement-breakpoint
CREATE INDEX [ix_file_access_log_created_at] ON [file_svc].[file_access_log] ([created_at]);--> statement-breakpoint
CREATE UNIQUE INDEX [uq_file_object_uuid] ON [file_svc].[file_object] ([file_uuid]);--> statement-breakpoint
CREATE INDEX [ix_file_object_ref] ON [file_svc].[file_object] ([ref_type],[ref_no]);--> statement-breakpoint
CREATE INDEX [ix_file_object_created_at] ON [file_svc].[file_object] ([created_at]);--> statement-breakpoint
CREATE INDEX [ix_file_object_backup] ON [file_svc].[file_object] ([backup_status]);--> statement-breakpoint
CREATE UNIQUE INDEX [uq_legacy_file_map_uuid] ON [file_svc].[legacy_file_map] ([file_uuid]);--> statement-breakpoint
CREATE UNIQUE INDEX [uq_legacy_file_map_current] ON [file_svc].[legacy_file_map] ([legacy_source],[legacy_dir],[legacy_name]) WHERE [is_current] = 1;--> statement-breakpoint
CREATE INDEX [ix_legacy_file_map_key] ON [file_svc].[legacy_file_map] ([legacy_source],[legacy_key]);