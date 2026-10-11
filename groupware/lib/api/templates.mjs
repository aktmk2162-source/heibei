// テンプレート集（シミュレーション・自動化ツールなどのファイルを版管理して共有する）。
// ファイル本体はディスク（filesDir）に保存し、DB にはメタ情報だけを持つ。
import { stat } from 'node:fs/promises';
import { tx } from '../db.mjs';
import { DOCUMENT_EXT, MACRO_EXT, cleanFilename, ext } from '../files.mjs';
import { fail } from '../http.mjs';
import { int, str } from '../validate.mjs';

export const TEMPLATE_CATEGORIES = [
  '収支・投資シミュレーション',
  'ローン・資金計画',
  '税金・諸費用',
  '査定・価格分析',
  '業務自動化（マクロ・スクリプト）',
  '契約書・書式',
  '営業・提案資料',
  'その他',
];

const ALLOWED_EXT = new Set(DOCUMENT_EXT);

const canManage = (t, user) => t.owner_id === user.id || user.role === 'admin';

function loadTemplate(db, id) {
  const t = db
    .prepare('SELECT t.*, u.name owner_name FROM templates t LEFT JOIN users u ON u.id = t.owner_id WHERE t.id = ?')
    .get(id);
  if (!t) fail(404, 'テンプレートが見つかりません');
  return t;
}

function fileRow(f) {
  return { ...f, ext: ext(f.original_name), has_macro: MACRO_EXT.has(ext(f.original_name)), stored_name: undefined };
}

export function register(r, { store }) {
  r.add('GET', '/api/template-categories', () => TEMPLATE_CATEGORIES);

  r.add('GET', '/api/templates', (c) => {
    const category = c.query.get('category') || '';
    const q = str(c.query.get('q'), '検索語', { max: 100 });
    const conds = [];
    const args = [];
    if (category) {
      conds.push('t.category = ?');
      args.push(category);
    }
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      conds.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR t.usage LIKE ? ESCAPE '\\')");
      args.push(like, like, like);
    }
    return c.db
      .prepare(
        `SELECT t.id, t.title, t.category, substr(t.description, 1, 140) excerpt, t.downloads, t.updated_at, t.owner_id,
                u.name owner_name, f.original_name, f.version, f.size
           FROM templates t
           LEFT JOIN users u ON u.id = t.owner_id
           LEFT JOIN template_files f ON f.id = (SELECT id FROM template_files WHERE template_id = t.id ORDER BY version DESC LIMIT 1)
          ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
          ORDER BY t.updated_at DESC, t.id DESC LIMIT 500`,
      )
      .all(...args)
      .map((t) => ({ ...t, ext: t.original_name ? ext(t.original_name) : '', has_macro: MACRO_EXT.has(ext(t.original_name || '')) }));
  });

  r.add('GET', '/api/templates/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const t = loadTemplate(c.db, id);
    const files = c.db
      .prepare(
        `SELECT f.id, f.version, f.original_name, f.size, f.sha256, f.note, f.uploaded_at, u.name uploaded_by_name
           FROM template_files f LEFT JOIN users u ON u.id = f.uploaded_by
          WHERE f.template_id = ? ORDER BY f.version DESC`,
      )
      .all(id)
      .map(fileRow);
    return { ...t, files, can_edit: canManage(t, c.user) };
  });

  function fields(c) {
    const category = c.body.category;
    if (!TEMPLATE_CATEGORIES.includes(category)) fail(400, '分類を選択してください');
    return {
      title: str(c.body.title, '名称', { required: true, max: 100 }),
      category,
      description: str(c.body.description, '説明', { max: 5000 }),
      usage: str(c.body.usage, '使い方・注意事項', { max: 10000 }),
    };
  }

  // 登録はメタ情報 → ファイルの順に2回に分けて送る
  r.add('POST', '/api/templates', (c) => {
    const f = fields(c);
    const { lastInsertRowid } = c.db
      .prepare('INSERT INTO templates (title, category, description, usage, owner_id) VALUES (?, ?, ?, ?, ?)')
      .run(f.title, f.category, f.description, f.usage, c.user.id);
    c.audit('template_created', f.title);
    return { id: Number(lastInsertRowid) };
  });

  r.add('PUT', '/api/templates/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    if (!canManage(loadTemplate(c.db, id), c.user)) fail(403, '登録者または管理者のみ編集できます');
    const f = fields(c);
    c.db
      .prepare(`UPDATE templates SET title = ?, category = ?, description = ?, usage = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(f.title, f.category, f.description, f.usage, id);
    return { ok: true };
  });

  // ファイル本体のアップロード（新しい版として追加）。?name=ファイル名&note=変更内容
  r.add(
    'POST',
    '/api/templates/:id/files',
    async (c) => {
      const id = int(c.params.id, 'ID', { required: true });
      const t = loadTemplate(c.db, id);
      if (!canManage(t, c.user)) fail(403, '登録者または管理者のみファイルを更新できます');
      const name = cleanFilename(c.query.get('name'), ALLOWED_EXT);
      const note = str(c.query.get('note'), '変更内容', { max: 500 });
      const saved = await store.receive(c.req);
      try {
        const version = tx(c.db, () => {
          const v = (c.db.prepare('SELECT MAX(version) v FROM template_files WHERE template_id = ?').get(id).v || 0) + 1;
          c.db
            .prepare(
              `INSERT INTO template_files (template_id, version, original_name, stored_name, size, sha256, note, uploaded_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(id, v, name, saved.stored, saved.size, saved.sha256, note, c.user.id);
          c.db.prepare(`UPDATE templates SET updated_at = datetime('now','localtime') WHERE id = ?`).run(id);
          return v;
        });
        c.audit('template_file_uploaded', `${t.title} v${version}`);
        return { version };
      } catch (err) {
        await store.remove(saved.stored);
        throw err;
      }
    },
    { raw: true },
  );

  r.add('GET', '/api/template-files/:id/download', async (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const f = c.db.prepare('SELECT * FROM template_files WHERE id = ?').get(id);
    if (!f) fail(404, 'ファイルが見つかりません');
    const path = store.path(f.stored_name);
    try {
      await stat(path);
    } catch {
      fail(404, 'ファイル本体が見つかりません。管理者に連絡してください');
    }
    c.db.prepare('UPDATE templates SET downloads = downloads + 1 WHERE id = ?').run(f.template_id);
    return { file: path, size: f.size, filename: f.original_name };
  });

  // 古い版のファイルを削除（最新版は削除不可。テンプレートごと削除する）
  r.add('DELETE', '/api/template-files/:id', async (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const f = c.db.prepare('SELECT * FROM template_files WHERE id = ?').get(id);
    if (!f) fail(404, 'ファイルが見つかりません');
    if (!canManage(loadTemplate(c.db, f.template_id), c.user)) fail(403, '登録者または管理者のみ削除できます');
    const latest = c.db.prepare('SELECT MAX(version) v FROM template_files WHERE template_id = ?').get(f.template_id).v;
    if (f.version === latest) fail(400, '最新版は削除できません');
    c.db.prepare('DELETE FROM template_files WHERE id = ?').run(id);
    await store.remove(f.stored_name);
    return { ok: true };
  });

  r.add('DELETE', '/api/templates/:id', async (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const t = loadTemplate(c.db, id);
    if (!canManage(t, c.user)) fail(403, '登録者または管理者のみ削除できます');
    const files = c.db.prepare('SELECT stored_name FROM template_files WHERE template_id = ?').all(id);
    c.db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    for (const f of files) await store.remove(f.stored_name);
    c.audit('template_deleted', t.title);
    return { ok: true };
  });
}
