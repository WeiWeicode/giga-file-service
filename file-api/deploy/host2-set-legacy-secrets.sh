#!/bin/sh
# 主機 2(測試區 WSL)寫入 file-api 的舊系統匯入機密(F4;LEGACY-SWITCH-PLAN.md §3 A3):本人執行,以隱藏輸入貼上,不經開發機(AGENT.md §7.2)。
#   ssh -t host2 "wsl -u root -- sh /mnt/c/Users/user/host2-set-legacy-secrets.sh"
# 產生(已存在的不覆寫;要換先刪除該檔再重跑):
#   /srv/giganexus/file-secrets/legacy/webappdb_password   WebAppDb 唯讀帳號 file_legacy_ro 的密碼(db/dba/03-create-webappdb-readonly.sql)
#   /srv/giganexus/deploy/file.env    補上 WEBAPPDB_HOST(已有則不動;有 HOST 才啟用匯入)
#   /srv/giganexus/file-legacy-import 匯入報表目錄(uid 1000 可寫;含單號與檔名,不進版控)
# legacy/ 只掛到一次性服務 legacy-import(docker-compose.yml profile legacy-import),長駐的 file-api 不掛
set -eu
umask 077
trap 'stty echo 2>/dev/null || true' EXIT INT TERM
BASE=/srv/giganexus/file-secrets
D=$BASE/legacy
ENV_FILE=/srv/giganexus/deploy/file.env
[ -d "$BASE" ] || { echo "缺少 $BASE,請先執行 host2-set-secrets.sh" >&2; exit 1; }
mkdir -p "$D"; chown 1000:1000 "$D"; chmod 700 "$D"

F=$D/webappdb_password
if [ -f "$F" ]; then
  echo "webappdb_password 已存在,略過(要換先刪除)"
else
  stty -echo; printf 'WebAppDb file_legacy_ro 密碼:'; read -r v; stty echo; echo
  [ -n "$v" ] || { echo "空白,中止" >&2; exit 1; }
  printf '%s' "$v" > "$F"; unset v
  chown 1000:1000 "$F"; chmod 400 "$F"
  echo "webappdb_password:$(wc -c < "$F") 位元組"
fi

grep -q '^WEBAPPDB_HOST=' "$ENV_FILE" || printf 'WEBAPPDB_HOST=10.10.130.220\n' >> "$ENV_FILE"
mkdir -p /srv/giganexus/file-legacy-import && chown 1000:1000 /srv/giganexus/file-legacy-import && chmod 700 /srv/giganexus/file-legacy-import
grep '^WEBAPPDB_HOST=' "$ENV_FILE"
echo "完成。匯入:docker compose … --profile legacy-import run --rm legacy-import --source fb(乾跑)"
