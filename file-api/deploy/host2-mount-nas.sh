#!/bin/sh
# 主機 2(測試區 WSL)以 cifs 掛載 NAS,供 file-api 備份(STORAGE.md §2;F2):本人執行,NAS 密碼以隱藏輸入寫入,不經開發機(AGENT.md §7.2)。
#   在主機 2 的 WSL:sudo sh host2-mount-nas.sh
# 產生 / 修改:
#   /etc/giganexus/nas.cred      帳密檔(root 600;已存在不覆寫,要換密碼先刪除)
#   /etc/fstab                   一行 cifs 掛載(nofail:NAS 不在時 WSL 照常開機;已存在不重複加)
#   /mnt/nas-docker              掛載點;giga-files/{env}/ 為 file-api 備份根目錄(擁有者 uid 1000)
#   giga-files/{env}/.giga-files-backup   標記檔:file-api 看到它才備份(沒掛上時不會寫到本機空目錄)
# 完成後需重建 file-api 容器才看得到掛載:sh /mnt/c/Users/user/file-recreate.sh
set -eu
SHARE=${NAS_SHARE:-//10.10.130.31/docker-folder}
MNT=/mnt/nas-docker
ENV_NAME=${GW_ENV:-test}
CRED=/etc/giganexus/nas.cred

command -v mount.cifs >/dev/null 2>&1 || { echo "缺少 mount.cifs,請先安裝 cifs-utils(apt-get install -y cifs-utils)" >&2; exit 1; }

if [ ! -f "$CRED" ]; then
  mkdir -p "$(dirname "$CRED")"; chmod 700 "$(dirname "$CRED")"
  printf 'NAS 服務帳號(%s):' "$SHARE"; read -r u
  [ -n "$u" ] || { echo "帳號空白,中止" >&2; exit 1; }
  printf 'NAS 網域(沒有請直接 Enter):'; read -r dom
  stty -echo; printf 'NAS 密碼:'; read -r p; stty echo; echo
  [ -n "$p" ] || { echo "密碼空白,中止" >&2; exit 1; }
  umask 077
  { printf 'username=%s\npassword=%s\n' "$u" "$p"; if [ -n "$dom" ]; then printf 'domain=%s\n' "$dom"; fi; } > "$CRED"
  unset p
  chmod 600 "$CRED"
fi

mkdir -p "$MNT"
LINE="$SHARE $MNT cifs credentials=$CRED,uid=1000,gid=1000,file_mode=0640,dir_mode=0750,vers=3.0,nofail,_netdev 0 0"
grep -q " $MNT cifs " /etc/fstab || { echo "$LINE" >> /etc/fstab; echo "已加入 /etc/fstab"; }
mountpoint -q "$MNT" || mount "$MNT"
mountpoint -q "$MNT" || { echo "掛載失敗:$MNT" >&2; exit 1; }

ROOT="$MNT/giga-files/$ENV_NAME"
mkdir -p "$ROOT"
touch "$ROOT/.giga-files-backup"
# 寫入測試(建立後刪除),確認 uid 1000 可寫
su -s /bin/sh -c "touch '$ROOT/.write-test' && rm '$ROOT/.write-test'" "$(getent passwd 1000 | cut -d: -f1)" \
  && echo "uid 1000 可寫入 $ROOT" || { echo "uid 1000 無法寫入 $ROOT(檢查 NAS 帳號權限)" >&2; exit 1; }
df -h "$MNT"
echo "完成。接著重建 file-api 容器:sh /mnt/c/Users/user/file-recreate.sh(之後 5 分鐘內開始備份)"
