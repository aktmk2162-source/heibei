// リクエスト処理の本体（認証・CSRF・ルーティング・エラー応答）。
import { fileURLToPath } from 'node:url';
import { LoginLimiter, SESSION_COOKIE, hashPassword, loadSession, randomPassword } from './auth.mjs';
import { HttpError, Router, parseCookies, readBody, sendJson, sendText, serveStatic } from './http.mjs';
import * as boardApi from './api/board.mjs';
import * as eventsApi from './api/events.mjs';
import * as usersApi from './api/users.mjs';
import * as workflowApi from './api/workflow.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

// 初回起動時（ユーザーが0人）に管理者アカウントを作る。作成した場合は初期パスワードを返す。
export function bootstrapAdmin(db, { loginId = 'admin', password } = {}) {
  const { n } = db.prepare('SELECT COUNT(*) n FROM users').get();
  if (n > 0) return null;
  const pw = password || randomPassword();
  db.prepare(
    `INSERT INTO users (login_id, name, role, password_hash, must_change_password) VALUES (?, '管理者', 'admin', ?, 1)`,
  ).run(loginId, hashPassword(pw));
  return { loginId, password: pw };
}

export function createApp(db, { secureCookie = false, trustProxy = false, log = console } = {}) {
  const router = new Router();
  const limiter = new LoginLimiter();
  usersApi.register(router, { limiter, secureCookie });
  eventsApi.register(router);
  workflowApi.register(router);
  boardApi.register(router);

  const auditStmt = db.prepare('INSERT INTO audit_log (user_id, action, target) VALUES (?, ?, ?)');

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '許可されていない操作です' });
        if (await serveStatic(res, PUBLIC_DIR, pathname)) return;
        // SPA のため未知のパスは index.html を返す
        if (!pathname.includes('.') && (await serveStatic(res, PUBLIC_DIR, '/'))) return;
        return sendText(res, 404, 'Not Found', 'text/plain; charset=utf-8');
      }

      const found = router.match(req.method, pathname);
      if (!found) return sendJson(res, 404, { error: 'API が見つかりません' });
      if (found.methodNotAllowed) return sendJson(res, 405, { error: '許可されていない操作です' });
      const { route, params } = found;

      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = loadSession(db, token);
      if (!route.opts.public) {
        if (!user) return sendJson(res, 401, { error: 'ログインしてください' });
        if (req.method !== 'GET' && req.headers['x-csrf-token'] !== user.csrf) {
          return sendJson(res, 403, { error: '画面を再読み込みしてから操作してください' });
        }
        if (route.opts.admin && user.role !== 'admin') return sendJson(res, 403, { error: '管理者のみ操作できます' });
        // 初期パスワードのままでは、パスワード変更以外の操作を受け付けない
        const allowed = ['/api/me', '/api/me/password', '/api/logout'];
        if (user.must_change_password && !allowed.includes(pathname)) {
          return sendJson(res, 403, { error: '初期パスワードを変更してください', code: 'must_change_password' });
        }
      }

      const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
      const body = req.method === 'GET' ? {} : await readBody(req);
      const ctx = {
        db,
        req,
        res,
        user,
        token,
        ip,
        params,
        body,
        query: url.searchParams,
        audit: (action, target = '', userId = user?.id ?? null) => auditStmt.run(userId, action, String(target)),
      };
      const result = await route.handler(ctx);
      if (result && typeof result.raw === 'string') {
        return sendText(res, 200, result.raw, result.type, {
          'Content-Disposition': `attachment; filename="${result.filename}"`,
        });
      }
      sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      log.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'サーバーでエラーが発生しました' });
    }
  };
}
