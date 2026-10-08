# 專案地圖 — giga-file-service

> **最後更新:2026-10-08**(文件組建立:原 `FILE-PLAN.md` 拆分為 PRD、ARCHITECTURE、API、DATABASE、STORAGE、MIGRATION、LEGACY-INVENTORY、SECURITY-CHECKLIST、IMPL-PLAN、DEPLOYMENT;新增 DevelopmentProcess、Gherkin 骨架。**尚無程式碼**)。
> 開發新功能後,在同一個變更內更新本文件(`AGENT.md` §9.1)。只寫結構與職責,細節連到 `docs/` 對應章節。

附件服務 `file-api`(:51272,系統代碼 `file`,`/api/file/*`):上傳 / 下載 / 清單 / 綁定 / 軟刪除、BPM 附件唯讀代理、舊格式相容層、WSL 存放 + NAS 備份、舊系統 UUID 對照與同步。畫面在 GigaItApp「Gateway 管理 › 檔案管理」。

---

## 1. 目錄

### 1.1 現有

```
giga-file-service/
├─ AGENT.md                   AI 協作準則
├─ GEMINI.md                  Gemini CLI 導向 AGENT.md
├─ README.md                  定位摘要
├─ .gitignore                 機密、檔案實體、node 產物
└─ docs/
   ├─ PRD.md                  總綱:概述、目標、決策 D1–D17、畫面、待確認事項、文件索引
   ├─ ARCHITECTURE.md         架構圖、Gateway 限制與上傳直送(D4-B)
   ├─ API.md                  新 API、BPM 附件、舊格式相容層(規則 1–12)
   ├─ DATABASE.md             giganexus_gw schema file_svc:file_object、file_access_log、legacy_file_map(Drizzle)
   ├─ STORAGE.md              WSL 存放、NAS 備份
   ├─ MIGRATION.md            對照流程、NAS 備份拉取、166 同步
   ├─ LEGACY-INVENTORY.md     舊系統盤點與使用統計
   ├─ SECURITY-CHECKLIST.md   資安檢查清單(S1–S21)
   ├─ IMPL-PLAN.md            F0–F7 交付物 / 驗收、前置工作、測試策略
   ├─ DEPLOYMENT.md           部署區、CI/CD、掛載、機密、Gateway 端變更
   ├─ PROJECT-MAP.md          本文件
   ├─ DevelopmentProcess/     修正紀錄(BugFix、NewFeatures、BackendCorrection)
   └─ Gherkin/                行為規格說明與測試對照(README、TEST-MAP)
```

### 1.2 預計(F1 建立後改寫為實際結構)

```
├─ src/
│  ├─ server.ts / worker.ts   進入點(API / 排程同一映像)
│  ├─ config.ts               設定載入與驗證(部署區 dev / test / prod)
│  ├─ routes/                 新 API(API §2、§3):只做 schema、權限宣告、格式轉換
│  ├─ compat/                 舊格式相容層(API §4),與新 API 隔離
│  ├─ modules/                核心邏輯(不直接依賴 Fastify):storage、backup、bpm、legacy、inventory
│  ├─ db/                     Drizzle schema(file_svc)、migration、external/(舊資料庫唯讀 mssql)
│  └─ workers/                NAS 補傳、暫存清除、166 同步、NAS 拉取
├─ test/                      unit/、integration/、e2e/(與 src 平行)
└─ deploy/                    Docker Compose、env 範例
```

## 2. 對外介面

| 介面 | 位置 | 狀態 |
| --- | --- | --- |
| `/api/file/files*`、`/storage*`、`/inventory/*` | API §2 | 規劃 |
| `/api/file/bpm/*` | API §3 | 規劃 |
| `/api/file/compat/{fb,smb,portal}/*` | API §4 | 規劃 |
| GigaItApp「Gateway 管理 › 檔案管理」 | PRD §8 | 規劃(F3) |

## 3. 已知差異

目前無(尚無程式碼)。
