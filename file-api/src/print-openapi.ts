/** 輸出本服務的 OpenAPI(不啟動服務、不連資料庫與 Gateway):npm run -s openapi > openapi.json */
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { FileService } from './modules/files/file-service.js';
import type { FileRepo } from './modules/files/types.js';
import { LocalStore } from './modules/storage/local-store.js';

const config = loadConfig({
  SERVICE_CODE: 'file-api',
  GW_ENV: 'dev',
  GW_JWKS_URL: 'http://127.0.0.1/.well-known/jwks.json',
  FILE_ROOT: '.',
  FILE_DB_HOST: '-',
  FILE_DB_NAME: '-',
  FILE_DB_USER: '-',
  FILE_DB_PASSWORD: '-',
  ...process.env,
});
const service = new FileService({ repo: {} as FileRepo, store: new LocalStore(config.fileRoot), tempRetentionHours: 24 });
const app = await buildApp({ config, service });
await app.ready();
console.log(JSON.stringify(app.swagger(), null, 2));
await app.close();
