# 社内サーバーへの設置手順書

社内グループウェアを社内サーバー（Ubuntu Server）に設置し、社員がブラウザ・スマホから使えるようにするまでの手順です。
情報システム担当の方、または設置を依頼する業者の方向けです。所要時間の目安は、サーバーの準備ができていれば **半日** です。

```
 社員の PC・スマホ ──HTTPS──▶ Caddy（443番）──▶ グループウェア（127.0.0.1:3000）──▶ データ（/var/lib/groupware）
                                                        │
                                                        └──▶ 通知サービス（Google・Apple 等）へ HTTPS で送信
```

---

## 1. 事前に決める・用意するもの

| 項目 | 内容 | 担当 |
| --- | --- | --- |
| サーバー | Ubuntu Server 24.04 LTS（22.04 も可）。2コア・メモリ4GB・ディスク50GB以上（100名規模で十分）。物理機・仮想マシンどちらでも可 | 情シス |
| 固定 IP アドレス | サーバーに固定の社内 IP を割り当てる | 情シス |
| ホスト名 | 例: `gw.example.co.jp`。**社内 DNS** でサーバーの IP を引けるようにする | 情シス |
| SSL 証明書 | ホスト名に対応した証明書（「4. HTTPS」参照）。**通知機能・スマホのアプリ化には必須** | 情シス |
| 外部への通信許可 | サーバーから外部への HTTPS（443番）。「8. ネットワーク」の宛先 | 情シス |
| 社外からの利用 | 外回りの社員がスマホで使うか。使うなら VPN 等（「9. 社外からの利用」） | **経営判断** |
| バックアップの保管先 | サーバーとは別の NAS 等 | 情シス |
| 通知の連絡先 | 管理者のメールアドレス（通知サービスに伝える連絡先） | 情シス |

---

## 2. プログラムを取得する

サーバーに SSH でログインし、GitHub からプログラムを取得します。

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/aktmk2162-source/heibei.git
cd heibei/groupware
```

> リポジトリが非公開の場合は、GitHub の「Code → Download ZIP」で取得してサーバーへ転送しても構いません。

---

## 3. インストール

```bash
sudo GW_DOMAIN=gw.example.co.jp GW_CONTACT=mailto:it@example.co.jp ./deploy/install-ubuntu.sh --with-caddy
```

スクリプトが行うこと（何度実行しても安全です。設定とデータは上書きしません）:

1. Node.js 22 を導入（未導入または古い場合のみ）
2. 専用の実行ユーザー `groupware` を作成
3. アプリを `/opt/groupware` に配置（読み取り専用。アプリは書き換えられません）
4. 設定ファイル `/etc/groupware/groupware.env` を作成
5. サービス（自動起動・異常終了時の自動再起動）と、毎日 2:30 のバックアップを登録
6. 起動確認
7. `--with-caddy` 指定時: HTTPS 用の Caddy を導入し、設定ファイルを配置

完了すると、管理者の初期パスワードの確認方法が表示されます。

```bash
sudo journalctl -u groupware --no-pager | grep -A1 'ログインID'
```

| 場所 | 内容 |
| --- | --- |
| `/opt/groupware` | プログラム |
| `/etc/groupware/groupware.env` | 設定（変更後は `sudo systemctl restart groupware`） |
| `/var/lib/groupware` | データ（データベース・アップロードファイル）**ここが会社の資産です** |
| `/var/backups/groupware` | バックアップ（30世代） |

---

## 4. HTTPS（必須）

通知・スマホのホーム画面追加・パスワード保護のため、HTTPS が必須です。A を推奨します。

### A. 会社で取得した証明書を使う（推奨）

ワイルドカード証明書（`*.example.co.jp`）などをお持ちなら、それを使えます。お持ちでない場合は、自社ドメインのサブドメインで市販の証明書を取得してください（年数千円〜）。

```bash
sudo cp fullchain.pem privkey.pem /etc/caddy/certs/      # 中間証明書を含むもの・秘密鍵
sudo chown root:caddy /etc/caddy/certs/*.pem
sudo chmod 640 /etc/caddy/certs/*.pem
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`/etc/caddy/Caddyfile` のホスト名がインストール時の `GW_DOMAIN` になっていることを確認してください。

> 社内サーバーはインターネットから到達できないため、Let's Encrypt の通常の方法（HTTP 認証）は使えません。使う場合は DNS 認証（DNS 事業者の API 連携）が必要です。業者にご相談ください。

### B. Caddy の社内専用証明書（`tls internal`）

証明書を買わずに済みますが、**全 PC・スマホに Caddy のルート証明書を登録する作業が必要**です。iPhone は構成プロファイルの導入と「証明書信頼設定」が必要で、社員数が多いと負担が大きいため推奨しません。

```bash
# Caddyfile の tls 行を「tls internal」に変更して
sudo systemctl reload caddy
# 配布するルート証明書
sudo cat /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

---

## 5. ファイアウォール

```bash
sudo ufw allow OpenSSH
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp      # http→https の転送用
sudo ufw enable
```

アプリ本体（3000番）は `127.0.0.1` でだけ待ち受けており、外から直接は届きません。

---

## 6. 動作確認

1. 社内の PC のブラウザで `https://gw.example.co.jp/` を開き、鍵マーク（警告が出ない）を確認
2. `admin` と初期パスワードでログイン → 新しいパスワードに変更
3. 「個人設定 → 通知 → この端末で通知を受け取る」→「テスト通知を送る」で通知が届くことを確認
4. ここから先の初期登録は [初期登録の手順](初期登録の手順.md) へ

---

## 7. 運用

### バックアップ

- 毎日 2:30 に自動実行（`/var/backups/groupware`、データベース30世代＋アップロードファイル）
- **サーバーが壊れると同じディスクのバックアップも失われます。** NAS 等へ毎日コピーしてください。例（NAS を `/mnt/nas` にマウント済みの場合）:

```bash
# /etc/cron.d/groupware-offsite
45 2 * * * root rsync -a /var/backups/groupware/ /mnt/nas/groupware-backup/
```

- 手動でバックアップ: `sudo systemctl start groupware-backup`
- 状況確認: `systemctl list-timers groupware-backup.timer`

### 復元

```bash
sudo systemctl stop groupware
sudo cp /var/backups/groupware/groupware-YYYYMMDD-HHMMSS.db /var/lib/groupware/groupware.db
sudo rm -f /var/lib/groupware/groupware.db-wal /var/lib/groupware/groupware.db-shm
sudo rsync -a /var/backups/groupware/files/ /var/lib/groupware/files/
sudo chown -R groupware:groupware /var/lib/groupware
sudo systemctl start groupware
```

### 新しい版への更新

```bash
cd ~/heibei && git pull
sudo ./groupware/deploy/update.sh
```

更新前に自動でバックアップを取り、起動を確認できなければ元の版に戻します。

### 監視・ログ

| 用途 | コマンド・方法 |
| --- | --- |
| 死活監視 | `https://gw.example.co.jp/healthz` が `ok` を返すか（監視ツールに登録） |
| 状態 | `sudo systemctl status groupware` |
| ログ | `sudo journalctl -u groupware -f` |
| 操作ログ | 画面の「システム管理 → 操作ログ」（ログイン・承認・ユーザー管理など） |
| OS の更新 | `sudo apt-get update && sudo apt-get upgrade`（月1回程度） |

---

## 8. ネットワーク（サーバーから外部への通信）

| 宛先 | 用途 |
| --- | --- |
| `fcm.googleapis.com` | 通知（Chrome・Edge・Android） |
| `*.push.apple.com`（`web.push.apple.com` 等） | 通知（Safari・iPhone・iPad） |
| `*.notify.windows.com` | 通知（Windows） |
| `*.push.services.mozilla.com` | 通知（Firefox） |
| `deb.nodesource.com`、`dl.cloudsmith.io`、Ubuntu のミラー | 導入・更新時のみ |
| `github.com` | プログラムの取得・更新時のみ |

すべて HTTPS（443番）・サーバーから外向きのみです。外からサーバーへの受け入れは不要です。

---

## 9. 社外からの利用（要判断）

社内サーバーに置く場合、**そのままでは社内ネットワークの中でしか開けません。**

- 通知は社外でもスマホに届きますが、タップして開く・返信するには社内ネットワークへの接続が必要です。
- 外回りの多い営業担当がスマホで使う場合、次のいずれかが必要です。

| 方法 | 内容 | 留意点 |
| --- | --- | --- |
| 既存の VPN | 社員のスマホ・PC に VPN を入れる | VPN の利用ライセンス・接続の手間 |
| ゼロトラスト型の接続サービス | Cloudflare Access、Tailscale 等。社内サーバーを公開せずに社外から安全に接続 | 月額費用。導入は業者へ |
| 社内限定で運用 | 社外ではチャットの通知だけ受け、返信は帰社後 | クロジカ（クラウド）より不便になる |

**この判断によって、設置後の使い勝手が大きく変わります。** 現在クロジカを社外から使っている社員が多い場合は、VPN 等の手当てを設置と同時に進めてください。

---

## 10. Ubuntu 以外の場合

- **Windows Server しかない場合:** Hyper-V で Ubuntu の仮想マシンを作り、その中に本手順で設置するのが最も確実です。
- **Docker が使える場合:** `groupware/Dockerfile` でも起動できます（HTTPS は別途リバースプロキシで）。

---

## 11. トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| 画面が開かない | `sudo systemctl status groupware caddy`、社内 DNS でホスト名が引けるか、ファイアウォール |
| 証明書の警告が出る | 証明書のホスト名・中間証明書（fullchain）・有効期限 |
| ログインできない | 管理者が「システム管理 → ユーザー」でパスワード初期化。全員ログインできない場合は `COOKIE_SECURE=1` のまま HTTP で開いていないか |
| 通知が届かない | HTTPS か、「8. ネットワーク」の宛先へ出られるか、`sudo journalctl -u groupware | grep push` |
| アップロードできない | ファイルが50MB以下か（上限は `MAX_UPLOAD_MB` と Caddyfile の `max_size`） |
| 管理者がパスワードを忘れた | 他の管理者が「システム管理 → ユーザー」で初期化。管理者が1人もログインできない場合はサーバー上で下記を実行 |

### 管理者が誰もログインできなくなった場合

```bash
cd /opt/groupware
sudo -u groupware env $(sudo grep ^DB_FILE /etc/groupware/groupware.env) node scripts/reset-password.mjs admin
```

新しい初期パスワードが表示されます（操作ログにも記録されます）。
