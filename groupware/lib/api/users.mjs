// ログイン・個人設定・ユーザー/部署/施設のマスタ管理。
import {
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  randomPassword,
  sessionCookie,
  validatePassword,
  verifyPassword,
} from '../auth.mjs';
import { tx } from '../db.mjs';
import { fail } from '../http.mjs';
import { bool, int, parseCsv, str } from '../validate.mjs';

const ROLES = ['admin', 'member'];

export function publicUser(u, csrf) {
  return {
    id: u.id,
    login_id: u.login_id,
    name: u.name,
    email: u.email,
    role: u.role,
    department_id: u.department_id,
    must_change_password: !!u.must_change_password,
    ...(csrf ? { csrf } : {}),
  };
}

function assertNotLastAdmin(db, userId) {
  const { n } = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(userId);
  if (n === 0) fail(400, '有効な管理者が1人もいなくなるため変更できません');
}

function departmentId(db, v) {
  const id = int(v, '部署', { min: 1 });
  if (id && !db.prepare('SELECT 1 FROM departments WHERE id = ?').get(id)) fail(400, '部署が見つかりません');
  return id;
}

export function register(r, { limiter, secureCookie }) {
  r.add(
    'POST',
    '/api/login',
    (c) => {
      const loginId = str(c.body.login_id, 'ログインID', { required: true, max: 100 });
      const password = typeof c.body.password === 'string' ? c.body.password : '';
      const key = `${loginId.toLowerCase()}|${c.ip}`;
      if (limiter.blocked(key)) fail(429, 'ログインの試行回数が多すぎます。15分ほど待ってから再度お試しください');
      const u = c.db.prepare('SELECT * FROM users WHERE login_id = ? AND active = 1').get(loginId);
      if (!u || !verifyPassword(password, u.password_hash)) {
        limiter.fail(key);
        c.audit('login_failed', loginId, null);
        fail(401, 'ログインIDまたはパスワードが違います');
      }
      limiter.reset(key);
      const { token, csrf } = createSession(c.db, u.id);
      c.res.setHeader('Set-Cookie', sessionCookie(token, secureCookie));
      c.audit('login', '', u.id);
      return publicUser(u, csrf);
    },
    { public: true },
  );

  r.add('POST', '/api/logout', (c) => {
    destroySession(c.db, c.token);
    c.res.setHeader('Set-Cookie', sessionCookie('', secureCookie));
    return { ok: true };
  });

  r.add('GET', '/api/me', (c) => publicUser(c.user, c.user.csrf));

  r.add('PUT', '/api/me', (c) => {
    const email = str(c.body.email, 'メールアドレス', { max: 200 });
    c.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, c.user.id);
    return { ok: true };
  });

  r.add('POST', '/api/me/password', (c) => {
    const current = typeof c.body.current === 'string' ? c.body.current : '';
    const next = c.body.next;
    const u = c.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(c.user.id);
    if (!verifyPassword(current, u.password_hash)) fail(400, '現在のパスワードが違います');
    const err = validatePassword(next);
    if (err) fail(400, err);
    if (next === current) fail(400, '新しいパスワードは現在と異なるものにしてください');
    c.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(next), c.user.id);
    destroyUserSessions(c.db, c.user.id, c.token);
    c.audit('password_changed', '');
    return { ok: true };
  });

  // ---- 参照（全社員） ----
  r.add('GET', '/api/users', (c) =>
    c.db
      .prepare(
        `SELECT u.id, u.login_id, u.name, u.email, u.department_id, d.name department
           FROM users u LEFT JOIN departments d ON d.id = u.department_id
          WHERE u.active = 1
          ORDER BY COALESCE(d.sort, 1e9), d.name, u.sort, u.name`,
      )
      .all(),
  );

  r.add('GET', '/api/departments', (c) => c.db.prepare('SELECT * FROM departments ORDER BY sort, name').all());

  r.add('GET', '/api/facilities', (c) =>
    c.db.prepare('SELECT * FROM facilities WHERE active = 1 ORDER BY sort, name').all(),
  );

  // ---- 管理: ユーザー ----
  const admin = { admin: true };

  r.add(
    'GET',
    '/api/admin/users',
    (c) =>
      c.db
        .prepare(
          `SELECT u.id, u.login_id, u.name, u.email, u.department_id, u.role, u.active, u.sort,
                  u.must_change_password, d.name department
             FROM users u LEFT JOIN departments d ON d.id = u.department_id
            ORDER BY u.active DESC, COALESCE(d.sort, 1e9), d.name, u.sort, u.name`,
        )
        .all(),
    admin,
  );

  function userFields(c) {
    const role = c.body.role ?? 'member';
    if (!ROLES.includes(role)) fail(400, '権限の値が正しくありません');
    const loginId = str(c.body.login_id, 'ログインID', { required: true, max: 50 });
    if (!/^[A-Za-z0-9._@-]+$/.test(loginId)) fail(400, 'ログインIDは半角英数字と . _ @ - のみ使えます');
    return {
      login_id: loginId,
      name: str(c.body.name, '氏名', { required: true, max: 50 }),
      email: str(c.body.email, 'メールアドレス', { max: 200 }),
      department_id: departmentId(c.db, c.body.department_id),
      role,
      sort: int(c.body.sort, '表示順', { min: 0, max: 100000 }) ?? 0,
    };
  }

  function uniqueLogin(db, loginId, exceptId = 0) {
    if (db.prepare('SELECT 1 FROM users WHERE login_id = ? AND id != ?').get(loginId, exceptId)) {
      fail(409, `ログインID「${loginId}」は既に使われています`);
    }
  }

  r.add(
    'POST',
    '/api/admin/users',
    (c) => {
      const f = userFields(c);
      uniqueLogin(c.db, f.login_id);
      const password = randomPassword();
      const { lastInsertRowid } = c.db
        .prepare(
          `INSERT INTO users (login_id, name, email, department_id, role, sort, password_hash, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(f.login_id, f.name, f.email, f.department_id, f.role, f.sort, hashPassword(password));
      c.audit('user_created', f.login_id);
      return { id: Number(lastInsertRowid), initial_password: password };
    },
    admin,
  );

  r.add(
    'PUT',
    '/api/admin/users/:id',
    (c) => {
      const id = int(c.params.id, 'ID', { required: true });
      const cur = c.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!cur) fail(404, 'ユーザーが見つかりません');
      const f = userFields(c);
      const active = c.body.active === undefined ? cur.active : bool(c.body.active) ? 1 : 0;
      uniqueLogin(c.db, f.login_id, id);
      if (cur.role === 'admin' && cur.active && (f.role !== 'admin' || !active)) assertNotLastAdmin(c.db, id);
      if (id === c.user.id && !active) fail(400, '自分自身を無効にはできません');
      c.db
        .prepare(
          `UPDATE users SET login_id = ?, name = ?, email = ?, department_id = ?, role = ?, sort = ?, active = ?
            WHERE id = ?`,
        )
        .run(f.login_id, f.name, f.email, f.department_id, f.role, f.sort, active, id);
      if (!active) destroyUserSessions(c.db, id);
      c.audit('user_updated', f.login_id);
      return { ok: true };
    },
    admin,
  );

  r.add(
    'POST',
    '/api/admin/users/:id/reset-password',
    (c) => {
      const id = int(c.params.id, 'ID', { required: true });
      const u = c.db.prepare('SELECT login_id FROM users WHERE id = ?').get(id);
      if (!u) fail(404, 'ユーザーが見つかりません');
      const password = randomPassword();
      c.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(password), id);
      destroyUserSessions(c.db, id);
      c.audit('password_reset', u.login_id);
      return { initial_password: password };
    },
    admin,
  );

  // CSV 一括登録: ログインID,氏名,メールアドレス,部署,権限(admin/member)
  r.add(
    'POST',
    '/api/admin/users/import',
    (c) => {
      const rows = parseCsv(str(c.body.csv, 'CSV', { required: true, max: 1_000_000 }));
      if (rows[0] && /ログイン|login/i.test(rows[0][0])) rows.shift();
      if (!rows.length) fail(400, 'CSV にデータ行がありません');
      if (rows.length > 1000) fail(400, '一度に登録できるのは1000件までです');
      const created = [];
      const skipped = [];
      tx(c.db, () => {
        rows.forEach((row, i) => {
          const line = i + 1;
          const [loginId = '', name = '', email = '', dept = '', role = ''] = row.map((s) => s.trim());
          if (!loginId || !name) return skipped.push({ line, reason: 'ログインIDと氏名は必須です' });
          if (!/^[A-Za-z0-9._@-]+$/.test(loginId)) return skipped.push({ line, reason: 'ログインIDに使えない文字があります' });
          if (c.db.prepare('SELECT 1 FROM users WHERE login_id = ?').get(loginId)) {
            return skipped.push({ line, reason: `ログインID「${loginId}」は登録済みです` });
          }
          let deptId = null;
          if (dept) {
            const d = c.db.prepare('SELECT id FROM departments WHERE name = ?').get(dept);
            deptId = d ? d.id : Number(c.db.prepare('INSERT INTO departments (name) VALUES (?)').run(dept).lastInsertRowid);
          }
          const password = randomPassword();
          c.db
            .prepare(
              `INSERT INTO users (login_id, name, email, department_id, role, password_hash, must_change_password)
               VALUES (?, ?, ?, ?, ?, ?, 1)`,
            )
            .run(loginId, name, email, deptId, role === 'admin' ? 'admin' : 'member', hashPassword(password));
          created.push({ login_id: loginId, name, initial_password: password });
        });
      });
      c.audit('users_imported', `${created.length}件`);
      return { created, skipped };
    },
    admin,
  );

  // ---- 管理: 部署 ----
  r.add(
    'POST',
    '/api/admin/departments',
    (c) => {
      const name = str(c.body.name, '部署名', { required: true, max: 50 });
      if (c.db.prepare('SELECT 1 FROM departments WHERE name = ?').get(name)) fail(409, '同じ名前の部署があります');
      const sort = int(c.body.sort, '表示順', { min: 0, max: 100000 }) ?? 0;
      const { lastInsertRowid } = c.db.prepare('INSERT INTO departments (name, sort) VALUES (?, ?)').run(name, sort);
      return { id: Number(lastInsertRowid) };
    },
    admin,
  );

  r.add(
    'PUT',
    '/api/admin/departments/:id',
    (c) => {
      const id = int(c.params.id, 'ID', { required: true });
      const name = str(c.body.name, '部署名', { required: true, max: 50 });
      if (c.db.prepare('SELECT 1 FROM departments WHERE name = ? AND id != ?').get(name, id)) fail(409, '同じ名前の部署があります');
      const sort = int(c.body.sort, '表示順', { min: 0, max: 100000 }) ?? 0;
      if (!c.db.prepare('UPDATE departments SET name = ?, sort = ? WHERE id = ?').run(name, sort, id).changes) {
        fail(404, '部署が見つかりません');
      }
      return { ok: true };
    },
    admin,
  );

  r.add(
    'DELETE',
    '/api/admin/departments/:id',
    (c) => {
      const id = int(c.params.id, 'ID', { required: true });
      c.db.prepare('DELETE FROM departments WHERE id = ?').run(id);
      return { ok: true };
    },
    admin,
  );

  // ---- 管理: 施設 ----
  r.add(
    'GET',
    '/api/admin/facilities',
    (c) => c.db.prepare('SELECT * FROM facilities ORDER BY active DESC, sort, name').all(),
    admin,
  );

  function facilityFields(c) {
    return {
      name: str(c.body.name, '施設名', { required: true, max: 50 }),
      capacity: int(c.body.capacity, '定員', { min: 0, max: 10000 }),
      note: str(c.body.note, '備考', { max: 500 }),
      sort: int(c.body.sort, '表示順', { min: 0, max: 100000 }) ?? 0,
      active: c.body.active === undefined ? 1 : bool(c.body.active) ? 1 : 0,
    };
  }

  r.add(
    'POST',
    '/api/admin/facilities',
    (c) => {
      const f = facilityFields(c);
      if (c.db.prepare('SELECT 1 FROM facilities WHERE name = ?').get(f.name)) fail(409, '同じ名前の施設があります');
      const { lastInsertRowid } = c.db
        .prepare('INSERT INTO facilities (name, capacity, note, sort, active) VALUES (?, ?, ?, ?, ?)')
        .run(f.name, f.capacity, f.note, f.sort, f.active);
      return { id: Number(lastInsertRowid) };
    },
    admin,
  );

  r.add(
    'PUT',
    '/api/admin/facilities/:id',
    (c) => {
      const id = int(c.params.id, 'ID', { required: true });
      const f = facilityFields(c);
      if (c.db.prepare('SELECT 1 FROM facilities WHERE name = ? AND id != ?').get(f.name, id)) fail(409, '同じ名前の施設があります');
      const { changes } = c.db
        .prepare('UPDATE facilities SET name = ?, capacity = ?, note = ?, sort = ?, active = ? WHERE id = ?')
        .run(f.name, f.capacity, f.note, f.sort, f.active, id);
      if (!changes) fail(404, '施設が見つかりません');
      return { ok: true };
    },
    admin,
  );

  r.add(
    'GET',
    '/api/admin/audit',
    (c) =>
      c.db
        .prepare(
          `SELECT a.at, a.action, a.target, u.name user_name
             FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.id DESC LIMIT 300`,
        )
        .all(),
    admin,
  );
}
