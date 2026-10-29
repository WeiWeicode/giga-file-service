#!/bin/sh
# 主機 3(正式區 WSL)把 file-api 的資料庫帳號換成正式庫專用的 file_prod_app(db/dba/04-create-prod-schema.sql 建立):
# 本人執行,密碼以隱藏輸入寫入,不經開發機(AGENT.md §7.2)。
#   在主機 3 的 WSL:sudo sh /srv/giganexus/deploy/host3-set-file-db.sh
# 變更(原檔先備份為 *.bak-<日期時間>):
#   /srv/giganexus/file-secrets/file_db_password   file_prod_app 密碼(擁有者 uid 1000、400)
#   /srv/giganexus/deploy/file.env                 FILE_DB_USER=file_prod_app
set -eu
D=/srv/giganexus/file-secrets
ENV_FILE=/srv/giganexus/deploy/file.env
TS="$(date +%Y%m%d%H%M%S)"
[ "$(id -u)" = 0 ] || { echo "請用 sudo 執行" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE" >&2; exit 1; }

stty -echo; printf 'file_prod_app 密碼(giganexus_gw):'; read -r p; stty echo; echo
[ -n "$p" ] || { echo "密碼空白,中止" >&2; exit 1; }
[ -f "$D/file_db_password" ] && cp -p "$D/file_db_password" "$D/file_db_password.bak-$TS"
printf '%s' "$p" > "$D/file_db_password"; unset p
chown 1000:1000 "$D/file_db_password"; chmod 400 "$D/file_db_password"
echo "已寫入 $D/file_db_password"

cp -p "$ENV_FILE" "$ENV_FILE.bak-$TS"
if grep -q '^FILE_DB_USER=' "$ENV_FILE"; then
  sed -i 's/^FILE_DB_USER=.*/FILE_DB_USER=file_prod_app/' "$ENV_FILE"
else
  echo 'FILE_DB_USER=file_prod_app' >> "$ENV_FILE"
fi
echo "已設定 $ENV_FILE:$(grep '^FILE_DB_USER=' "$ENV_FILE")(備份 $ENV_FILE.bak-$TS)"
