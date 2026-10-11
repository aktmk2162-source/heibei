// 社内ブログ（誰でも投稿でき、コメント・いいねができる）。
import { fail } from '../http.mjs';
import { int, str } from '../validate.mjs';

function loadBlog(db, id) {
  const b = db
    .prepare('SELECT b.*, u.name author_name FROM blogs b LEFT JOIN users u ON u.id = b.author_id WHERE b.id = ?')
    .get(id);
  if (!b) fail(404, '記事が見つかりません');
  return b;
}

const canManage = (row, user) => row.author_id === user.id || user.role === 'admin';

export function register(r) {
  // author で投稿者を絞り込み、q で件名・本文を検索
  r.add('GET', '/api/blogs', (c) => {
    const author = int(c.query.get('author'), '投稿者', { min: 1 });
    const q = str(c.query.get('q'), '検索語', { max: 100 });
    const conds = [];
    const args = [c.user.id];
    if (author) {
      conds.push('b.author_id = ?');
      args.push(author);
    }
    if (q) {
      conds.push("(b.title LIKE ? ESCAPE '\\' OR b.body LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      args.push(like, like);
    }
    return c.db
      .prepare(
        `SELECT b.id, b.title, substr(b.body, 1, 120) excerpt, b.author_id, b.created_at, u.name author_name,
                (SELECT COUNT(*) FROM blog_likes l WHERE l.blog_id = b.id) likes,
                (SELECT COUNT(*) FROM blog_comments m WHERE m.blog_id = b.id) comments,
                EXISTS (SELECT 1 FROM blog_likes l WHERE l.blog_id = b.id AND l.user_id = ?) liked
           FROM blogs b LEFT JOIN users u ON u.id = b.author_id
          ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
          ORDER BY b.created_at DESC, b.id DESC LIMIT 200`,
      )
      .all(...args)
      .map((b) => ({ ...b, liked: !!b.liked }));
  });

  r.add('GET', '/api/blogs/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const b = loadBlog(c.db, id);
    const comments = c.db
      .prepare(
        `SELECT m.id, m.body, m.created_at, m.author_id, u.name author_name
           FROM blog_comments m LEFT JOIN users u ON u.id = m.author_id
          WHERE m.blog_id = ? ORDER BY m.id`,
      )
      .all(id)
      .map((m) => ({ ...m, can_delete: canManage(m, c.user) }));
    const likers = c.db
      .prepare('SELECT u.name FROM blog_likes l JOIN users u ON u.id = l.user_id WHERE l.blog_id = ?')
      .all(id)
      .map((x) => x.name);
    const liked = !!c.db.prepare('SELECT 1 FROM blog_likes WHERE blog_id = ? AND user_id = ?').get(id, c.user.id);
    return { ...b, comments, likers, liked, can_edit: canManage(b, c.user) };
  });

  const fields = (c) => ({
    title: str(c.body.title, 'タイトル', { required: true, max: 100 }),
    body: str(c.body.body, '本文', { required: true, max: 30000 }),
  });

  r.add('POST', '/api/blogs', (c) => {
    const f = fields(c);
    const { lastInsertRowid } = c.db
      .prepare('INSERT INTO blogs (author_id, title, body) VALUES (?, ?, ?)')
      .run(c.user.id, f.title, f.body);
    return { id: Number(lastInsertRowid) };
  });

  r.add('PUT', '/api/blogs/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    if (!canManage(loadBlog(c.db, id), c.user)) fail(403, '投稿者または管理者のみ編集できます');
    const f = fields(c);
    c.db
      .prepare(`UPDATE blogs SET title = ?, body = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(f.title, f.body, id);
    return { ok: true };
  });

  r.add('DELETE', '/api/blogs/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    if (!canManage(loadBlog(c.db, id), c.user)) fail(403, '投稿者または管理者のみ削除できます');
    c.db.prepare('DELETE FROM blogs WHERE id = ?').run(id);
    return { ok: true };
  });

  // いいねの切り替え
  r.add('POST', '/api/blogs/:id/like', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    loadBlog(c.db, id);
    const del = c.db.prepare('DELETE FROM blog_likes WHERE blog_id = ? AND user_id = ?').run(id, c.user.id);
    if (!del.changes) c.db.prepare('INSERT INTO blog_likes (blog_id, user_id) VALUES (?, ?)').run(id, c.user.id);
    return { liked: !del.changes };
  });

  r.add('POST', '/api/blogs/:id/comments', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    loadBlog(c.db, id);
    const body = str(c.body.body, 'コメント', { required: true, max: 2000 });
    const { lastInsertRowid } = c.db
      .prepare('INSERT INTO blog_comments (blog_id, author_id, body) VALUES (?, ?, ?)')
      .run(id, c.user.id, body);
    return { id: Number(lastInsertRowid) };
  });

  r.add('DELETE', '/api/blog-comments/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const m = c.db.prepare('SELECT * FROM blog_comments WHERE id = ?').get(id);
    if (!m) fail(404, 'コメントが見つかりません');
    if (!canManage(m, c.user)) fail(403, '投稿者または管理者のみ削除できます');
    c.db.prepare('DELETE FROM blog_comments WHERE id = ?').run(id);
    return { ok: true };
  });
}
