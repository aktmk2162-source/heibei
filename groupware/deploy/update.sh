#!/usr/bin/env bash
# 社内グループウェアを新しい版に更新する（root で実行）。
# 事前に最新のプログラムを取得しておきます（例: cd ~/heibei && git pull）。
#   sudo ./update.sh
# 更新前に必ずバックアップを取り、起動を確認できなければ元の版に戻します。
set -euo pipefail

APP_DIR=/opt/groupware
SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)
PREV=/opt/groupware.prev
PREV_UNITS=$PREV.units
UNITS=(groupware.service groupware-backup.service groupware-backup.timer)

[[ $EUID -eq 0 ]] || { echo "root で実行してください" >&2; exit 1; }

echo "==> 1/4 更新前のバックアップ"
systemctl start groupware-backup.service

echo "==> 2/4 現在の版を退避して、新しい版を配置"
rsync -a --delete "$APP_DIR/" "$PREV/"
# サービス定義も退避する（戻すときに一緒に戻す）
install -d -m 755 "$PREV_UNITS"
for u in "${UNITS[@]}"; do cp -p "/etc/systemd/system/$u" "$PREV_UNITS/$u"; done
rsync -a --delete --chown=root:root \
  --exclude data --exclude backups --exclude test --exclude deploy --exclude node_modules \
  "$SRC_DIR/" "$APP_DIR/"
for u in "${UNITS[@]}"; do install -m 644 "$SRC_DIR/deploy/$u" /etc/systemd/system/; done
systemctl daemon-reload

echo "==> 3/4 再起動"
# 失敗しても止めずに起動確認へ進む（確認できなければ元の版に戻す）
systemctl restart groupware || true

echo "==> 4/4 起動確認"
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "更新しました。"
    exit 0
  fi
  sleep 1
done

echo "起動を確認できないため、元の版に戻します" >&2
rsync -a --delete "$PREV/" "$APP_DIR/"
for u in "${UNITS[@]}"; do install -m 644 "$PREV_UNITS/$u" /etc/systemd/system/; done
systemctl daemon-reload
systemctl restart groupware
echo "元の版に戻しました。sudo journalctl -u groupware -n 100 で原因を確認してください" >&2
exit 1
