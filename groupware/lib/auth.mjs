// パスワードハッシュ（scrypt）とセッション管理。
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12時間
export const SESSION_COOKIE = 'gw_session';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'パスワードは10文字以上にしてください';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'パスワードには英字と数字を両方含めてください';
  }
  return null;
}

export function randomPassword() {
  // 紛らわしい文字（0/O, 1/l/I）を除いた英数字。英字・数字を必ず含める。
  const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const bytes = randomBytes(12);
  let pw = letters[bytes[0] % letters.length] + digits[bytes[1] % digits.length];
  for (let i = 2; i < 12; i++) pw += all[bytes[i] % all.length];
  return pw;
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    csrf,
    Date.now() + SESSION_TTL_MS,
  );
  return { token, csrf };
}

export function loadSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.login_id, u.name, u.email, u.role,
              u.department_id, u.must_change_password
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND u.active = 1`,
    )
    .get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  // 操作のたびに有効期限を延長する（スライディング）
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_TTL_MS, row.token_hash);
  return row;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyUserSessions(db, userId, exceptToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, exceptToken ? sha256(exceptToken) : '');
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function sessionCookie(token, secure) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (token) parts.push(`Max-Age=${SESSION_TTL_MS / 1000}`);
  else parts.push('Max-Age=0');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// ログイン試行の簡易レート制限（ログインID・IPごとに 15分で10回まで）。
export class LoginLimiter {
  attempts = new Map();
  windowMs = 15 * 60 * 1000;
  max = 10;

  blocked(key) {
    const a = this.attempts.get(key);
    if (!a) return false;
    if (Date.now() - a.first > this.windowMs) {
      this.attempts.delete(key);
      return false;
    }
    return a.count >= this.max;
  }

  fail(key) {
    const a = this.attempts.get(key);
    if (!a || Date.now() - a.first > this.windowMs) this.attempts.set(key, { first: Date.now(), count: 1 });
    else a.count++;
  }

  reset(key) {
    this.attempts.delete(key);
  }
}
