#!/bin/sh
# 主機 2(測試區 WSL)寫入 file-api 的 BPM 附件機密(F6;API.md §3):本人執行,以隱藏輸入貼上,不經開發機(AGENT.md §7.2)。
#   ssh -t host2 "wsl -u root -- sh /mnt/c/Users/user/host2-set-bpm-secrets.sh"
# 產生(已存在的不覆寫;要換先刪除該檔再重跑):
#   /srv/giganexus/file-secrets/bpm_db_password     NaNa 唯讀帳號 file_bpm_ro 的密碼(191;db/dba/02-create-bpm-readonly.sql)
#   /srv/giganexus/file-secrets/bpm_file_api_key    5144 取檔服務金鑰(目前沿用既有金鑰,即 BPMbackend 呼叫端使用的同一把;不重新打包 FileAPI.exe)
#   /srv/giganexus/deploy/file.env                  補上 BPM_DB_HOST、BPM_FILE_URL(已有則不動)
# 完成後要重建 file-api 容器才會讀到(F6 程式部署時 CI 會自動重建)
set -eu
D=/srv/giganexus/file-secrets
ENV_FILE=/srv/giganexus/deploy/file.env
[ -d "$D" ] || { echo "缺少 $D,請先執行 host2-set-secrets.sh" >&2; exit 1; }

ask() { # $1 檔名 $2 提示
  if [ -f "$D/$1" ]; then echo "$1 已存在,略過(要換先刪除)"; return; fi
  stty -echo; printf '%s:' "$2"; read -r v; stty echo; echo
  [ -n "$v" ] || { echo "空白,中止" >&2; exit 1; }
  printf '%s' "$v" > "$D/$1"; unset v
  chown 1000:1000 "$D/$1"; chmod 400 "$D/$1"
  echo "$1:$(wc -c < "$D/$1") 位元組"
}
ask bpm_db_password  'NaNa file_bpm_ro 密碼(191)'
ask bpm_file_api_key '5144 取檔服務金鑰(沿用既有金鑰)'

grep -q '^BPM_DB_HOST=' "$ENV_FILE" || printf 'BPM_DB_HOST=10.10.130.191\nBPM_DB_NAME=NaNa\nBPM_DB_USER=file_bpm_ro\n' >> "$ENV_FILE"
grep -q '^BPM_FILE_URL=' "$ENV_FILE" || printf 'BPM_FILE_URL=http://10.10.130.191:5144\n' >> "$ENV_FILE"
grep '^BPM_' "$ENV_FILE"
echo "完成。"
