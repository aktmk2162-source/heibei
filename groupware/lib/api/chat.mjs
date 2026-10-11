// チャット（1対1・グループ）。画面側が数秒おきに新着を取得する方式。
import { tx } from '../db.mjs';
import { fail } from '../http.mjs';
import { ids, int, str } from '../validate.mjs';

const PAGE = 100;

export function chatUnreadCount(db, userId) {
  return db
    .prepare(
      `SELECT COUNT(*) n FROM chat_messages m JOIN chat_members cm ON cm.room_id = m.room_id AND cm.user_id = ?
        WHERE m.id > cm.last_read_id AND (m.user_id IS NULL OR m.user_id != ?)`,
    )
    .get(userId, userId).n;
}

function membership(db, roomId, userId) {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId);
  const member = room && db.prepare('SELECT * FROM chat_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
  if (!member) fail(404, 'トークルームが見つかりません');
  return room;
}

function roomMembers(db, roomId) {
  return db
    .prepare(
      `SELECT u.id, u.name FROM chat_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.room_id = ? ORDER BY u.name`,
    )
    .all(roomId);
}

function activeUsers(db, userIds) {
  for (const id of userIds) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) fail(400, 'メンバーに無効なユーザーが含まれています');
  }
}

const MSG_SQL = `SELECT m.id, m.user_id, m.body, m.created_at, u.name user_name
                   FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id`;

export function register(r) {
  r.add('GET', '/api/chat/rooms', (c) =>
    c.db
      .prepare(
        `SELECT r.id, r.name, r.is_direct,
                (SELECT u.name FROM chat_members o JOIN users u ON u.id = o.user_id
                  WHERE o.room_id = r.id AND o.user_id != ? LIMIT 1) other_name,
                (SELECT COUNT(*) FROM chat_members o WHERE o.room_id = r.id) member_count,
                lm.body last_body, lm.created_at last_at, COALESCE(lm.id, 0) last_id,
                (SELECT COUNT(*) FROM chat_messages m WHERE m.room_id = r.id AND m.id > cm.last_read_id
                    AND (m.user_id IS NULL OR m.user_id != ?)) unread
           FROM chat_rooms r
           JOIN chat_members cm ON cm.room_id = r.id AND cm.user_id = ?
           LEFT JOIN chat_messages lm ON lm.id = (SELECT MAX(id) FROM chat_messages WHERE room_id = r.id)
          ORDER BY COALESCE(lm.id, 0) DESC, r.id DESC`,
      )
      .all(c.user.id, c.user.id, c.user.id)
      .map((x) => ({
        id: x.id,
        is_direct: !!x.is_direct,
        name: x.is_direct ? x.other_name || '（退職者等）' : x.name,
        member_count: x.member_count,
        last_body: x.last_body,
        last_at: x.last_at,
        unread: x.unread,
      })),
  );

  // グループを作る（作成者は自動で参加）
  r.add('POST', '/api/chat/rooms', (c) => {
    const name = str(c.body.name, 'ルーム名', { required: true, max: 50 });
    const members = [...new Set([c.user.id, ...ids(c.body.member_ids, 'メンバー')])];
    activeUsers(c.db, members);
    const id = tx(c.db, () => {
      const rid = Number(c.db.prepare('INSERT INTO chat_rooms (name, created_by) VALUES (?, ?)').run(name, c.user.id).lastInsertRowid);
      const ins = c.db.prepare('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?)');
      for (const uid of members) ins.run(rid, uid);
      return rid;
    });
    return { id };
  });

  // 1対1のトークを開く（なければ作る）
  r.add('POST', '/api/chat/direct', (c) => {
    const other = int(c.body.user_id, '相手', { required: true, min: 1 });
    if (other === c.user.id) fail(400, '自分とのトークは作れません');
    activeUsers(c.db, [other]);
    const key = [c.user.id, other].sort((a, b) => a - b).join('-');
    const found = c.db.prepare('SELECT id FROM chat_rooms WHERE direct_key = ?').get(key);
    if (found) {
      // 退出済みだった場合は参加し直す
      c.db.prepare('INSERT OR IGNORE INTO chat_members (room_id, user_id) VALUES (?, ?)').run(found.id, c.user.id);
      c.db.prepare('INSERT OR IGNORE INTO chat_members (room_id, user_id) VALUES (?, ?)').run(found.id, other);
      return { id: found.id };
    }
    const id = tx(c.db, () => {
      const rid = Number(c.db.prepare('INSERT INTO chat_rooms (is_direct, direct_key, created_by) VALUES (1, ?, ?)').run(key, c.user.id).lastInsertRowid);
      c.db.prepare('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?), (?, ?)').run(rid, c.user.id, rid, other);
      return rid;
    });
    return { id };
  });

  r.add('GET', '/api/chat/rooms/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const room = membership(c.db, id, c.user.id);
    const members = roomMembers(c.db, id);
    return {
      id,
      is_direct: !!room.is_direct,
      name: room.is_direct ? members.find((m) => m.id !== c.user.id)?.name || '（退職者等）' : room.name,
      members,
    };
  });

  // グループ名・メンバーの変更（メンバーなら誰でも可）
  r.add('PUT', '/api/chat/rooms/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const room = membership(c.db, id, c.user.id);
    if (room.is_direct) fail(400, '1対1のトークは変更できません');
    const name = str(c.body.name, 'ルーム名', { required: true, max: 50 });
    const members = [...new Set([c.user.id, ...ids(c.body.member_ids, 'メンバー')])];
    activeUsers(c.db, members);
    tx(c.db, () => {
      c.db.prepare('UPDATE chat_rooms SET name = ? WHERE id = ?').run(name, id);
      const ph = members.map(() => '?').join(',');
      c.db.prepare(`DELETE FROM chat_members WHERE room_id = ? AND user_id NOT IN (${ph})`).run(id, ...members);
      const ins = c.db.prepare('INSERT OR IGNORE INTO chat_members (room_id, user_id) VALUES (?, ?)');
      for (const uid of members) ins.run(id, uid);
    });
    return { ok: true };
  });

  r.add('POST', '/api/chat/rooms/:id/leave', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    membership(c.db, id, c.user.id);
    c.db.prepare('DELETE FROM chat_members WHERE room_id = ? AND user_id = ?').run(id, c.user.id);
    // 誰もいなくなったグループは削除
    if (!c.db.prepare('SELECT 1 FROM chat_members WHERE room_id = ?').get(id)) c.db.prepare('DELETE FROM chat_rooms WHERE id = ?').run(id);
    return { ok: true };
  });

  // after=ID で新着のみ、before=ID で過去分を取得。取得した分は既読にする。
  r.add('GET', '/api/chat/rooms/:id/messages', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    membership(c.db, id, c.user.id);
    const after = int(c.query.get('after'), 'after', { min: 0 });
    const before = int(c.query.get('before'), 'before', { min: 1 });
    let rows;
    if (after !== null) {
      rows = c.db.prepare(`${MSG_SQL} WHERE m.room_id = ? AND m.id > ? ORDER BY m.id LIMIT ${PAGE}`).all(id, after);
    } else {
      rows = c.db
        .prepare(`${MSG_SQL} WHERE m.room_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ${PAGE}`)
        .all(id, before ?? Number.MAX_SAFE_INTEGER)
        .reverse();
    }
    const maxId = rows.length ? rows[rows.length - 1].id : 0;
    if (maxId) {
      c.db
        .prepare('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE room_id = ? AND user_id = ?')
        .run(maxId, id, c.user.id);
    }
    return { messages: rows, has_more: after === null && rows.length === PAGE };
  });

  r.add('POST', '/api/chat/rooms/:id/messages', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    membership(c.db, id, c.user.id);
    const body = str(c.body.body, 'メッセージ', { required: true, max: 5000 });
    const { lastInsertRowid } = c.db
      .prepare('INSERT INTO chat_messages (room_id, user_id, body) VALUES (?, ?, ?)')
      .run(id, c.user.id, body);
    const mid = Number(lastInsertRowid);
    c.db.prepare('UPDATE chat_members SET last_read_id = ? WHERE room_id = ? AND user_id = ?').run(mid, id, c.user.id);
    return { id: mid };
  });

  r.add('DELETE', '/api/chat/messages/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const m = c.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
    if (!m || m.user_id !== c.user.id) fail(404, 'メッセージが見つかりません');
    c.db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
    return { ok: true };
  });
}
