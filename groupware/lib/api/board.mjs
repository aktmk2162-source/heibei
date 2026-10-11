// 掲示板（お知らせ）・ToDo・ホーム画面の集計。
import { fail } from '../http.mjs';
import { addDays, bool, date, int, localToday, str } from '../validate.mjs';
import { pendingApprovalCount } from './workflow.mjs';

function loadPost(db, id) {
  const p = db
    .prepare('SELECT p.*, u.name author_name FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ?')
    .get(id);
  if (!p) fail(404, 'お知らせが見つかりません');
  return p;
}

const canManagePost = (p, user) => p.author_id === user.id || user.role === 'admin';

export function register(r) {
  // ---- 掲示板 ----
  r.add('GET', '/api/posts', (c) =>
    c.db
      .prepare(
        `SELECT p.id, p.title, p.pinned, p.created_at, p.updated_at, u.name author_name,
                EXISTS (SELECT 1 FROM post_reads pr WHERE pr.post_id = p.id AND pr.user_id = ?) is_read
           FROM posts p LEFT JOIN users u ON u.id = p.author_id
          ORDER BY p.pinned DESC, p.created_at DESC, p.id DESC LIMIT 300`,
      )
      .all(c.user.id)
      .map((p) => ({ ...p, pinned: !!p.pinned, is_read: !!p.is_read })),
  );

  r.add('GET', '/api/posts/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPost(c.db, id);
    c.db.prepare('INSERT OR IGNORE INTO post_reads (post_id, user_id) VALUES (?, ?)').run(id, c.user.id);
    const readers = c.db
      .prepare(
        `SELECT u.name, pr.read_at FROM post_reads pr JOIN users u ON u.id = pr.user_id
          WHERE pr.post_id = ? ORDER BY pr.read_at`,
      )
      .all(id);
    const { n } = c.db.prepare('SELECT COUNT(*) n FROM users WHERE active = 1').get();
    return { ...p, pinned: !!p.pinned, readers, active_users: n, can_edit: canManagePost(p, c.user) };
  });

  function postFields(c) {
    return {
      title: str(c.body.title, '件名', { required: true, max: 100 }),
      body: str(c.body.body, '本文', { required: true, max: 20000 }),
      // 上部固定は全社員に目立つため管理者のみ設定できる
      pinned: c.user.role === 'admin' && bool(c.body.pinned) ? 1 : 0,
    };
  }

  r.add('POST', '/api/posts', (c) => {
    const f = postFields(c);
    const { lastInsertRowid } = c.db
      .prepare('INSERT INTO posts (title, body, pinned, author_id) VALUES (?, ?, ?, ?)')
      .run(f.title, f.body, f.pinned, c.user.id);
    const id = Number(lastInsertRowid);
    c.db.prepare('INSERT INTO post_reads (post_id, user_id) VALUES (?, ?)').run(id, c.user.id);
    return { id };
  });

  r.add('PUT', '/api/posts/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPost(c.db, id);
    if (!canManagePost(p, c.user)) fail(403, '投稿者または管理者のみ編集できます');
    const f = postFields(c);
    c.db
      .prepare(`UPDATE posts SET title = ?, body = ?, pinned = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(f.title, f.body, f.pinned, id);
    return { ok: true };
  });

  r.add('DELETE', '/api/posts/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPost(c.db, id);
    if (!canManagePost(p, c.user)) fail(403, '投稿者または管理者のみ削除できます');
    c.db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    return { ok: true };
  });

  // ---- ToDo（本人のみ） ----
  r.add('GET', '/api/todos', (c) =>
    c.db
      .prepare(
        `SELECT * FROM todos WHERE user_id = ?
          ORDER BY done, due_date IS NULL, due_date, id DESC LIMIT 500`,
      )
      .all(c.user.id)
      .map((t) => ({ ...t, done: !!t.done })),
  );

  r.add('POST', '/api/todos', (c) => {
    const title = str(c.body.title, '内容', { required: true, max: 200 });
    const due = date(c.body.due_date, '期限');
    const { lastInsertRowid } = c.db
      .prepare('INSERT INTO todos (user_id, title, due_date) VALUES (?, ?, ?)')
      .run(c.user.id, title, due);
    return { id: Number(lastInsertRowid) };
  });

  r.add('PUT', '/api/todos/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const t = c.db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(id, c.user.id);
    if (!t) fail(404, 'ToDo が見つかりません');
    const title = c.body.title === undefined ? t.title : str(c.body.title, '内容', { required: true, max: 200 });
    const due = c.body.due_date === undefined ? t.due_date : date(c.body.due_date, '期限');
    const done = c.body.done === undefined ? t.done : bool(c.body.done) ? 1 : 0;
    c.db.prepare('UPDATE todos SET title = ?, due_date = ?, done = ? WHERE id = ?').run(title, due, done, id);
    return { ok: true };
  });

  r.add('DELETE', '/api/todos/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    c.db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(id, c.user.id);
    return { ok: true };
  });

  // ---- ホーム ----
  r.add('GET', '/api/dashboard', (c) => {
    const today = date(c.query.get('today'), '日付') || localToday();
    const events = c.db
      .prepare(
        `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.location
           FROM events e JOIN event_participants p ON p.event_id = e.id AND p.user_id = ?
          WHERE e.start_at < ? AND e.end_at > ?
          ORDER BY e.all_day DESC, e.start_at`,
      )
      .all(c.user.id, `${addDays(today, 1)} 00:00`, `${today} 00:00`)
      .map((e) => ({ ...e, all_day: !!e.all_day }));
    const unread = c.db
      .prepare(
        `SELECT p.id, p.title, p.created_at, u.name author_name FROM posts p LEFT JOIN users u ON u.id = p.author_id
          WHERE NOT EXISTS (SELECT 1 FROM post_reads pr WHERE pr.post_id = p.id AND pr.user_id = ?)
          ORDER BY p.pinned DESC, p.created_at DESC LIMIT 10`,
      )
      .all(c.user.id);
    const todos = c.db
      .prepare(
        `SELECT * FROM todos WHERE user_id = ? AND done = 0 ORDER BY due_date IS NULL, due_date, id DESC LIMIT 10`,
      )
      .all(c.user.id);
    const myPending = c.db
      .prepare(`SELECT COUNT(*) n FROM requests WHERE applicant_id = ? AND status IN ('pending','returned')`)
      .get(c.user.id).n;
    return { today, events, unread, todos, approvals: pendingApprovalCount(c.db, c.user.id), my_pending: myPending };
  });
}
