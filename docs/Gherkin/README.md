# GigaNexus 附件服務 — Gherkin 行為規格

> 以 Gherkin(繁體中文關鍵字,`# language: zh-TW`)描述附件服務的驗收行為,對應 [PRD.md](../PRD.md) **v0.8** 與 [IMPL-PLAN.md](../IMPL-PLAN.md) 的工作項目。
> 比照 Gateway(2026-10-02 決定):**不引入 Cucumber 步驟定義**。每支 API 的場景寫在 OpenAPI `x-gherkin`(自動註冊到 Gateway 路由表);本目錄保留跨 API 的驗收場景,自動化以 Vitest 執行,對照見 [TEST-MAP.md](TEST-MAP.md)。

## 檔案一覽(預計)

尚未撰寫;各工作項目開始時建立,並在本表標示狀態。

| 目錄 / 檔案 | 內容 | 規格 | 工作項目 |
| --- | --- | --- | --- |
| `files/upload-download.feature` | 上傳兩段式、綁定、下載(中文檔名)、軟刪除、暫存清除 | API §2 | F1 |
| `files/file-safety.feature` | 只用 UUID、路徑安全、檔案類型、大小上限、SVG 不 inline | SECURITY-CHECKLIST S7–S13 | F1 |
| `storage/nas-backup.feature` | 排程補傳、SHA-256 驗證、NAS 斷線恢復、失敗告警、還原 | STORAGE §2 | F2 |
| `bpm/bpm-attachment.feature` | 單號完全比對、目錄段數嘗試與快取、環境由設定決定 | API §3 | F6 |
| `compat/filebackend.feature` | `fb` 7 支舊格式、舊 id 與 UUID、`/sql-files` 無 limit | API §4.1、§4.4 | F7 |
| `compat/smbbackend.feature` | `smb` 6 支舊格式、兩種 `path` 查找、預設值 | API §4.2、§4.4 | F7 |
| `legacy/sync.feature` | NAS 拉取乾跑、166 同步狀態線、同名覆蓋保留舊版、來源消失只標記 | MIGRATION §2、§3 | F4 |

## 標籤慣例

| 標籤 | 意義 |
| --- | --- |
| `@F1` 等 | 對應 IMPL-PLAN 工作項目 |
| `@security` | 安全相關,必跑 |
| `@e2e` | 需經 Gateway(Nginx + BFF)的測試區執行 |
| `@compat` | 舊格式相容層,以舊服務回應為 golden 樣本 |
| `@wip` | 規格細節未定(例:檔案類型白名單、相容路由公開),暫不列入 CI |
