# 新增功能紀錄

> 新紀錄加在最上方;格式見 `AGENT.md` §11。

## 2026-10-08 F1 file-api 主體、F0 舊來源唯讀盤點
- 工作項目:F1(W11-3)、F0(W11-2)
- 內容:程式放在 `file-api/`(使用者要求,repo 根目錄只放文件與 CI)。① Gherkin 先行:`docs/Gherkin/files/upload-download.feature`、`file-safety.feature`、`legacy/inventory.feature`。② file-api(Fastify 5 + TypeScript,結構沿用 Gateway node-backend 樣本與 ItAgentBack):上傳(multipart 串流寫 tmp + SHA-256,整批檢查副檔名白名單與檔頭,通過才 rename + 寫 DB)、清單(資料範圍:自己或同公司;系統身分只看自己)、資訊、下載(UTF-8 檔名、只有圖片 / PDF 可 inline、nosniff)、綁定(只限上傳者)、軟刪除(不刪實體檔)、暫存檔每小時清除、儲存統計;Drizzle 三張表(`giganexus_gw` schema `file_svc`,D7 / D17),migration 紀錄表 `file_svc.__file_migrations`;`db/dba/01-create-schema.sql` 由使用者以 sa 執行(已完成)。③ F0 盤點 CLI:`ReadonlyFs` 只宣告讀取操作,盤點 NAS(filebackend / CP,含 SHA-256)與 166 PortalSolar,結果寫入 LEGACY-INVENTORY §6。④ Dockerfile、`deploy/docker-compose.yml`、`host2-set-secrets.sh`、`.gitlab-ci.yml`。⑤ 開發中發現並修正:Windows 上 `path.resolve` 的 UNC 分享根目錄帶尾端 `\`,原本的「根目錄 + 分隔符」前綴比對會拒絕所有子目錄(真實來源冒煙測試抓到),改用 `withSep`。
- 檔案:`file-api/`(新增)、`.gitlab-ci.yml`、`.gitignore`、`docs/API.md`、`docs/LEGACY-INVENTORY.md`、`docs/PRD.md`、`docs/IMPL-PLAN.md`、`docs/SECURITY-CHECKLIST.md`、`docs/DEPLOYMENT.md`、`docs/PROJECT-MAP.md`、`docs/Gherkin/`、`AGENT.md`、`README.md`
- 驗證:`npm run typecheck`、`format:check` 通過;`npm test` 53 項通過;`npm run test:int`(SQL Server 2012 `giganexus_gw_poc_test`)5 項通過,含 app 帳號讀 `gw.*` 被拒;`npm run test:legacy`(真實 NAS / 166,唯讀)3 項通過,掃描(含 SHA-256)前後路徑 / 大小 / 修改時間相同;`npm run db:migrate` 已套用到 `giganexus_gw_test`;本機 `npm run dev` 連 `giganexus_gw_test`,`/readyz` sql / storage ok。**未驗證**:Docker 映像建置(開發機無 Docker,待 CI)、測試區經 Gateway 的實際上傳下載
