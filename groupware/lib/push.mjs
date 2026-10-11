// Web プッシュ通知（RFC 8030 / 8291 / 8292）。外部ライブラリを使わず node:crypto で実装する。
// ブラウザを閉じていても、PC・Android・ホーム画面に追加した iPhone に通知が届く。
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// 送信先として許可するプッシュサービス（任意の URL へ送らせない＝SSRF 対策）
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/,
];

export function isAllowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// VAPID 鍵（P-256）を設定テーブルに保存して使い回す
export function loadVapidKeys(db) {
  const get = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  let pub = get('vapid_public');
  let priv = get('vapid_private');
  if (!pub || !priv) {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    pub = b64u(ecdh.getPublicKey());
    priv = b64u(ecdh.getPrivateKey());
    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    set.run('vapid_public', pub);
    set.run('vapid_private', priv);
  }
  return { publicKey: pub, privateKey: priv };
}

function vapidPrivateKeyObject({ publicKey, privateKey }) {
  const p = Buffer.from(publicKey, 'base64url');
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)) },
    format: 'jwk',
  });
}

export function vapidAuthorization(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const input = `${header}.${claims}`;
  const sig = sign('sha256', Buffer.from(input), { key: vapidPrivateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${input}.${b64u(sig)}, k=${keys.publicKey}`;
}

// RFC 8291（aes128gcm）でペイロードを暗号化する
// asPrivate / salt はテスト（RFC の検証用ベクタ）でのみ指定する
export function encryptPayload(payload, p256dh, auth, { asPrivate, salt: fixedSalt } = {}) {
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  if (asPrivate) ecdh.setPrivateKey(asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = fixedSalt || randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export class Pusher {
  constructor(db, { subject = 'mailto:admin@example.com', fetchImpl = globalThis.fetch, log = console } = {}) {
    this.db = db;
    this.keys = loadVapidKeys(db);
    this.subject = subject;
    this.fetch = fetchImpl;
    this.log = log;
  }

  // 指定ユーザーの全端末へ送る。失効した購読（404/410）は削除する。送信の失敗は業務処理を止めない。
  async sendToUsers(userIds, message) {
    if (!userIds.length) return;
    const ph = userIds.map(() => '?').join(',');
    const subs = this.db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${ph})`).all(...userIds);
    const payload = JSON.stringify(message);
    await Promise.all(
      subs.map(async (s) => {
        try {
          const res = await this.fetch(s.endpoint, {
            method: 'POST',
            headers: {
              TTL: '86400',
              Urgency: 'high',
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
              Authorization: vapidAuthorization(s.endpoint, this.keys, this.subject),
            },
            body: encryptPayload(payload, s.p256dh, s.auth),
            signal: AbortSignal.timeout(10000),
          });
          if (res.status === 404 || res.status === 410) {
            this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
          } else if (!res.ok) {
            this.log.error(`push failed: ${res.status} ${new URL(s.endpoint).host}`);
          }
        } catch (err) {
          this.log.error(`push error: ${err.message}`);
        }
      }),
    );
  }
}
