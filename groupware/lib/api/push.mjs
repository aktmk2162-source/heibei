// プッシュ通知の購読管理（端末ごと）。
import { fail } from '../http.mjs';
import { isAllowedEndpoint } from '../push.mjs';
import { str } from '../validate.mjs';

export function register(r, { pusher }) {
  r.add('GET', '/api/push/key', () => ({ publicKey: pusher?.keys.publicKey ?? null }));

  r.add('POST', '/api/push/subscribe', (c) => {
    if (!pusher) fail(503, '通知は無効に設定されています');
    const endpoint = str(c.body.endpoint, 'endpoint', { required: true, max: 1000 });
    if (!isAllowedEndpoint(endpoint)) fail(400, 'この通知サービスには対応していません');
    const p256dh = str(c.body.keys?.p256dh, 'p256dh', { required: true, max: 200 });
    const auth = str(c.body.keys?.auth, 'auth', { required: true, max: 100 });
    if (Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(auth, 'base64url').length !== 16) {
      fail(400, '通知の登録情報が正しくありません');
    }
    const ua = str(String(c.req.headers['user-agent'] || '').slice(0, 300), 'UA', { max: 300 });
    // 同じ端末が別の人で再登録された場合も、最後にログインした人に付け替える
    c.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
           user_agent = excluded.user_agent`,
      )
      .run(c.user.id, endpoint, p256dh, auth, ua);
    return { ok: true };
  });

  r.add('POST', '/api/push/unsubscribe', (c) => {
    const endpoint = str(c.body.endpoint, 'endpoint', { required: true, max: 1000 });
    c.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, c.user.id);
    return { ok: true };
  });

  r.add('GET', '/api/push/devices', (c) =>
    c.db.prepare('SELECT id, user_agent, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC').all(c.user.id),
  );

  r.add('POST', '/api/push/test', async (c) => {
    if (!pusher) fail(503, '通知は無効に設定されています');
    const { n } = c.db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?').get(c.user.id);
    if (!n) fail(400, '通知を受け取る端末が登録されていません');
    await pusher.sendToUsers([c.user.id], { title: '社内グループウェア', body: 'テスト通知です。この端末で通知を受け取れます。', url: '/#/settings', tag: 'test' });
    return { devices: n };
  });
}
