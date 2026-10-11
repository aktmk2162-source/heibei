// ワークフロー（稟議・各種申請）。承認者を順番に回す直列承認。
import { tx } from '../db.mjs';
import { fail } from '../http.mjs';
import { ids, int, str } from '../validate.mjs';

export const REQUEST_TYPES = ['稟議', '経費精算', '休暇申請', '出張申請', '購買申請', 'その他'];
const MAX_STEPS = 6;

function requestFields(c) {
  const type = c.body.type;
  if (!REQUEST_TYPES.includes(type)) fail(400, '申請種別が正しくありません');
  const approverIds = ids(c.body.approver_ids, '承認者');
  if (!approverIds.length) fail(400, '承認者を1人以上指定してください');
  if (approverIds.length > MAX_STEPS) fail(400, `承認者は${MAX_STEPS}人までです`);
  if (approverIds.includes(c.user.id)) fail(400, '自分を承認者にすることはできません');
  for (const id of approverIds) {
    if (!c.db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) fail(400, '承認者に無効なユーザーが含まれています');
  }
  return {
    type,
    title: str(c.body.title, '件名', { required: true, max: 100 }),
    body: str(c.body.body, '内容', { max: 10000 }),
    amount: int(c.body.amount, '金額', { min: 0, max: 1e12 }),
    approverIds,
  };
}

function insertSteps(db, requestId, approverIds) {
  const ins = db.prepare('INSERT INTO request_steps (request_id, step_no, approver_id) VALUES (?, ?, ?)');
  approverIds.forEach((uid, i) => ins.run(requestId, i + 1, uid));
}

function loadRequest(db, id, user) {
  const req = db
    .prepare(
      `SELECT r.*, u.name applicant_name FROM requests r JOIN users u ON u.id = r.applicant_id WHERE r.id = ?`,
    )
    .get(id);
  if (!req) fail(404, '申請が見つかりません');
  const steps = db
    .prepare(
      `SELECT s.step_no, s.approver_id, s.status, s.comment, s.acted_at, u.name approver_name
         FROM request_steps s JOIN users u ON u.id = s.approver_id
        WHERE s.request_id = ? ORDER BY s.step_no`,
    )
    .all(id);
  const isApprover = steps.some((s) => s.approver_id === user.id);
  if (req.applicant_id !== user.id && !isApprover && user.role !== 'admin') fail(403, 'この申請を閲覧する権限がありません');
  const current = steps.find((s) => s.step_no === req.current_step);
  return {
    ...req,
    steps,
    can_act: req.status === 'pending' && current?.approver_id === user.id,
    can_withdraw: req.applicant_id === user.id && ['pending', 'returned'].includes(req.status),
    can_resubmit: req.applicant_id === user.id && req.status === 'returned',
  };
}

const LIST_SQL = `
  SELECT r.id, r.type, r.title, r.amount, r.status, r.created_at, r.updated_at, r.current_step,
         a.name applicant_name,
         (SELECT u.name FROM request_steps s JOIN users u ON u.id = s.approver_id
           WHERE s.request_id = r.id AND s.step_no = r.current_step) current_approver_name,
         (SELECT COUNT(*) FROM request_steps s WHERE s.request_id = r.id) step_count
    FROM requests r JOIN users a ON a.id = r.applicant_id`;

export function pendingApprovalCount(db, userId) {
  return db
    .prepare(
      `SELECT COUNT(*) n FROM requests r JOIN request_steps s ON s.request_id = r.id AND s.step_no = r.current_step
        WHERE r.status = 'pending' AND s.approver_id = ?`,
    )
    .get(userId).n;
}

export function register(r) {
  r.add('GET', '/api/request-types', () => REQUEST_TYPES);

  // box: todo=自分の承認待ち / mine=自分の申請 / done=自分が処理済み / all=全件（管理者）
  r.add('GET', '/api/requests', (c) => {
    const box = c.query.get('box') || 'todo';
    const order = ' ORDER BY r.updated_at DESC, r.id DESC LIMIT 500';
    if (box === 'mine') return c.db.prepare(`${LIST_SQL} WHERE r.applicant_id = ?${order}`).all(c.user.id);
    if (box === 'todo') {
      return c.db
        .prepare(
          `${LIST_SQL} JOIN request_steps cs ON cs.request_id = r.id AND cs.step_no = r.current_step
            WHERE r.status = 'pending' AND cs.approver_id = ?${order}`,
        )
        .all(c.user.id);
    }
    if (box === 'done') {
      return c.db
        .prepare(
          `${LIST_SQL} WHERE r.id IN (SELECT request_id FROM request_steps WHERE approver_id = ? AND status != 'waiting')${order}`,
        )
        .all(c.user.id);
    }
    if (box === 'all') {
      if (c.user.role !== 'admin') fail(403, '管理者のみ閲覧できます');
      return c.db.prepare(`${LIST_SQL}${order}`).all();
    }
    fail(400, '一覧の種類が正しくありません');
  });

  r.add('GET', '/api/requests/:id', (c) => loadRequest(c.db, int(c.params.id, 'ID', { required: true }), c.user));

  r.add('POST', '/api/requests', (c) => {
    const f = requestFields(c);
    const id = tx(c.db, () => {
      const { lastInsertRowid } = c.db
        .prepare('INSERT INTO requests (type, title, body, amount, applicant_id) VALUES (?, ?, ?, ?, ?)')
        .run(f.type, f.title, f.body, f.amount, c.user.id);
      const rid = Number(lastInsertRowid);
      insertSteps(c.db, rid, f.approverIds);
      return rid;
    });
    c.audit('request_submitted', `#${id}`);
    return { id };
  });

  // 差し戻された申請を修正して再申請する。
  r.add('PUT', '/api/requests/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const req = loadRequest(c.db, id, c.user);
    if (!req.can_resubmit) fail(400, '差し戻し中の自分の申請のみ再申請できます');
    const f = requestFields(c);
    tx(c.db, () => {
      c.db
        .prepare(
          `UPDATE requests SET type = ?, title = ?, body = ?, amount = ?, status = 'pending', current_step = 1,
                  updated_at = datetime('now','localtime') WHERE id = ?`,
        )
        .run(f.type, f.title, f.body, f.amount, id);
      c.db.prepare('DELETE FROM request_steps WHERE request_id = ?').run(id);
      insertSteps(c.db, id, f.approverIds);
    });
    c.audit('request_resubmitted', `#${id}`);
    return { ok: true };
  });

  r.add('POST', '/api/requests/:id/act', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const action = c.body.action;
    if (!['approve', 'reject', 'return'].includes(action)) fail(400, '操作の種類が正しくありません');
    const comment = str(c.body.comment, 'コメント', { max: 2000 });
    if (action !== 'approve' && !comment) fail(400, '却下・差し戻しの場合はコメントを入力してください');
    tx(c.db, () => {
      const req = loadRequest(c.db, id, c.user);
      if (!req.can_act) fail(409, 'この申請は現在あなたの承認待ちではありません');
      const stepStatus = { approve: 'approved', reject: 'rejected', return: 'returned' }[action];
      c.db
        .prepare(
          `UPDATE request_steps SET status = ?, comment = ?, acted_at = datetime('now','localtime')
            WHERE request_id = ? AND step_no = ?`,
        )
        .run(stepStatus, comment, id, req.current_step);
      let status = 'pending';
      let next = req.current_step;
      if (action === 'approve') {
        if (req.current_step >= req.steps.length) status = 'approved';
        else next++;
      } else status = action === 'reject' ? 'rejected' : 'returned';
      c.db
        .prepare(`UPDATE requests SET status = ?, current_step = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(status, next, id);
    });
    c.audit(`request_${action}`, `#${id}`);
    return loadRequest(c.db, id, c.user);
  });

  r.add('POST', '/api/requests/:id/withdraw', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const req = loadRequest(c.db, id, c.user);
    if (!req.can_withdraw) fail(400, 'この申請は取り下げできません');
    c.db.prepare(`UPDATE requests SET status = 'withdrawn', updated_at = datetime('now','localtime') WHERE id = ?`).run(id);
    c.audit('request_withdrawn', `#${id}`);
    return { ok: true };
  });
}
