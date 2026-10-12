#!/usr/bin/env bash
# 社内グループウェアを Ubuntu Server（22.04 / 24.04 LTS）に設置する。
# 何度実行しても同じ結果になります（設定ファイル・データは上書きしません）。
#
# 使い方（root で実行）:
#   sudo GW_DOMAIN=gw.example.co.jp GW_CONTACT=mailto:it@example.co.jp ./install-ubuntu.sh [--with-caddy]
#
#   GW_DOMAIN   社員がブラウザで開くホスト名（例: gw.example.co.jp）
#   GW_CONTACT  通知サービスに伝える管理者の連絡先（mailto:～）
#   --with-caddy  HTTPS 用の Caddy も導入する（推奨）
set -euo pipefail

APP_DIR=/opt/groupware
DATA_DIR=/var/lib/groupware
BACKUP_DIR=/var/backups/groupware
ETC_DIR=/etc/groupware
ENV_FILE=$ETC_DIR/groupware.env
SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_DIR=$SRC_DIR/deploy
WITH_CADDY=0
[[ "${1:-}" == "--with-caddy" ]] && WITH_CADDY=1

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mエラー: %s\033[0m\n' "$*" >&2; exit 1; }
has_systemd() { [[ -d /run/systemd/system ]]; }

[[ $EUID -eq 0 ]] || die "root で実行してください（sudo ./install-ubuntu.sh）"
[[ -f $SRC_DIR/server.mjs ]] || die "groupware フォルダの中の deploy/install-ubuntu.sh を実行してください"
grep -qi ubuntu /etc/os-release || die "Ubuntu 以外では手順書の「Ubuntu 以外の場合」を参照してください"
DOMAIN=${GW_DOMAIN:-}
CONTACT=${GW_CONTACT:-}

log "1/7 必要なパッケージを導入"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg rsync tzdata >/dev/null

# Node.js 22.13 以上（組み込み SQLite を使うため）
need_node=1
if command -v node >/dev/null; then
  ver=$(node -p 'process.versions.node')
  major=${ver%%.*}; rest=${ver#*.}; minor=${rest%%.*}
  if (( major > 22 || (major == 22 && minor >= 13) )); then need_node=0; fi
fi
if (( need_node )); then
  log "Node.js 22 を導入（NodeSource）"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node.js $(node -v)"

log "2/7 実行ユーザーとフォルダを作成"
id groupware >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin groupware
install -d -o groupware -g groupware -m 750 "$DATA_DIR" "$BACKUP_DIR"
install -d -o root -g groupware -m 750 "$ETC_DIR"

log "3/7 アプリを $APP_DIR に配置"
install -d -m 755 "$APP_DIR"
# アプリ本体は root 所有・読み取り専用（データは $DATA_DIR にだけ書く）
rsync -a --delete --chown=root:root \
  --exclude data --exclude backups --exclude test --exclude deploy --exclude node_modules \
  "$SRC_DIR/" "$APP_DIR/"

log "4/7 設定ファイル $ENV_FILE"
if [[ -f $ENV_FILE ]]; then
  echo "既存の設定を使います（変更する場合は直接編集して sudo systemctl restart groupware）"
else
  [[ -n $DOMAIN ]] || echo "注意: GW_DOMAIN が未指定です。あとで Caddyfile のホスト名を設定してください"
  cat >"$ENV_FILE" <<ENV
# 社内グループウェアの設定（変更後は sudo systemctl restart groupware）
TZ=Asia/Tokyo
HOST=127.0.0.1
PORT=3000
DB_FILE=$DATA_DIR/groupware.db
FILES_DIR=$DATA_DIR/files
BACKUP_DIR=$BACKUP_DIR
BACKUP_KEEP=30
MAX_UPLOAD_MB=50
# HTTPS（Caddy）経由で使うため有効にしておく
COOKIE_SECURE=1
TRUST_PROXY=1
ADMIN_LOGIN_ID=admin
PUSH=1
PUSH_CONTACT=${CONTACT:-mailto:admin@example.com}
ENV
  chown root:groupware "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

log "5/7 サービスを登録・起動"
install -m 644 "$DEPLOY_DIR/groupware.service" "$DEPLOY_DIR/groupware-backup.service" "$DEPLOY_DIR/groupware-backup.timer" /etc/systemd/system/
if has_systemd; then
  systemctl daemon-reload
  systemctl enable --now groupware.service groupware-backup.timer
  systemctl restart groupware.service
else
  echo "systemd が動いていない環境のため、起動はスキップしました"
fi

log "6/7 起動確認"
ok=0
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if (( ok )); then echo "起動しました（http://127.0.0.1:3000/healthz = ok）"
elif has_systemd; then die "起動を確認できません。sudo journalctl -u groupware -n 50 で原因を確認してください"
fi

if (( WITH_CADDY )); then
  log "7/7 HTTPS（Caddy）を導入"
  if ! command -v caddy >/dev/null; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  install -d -o root -g caddy -m 750 /etc/caddy/certs
  # 初期状態の Caddyfile（Caddy の既定）なら当社用に置き換える。編集済みなら触らない
  if ! grep -q 'reverse_proxy 127.0.0.1:3000' /etc/caddy/Caddyfile 2>/dev/null; then
    [[ -f /etc/caddy/Caddyfile ]] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
    sed "s/gw.example.co.jp/${DOMAIN:-gw.example.co.jp}/" "$DEPLOY_DIR/Caddyfile.example" >/etc/caddy/Caddyfile
  fi
  echo "証明書ファイルを /etc/caddy/certs に置いてから: sudo systemctl reload caddy（手順書「4. HTTPS」）"
else
  log "7/7 HTTPS は別途設定してください（--with-caddy で Caddy を導入できます）"
fi

cat <<DONE

==================================================================
 設置が完了しました
------------------------------------------------------------------
 管理者の初期パスワードの確認（初回起動時のみ記録されます）:
   sudo journalctl -u groupware --no-pager | grep -A1 'ログインID'
 状態確認:      sudo systemctl status groupware
 ログ:          sudo journalctl -u groupware -f
 バックアップ:  $BACKUP_DIR（毎日 2:30・30世代）
 設定:          $ENV_FILE
 データ:        $DATA_DIR
==================================================================
DONE
