#!/bin/sh
# 主機 2(測試區 WSL)準備 file-api 的機密、檔案根目錄與 Compose 變數:本人執行,SQL 密碼以隱藏輸入寫入,不經開發機(AGENT.md §7.2)。
#   在主機 2 的 WSL:sudo sh host2-set-secrets.sh
# 產生(已存在的不覆寫;要重建先刪除該檔):
#   /srv/giga-files/test/                檔案根目錄(擁有者 uid 1000 = 容器內 node;STORAGE.md §1)
#   /srv/giganexus/file-secrets/         file_db_password(file_app,隱藏輸入)、
#                                        gw_api_key(Gateway CLI client:create --code file-api;自動註冊 OpenAPI 草稿用)、
#                                        monitor_api_key(giga-observe ingest Key,服務 file-api)
#   /srv/giganexus/deploy/file.env       Compose 變數(範本 test.env.example)
set -eu
D=/srv/giganexus/file-secrets
ROOT=/srv/giga-files/test
ENV_FILE=/srv/giganexus/deploy/file.env
GW_ENV_FILE=/srv/giganexus/deploy/test.env
GW_SHARED=/srv/giganexus/shared
mkdir -p "$D" "$ROOT"
chown 1000:1000 "$ROOT"
chmod 750 "$ROOT"

# ---------- SQL Server(file_app)密碼 ----------
if [ ! -f "$D/file_db_password" ]; then
  stty -echo; printf 'file_app 密碼(giganexus_gw_test):'; read -r p; stty echo; echo
  [ -n "$p" ] || { echo "密碼空白,中止" >&2; exit 1; }
  printf '%s' "$p" > "$D/file_db_password"; unset p
fi

# ---------- Gateway API Key(自動註冊 OpenAPI 草稿用;代碼必須等於上游 file-api) ----------
if [ ! -f "$D/gw_api_key" ]; then
  G="$GW_SHARED/giga-api-gateway-bff/deploy"
  TAG="$(cat "$GW_SHARED/gateway-image-tag")"
  (cd "$G" && IMAGE_TAG="$TAG" REGISTRY=10.10.130.123:5050/giganexus/giga-api-gateway-bff \
    docker compose --env-file "$GW_ENV_FILE" -f docker-compose.yml -f docker-compose.test.yml --profile tools run --rm --no-deps -T \
    migrate node dist/bff/src/cli/index.js client:create --code file-api --name "附件服務 file-api" --actor giga-file-service) > /tmp/file-key.json
  sed -n 's/^  "key": "\(.*\)",\{0,1\}$/\1/p' /tmp/file-key.json | tr -d '\n' > "$D/gw_api_key"
  grep -v '"key"' /tmp/file-key.json; rm -f /tmp/file-key.json
  [ -s "$D/gw_api_key" ] || { echo "取不到 API Key,請檢查上方輸出" >&2; rm -f "$D/gw_api_key"; exit 1; }
fi

# ---------- giga-observe 監控 Key(ingest;serviceId 即架構圖的服務 id;已存在則略過) ----------
if [ ! -f "$D/monitor_api_key" ]; then
  (cd /srv/giganexus/giga-observe && docker compose --env-file deploy/test.env exec -T gno-backend \
    node src/scripts/createApiKey.js --service file-api --scope ingest --label "附件服務 file-api") > /tmp/file-obs.txt
  sed -n 's/^  key *: *//p' /tmp/file-obs.txt | tr -d '\r\n' > "$D/monitor_api_key"; rm -f /tmp/file-obs.txt
  [ -s "$D/monitor_api_key" ] || { echo "取不到監控 Key(監控會停用,服務仍可啟動);稍後可刪除此檔重跑" >&2; }
fi

# 與 ItAgentBack 相同:只限縮檔案(目錄需讓 CI 的 docker compose 讀得到 secret 路徑)
chown 1000:1000 "$D"/*; chmod 400 "$D"/*

# ---------- Compose 變數 ----------
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
GW_ENV=test
GW_BASE_URL=https://giganexus-test.gigasolar.com.tw
GW_NETWORK=giganexus-gw_default
FILE_DB_HOST=10.10.130.220
FILE_DB_NAME=giganexus_gw_test
FILE_DB_USER=file_app
FILE_HOST_ROOT=/srv/giga-files/test
FILE_SECRETS_DIR=/srv/giganexus/file-secrets
EOF
  echo "已建立 $ENV_FILE"
fi

ls -l "$D"
echo "完成。之後推 develop 由 CI 部署 file-api;部署後在 GigaItApp「服務與路由」審查 file-api 的路由草稿並發佈。"
