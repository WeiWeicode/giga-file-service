#!/bin/sh
# 主機 2(測試區 WSL)寫入 file-api 的 BPM 附件機密(F6;API.md §3):本人執行,以隱藏輸入貼上,不經開發機(AGENT.md §7.2)。
#   ssh -t host2 "wsl -u root -- sh /mnt/c/Users/user/host2-set-bpm-secrets.sh test"   BPM 測試區 191
#   ssh -t host2 "wsl -u root -- sh /mnt/c/Users/user/host2-set-bpm-secrets.sh prod"   BPM 正式區 190
# 產生(已存在的不覆寫;要換先刪除該檔再重跑):
#   /srv/giganexus/file-secrets/bpm/{test|prod}_db_password    該 BPM 主機 NaNa 唯讀帳號 file_bpm_ro 的密碼(db/dba/02-create-bpm-readonly.sql)
#   /srv/giganexus/file-secrets/bpm/{test|prod}_file_api_key   該 BPM 主機 5144 取檔服務金鑰(目前沿用既有金鑰)
#   /srv/giganexus/deploy/file.env    補上 BPM_{TEST|PROD}_DB_HOST、BPM_{TEST|PROD}_FILE_URL(已有則不動;有 DB_HOST 才啟用該來源)
# bpm/ 以目錄唯讀掛載到容器 /run/secrets/bpm(docker-compose.yml);完成後重建 file-api 容器才會啟用
set -eu
case "${1:-}" in
  test) HOST=10.10.130.191; P=TEST; NAME=測試區 ;;
  prod) HOST=10.10.130.190; P=PROD; NAME=正式區 ;;
  *) echo "用法:sh host2-set-bpm-secrets.sh test|prod" >&2; exit 1 ;;
esac
BASE=/srv/giganexus/file-secrets
D=$BASE/bpm
ENV_FILE=/srv/giganexus/deploy/file.env
[ -d "$BASE" ] || { echo "缺少 $BASE,請先執行 host2-set-secrets.sh" >&2; exit 1; }
mkdir -p "$D"; chown 1000:1000 "$D"; chmod 700 "$D"

ask() { # $1 檔名 $2 提示
  if [ -f "$D/$1" ]; then echo "$1 已存在,略過(要換先刪除)"; return; fi
  stty -echo; printf '%s:' "$2"; read -r v; stty echo; echo
  [ -n "$v" ] || { echo "空白,中止" >&2; exit 1; }
  printf '%s' "$v" > "$D/$1"; unset v
  chown 1000:1000 "$D/$1"; chmod 400 "$D/$1"
  echo "$1:$(wc -c < "$D/$1") 位元組"
}
ask "$1_db_password"  "BPM $NAME($HOST)NaNa file_bpm_ro 密碼"
ask "$1_file_api_key" "BPM $NAME($HOST)5144 取檔服務金鑰"

grep -q "^BPM_${P}_DB_HOST=" "$ENV_FILE" || printf 'BPM_%s_DB_HOST=%s\n' "$P" "$HOST" >> "$ENV_FILE"
grep -q "^BPM_${P}_FILE_URL=" "$ENV_FILE" || printf 'BPM_%s_FILE_URL=http://%s:5144\n' "$P" "$HOST" >> "$ENV_FILE"
grep '^BPM_' "$ENV_FILE"
echo "完成。重建 file-api 容器後啟用 BPM $NAME。"
