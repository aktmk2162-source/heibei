// 緊急用: 指定ユーザーのパスワードを初期化する（管理者が誰もログインできなくなった場合など）。
// サーバー上で実行します:
//   sudo -u groupware env $(sudo cat /etc/groupware/groupware.env | grep ^DB_FILE) node scripts/reset-password.mjs admin
import { hashPassword, randomPassword } from '../lib/auth.mjs';
import { openDb } from '../lib/db.mjs';

const loginId = process.argv[2];
if (!loginId) {
  console.error('使い方: node scripts/reset-password.mjs <ログインID>');
  process.exit(1);
}
const db = openDb(process.env.DB_FILE || new URL('../data/groupware.db', import.meta.url).pathname);
const u = db.prepare('SELECT id, name FROM users WHERE login_id = ?').get(loginId);
if (!u) {
  console.error(`ログインID「${loginId}」は見つかりません`);
  process.exit(1);
}
const pw = randomPassword();
db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, active = 1 WHERE id = ?').run(hashPassword(pw), u.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
db.prepare("INSERT INTO audit_log (user_id, action, target) VALUES (NULL, 'password_reset', ?)").run(`${loginId}（サーバー上で実行）`);
db.close();
console.log(`${u.name}（${loginId}）のパスワードを初期化しました。初期パスワード: ${pw}`);
console.log('初回ログイン時に変更が必要です。');
