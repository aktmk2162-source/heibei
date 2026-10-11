// 起動スクリプト。設定は環境変数で行う（README 参照）。
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { purgeExpiredSessions } from './lib/auth.mjs';
import { bootstrapAdmin, createApp } from './lib/app.mjs';
import { openDb } from './lib/db.mjs';

const env = process.env;
const port = Number(env.PORT || 3000);
const host = env.HOST || '0.0.0.0';
const dbFile = env.DB_FILE || new URL('./data/groupware.db', import.meta.url).pathname;

const db = openDb(dbFile);
const admin = bootstrapAdmin(db, { loginId: env.ADMIN_LOGIN_ID || 'admin', password: env.ADMIN_PASSWORD });
if (admin) {
  console.log('==============================================');
  console.log(' 初回起動のため管理者アカウントを作成しました');
  console.log(`  ログインID : ${admin.loginId}`);
  console.log(`  パスワード : ${admin.password}`);
  console.log(' 初回ログイン時にパスワードの変更が必要です');
  console.log('==============================================');
}

const handle = createApp(db, {
  secureCookie: env.COOKIE_SECURE === '1',
  trustProxy: env.TRUST_PROXY === '1',
  filesDir: env.FILES_DIR || join(dirname(dbFile), 'files'),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 50),
  push: env.PUSH !== '0',
  pushSubject: env.PUSH_CONTACT || 'mailto:admin@example.com',
});

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

const server = createServer(handle);
server.listen(port, host, () => console.log(`グループウェアを起動しました: http://localhost:${port}/`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
