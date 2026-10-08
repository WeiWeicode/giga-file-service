// drizzle-kit 設定(DATABASE.md §0.1)。只用於 `npm run db:generate`(離線比對 schema 快照,不連資料庫);
// 套用 migration 一律用 `npm run db:migrate`(Drizzle migrator,紀錄表在 file_svc,§0.2),禁止 drizzle-kit push。
// 舊資料庫(NaNa、WebAppDb、PortalSolar)不在此設定內,以 mssql 唯讀查詢。
export default {
  dialect: 'mssql',
  schema: './src/db/schema.ts',
  out: './db/migrations',
  schemaFilter: ['file_svc'],
  breakpoints: true,
};
