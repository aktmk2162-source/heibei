// チャット（1対1・グループ）。画面側が数秒おきに新着を取得する方式。
import { stat } from 'node:fs/promises';
import { tx } from '../db.mjs';
import { DOCUMENT_EXT, IMAGE_TYPES, cleanFilename, ext } from '../files.mjs';
import { fail } from '../http.mjs';
import { ids, int, str } from '../validate.mjs';

const PAGE = 100;
const ATTACH_EXT = new Set([...DOCUMENT_EXT, ...Object.keys(IMAGE_TYPES), 'heic']);

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

const MSG_SQL = `SELECT m.id, m.user_id, m.body, m.created_at, u.name user_name,
                          f.id file_id, f.original_name file_name, f.size file_size
                   FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
                   LEFT JOIN chat_files f ON f.message_id = m.id`;

function messageOut(m) {
  const { file_id, file_name, file_size, ...rest } = m;
  return {
    ...rest,
    file: file_id ? { id: file_id, name: file_name, size: file_size, is_image: !!IMAGE_TYPES[ext(file_name)] } : null,
  };
}

async function removeRoomFiles(db, store, roomId) {
  const files = db
    .prepare('SELECT f.stored_name FROM chat_files f JOIN chat_messages m ON m.id = f.message_id WHERE m.room_id = ?')
    .all(roomId);
  return () => Promise.all(files.map((f) => store.remove(f.stored_name)));
}

export function register(r, { store, pusher } = {}) {
  // 送信者と通知オフの人を除くメンバーへプッシュ通知する（応答は待たない）
  function notify(db, roomId, sender, text) {
    if (!pusher) return;
    const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId);
    const to = db
      .prepare(
        `SELECT cm.user_id FROM chat_members cm JOIN users u ON u.id = cm.user_id
          WHERE cm.room_id = ? AND cm.user_id != ? AND cm.muted = 0 AND u.active = 1`,
      )
      .all(roomId, sender.id)
      .map((x) => x.user_id);
    const body = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    pusher
      .sendToUsers(to, {
        title: room.is_direct ? sender.name : `${room.name}（${sender.name}）`,
        body,
        url: `/#/chat/${roomId}`,
        tag: `chat-${roomId}`,
      })
      .catch(() => {});
  }

  r.add('GET', '/api/chat/rooms', (c) =>
    c.db
      .prepare(
        `SELECT r.id, r.name, r.is_direct,
                (SELECT u.name FROM chat_members o JOIN users u ON u.id = o.user_id
                  WHERE o.room_id = r.id AND o.user_id != ? LIMIT 1) other_name,
                (SELECT COUNT(*) FROM chat_members o WHERE o.room_id = r.id) member_count, cm.muted,
                CASE WHEN lm.body = '' AND lf.id IS NOT NULL THEN '📎 ' || lf.original_name ELSE lm.body END last_body,
                lm.created_at last_at, COALESCE(lm.id, 0) last_id,
                (SELECT COUNT(*) FROM chat_messages m WHERE m.room_id = r.id AND m.id > cm.last_read_id
                    AND (m.user_id IS NULL OR m.user_id != ?)) unread
           FROM chat_rooms r
           JOIN chat_members cm ON cm.room_id = r.id AND cm.user_id = ?
           LEFT JOIN chat_messages lm ON lm.id = (SELECT MAX(id) FROM chat_messages WHERE room_id = r.id)
           LEFT JOIN chat_files lf ON lf.message_id = lm.id
          ORDER BY COALESCE(lm.id, 0) DESC, r.id DESC`,
      )
      .all(c.user.id, c.user.id, c.user.id)
      .map((x) => ({
        id: x.id,
        is_direct: !!x.is_direct,
        name: x.is_direct ? x.other_name || '（退職者等）' : x.name,
        member_count: x.member_count,
        muted: !!x.muted,
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
    const { muted } = c.db.prepare('SELECT muted FROM chat_members WHERE room_id = ? AND user_id = ?').get(id, c.user.id);
    return {
      id,
      muted: !!muted,
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

  r.add('PUT', '/api/chat/rooms/:id/mute', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    membership(c.db, id, c.user.id);
    c.db.prepare('UPDATE chat_members SET muted = ? WHERE room_id = ? AND user_id = ?').run(c.body.muted ? 1 : 0, id, c.user.id);
    return { muted: !!c.body.muted };
  });

  r.add('POST', '/api/chat/rooms/:id/leave', async (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    membership(c.db, id, c.user.id);
    c.db.prepare('DELETE FROM chat_members WHERE room_id = ? AND user_id = ?').run(id, c.user.id);
    // 誰もいなくなったグループは添付ファイルごと削除
    if (!c.db.prepare('SELECT 1 FROM chat_members WHERE room_id = ?').get(id)) {
      const cleanup = await removeRoomFiles(c.db, store, id);
      c.db.prepare('DELETE FROM chat_rooms WHERE id = ?').run(id);
      await cleanup();
    }
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
      rows = c.db.prepare(`${MSG_SQL} WHERE m.room_id = ? AND m.id > ? ORDER BY m.id LIMIT ${PAGE}`).all(id, after).map(messageOut);
    } else {
      rows = c.db
        .prepare(`${MSG_SQL} WHERE m.room_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ${PAGE}`)
        .all(id, before ?? Number.MAX_SAFE_INTEGER)
        .reverse()
        .map(messageOut);
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
    notify(c.db, id, c.user, body);
    return { id: mid };
  });

  // ファイル添付（1ファイル＝1メッセージ）。?name=ファイル名&body=ひとこと
  r.add(
    'POST',
    '/api/chat/rooms/:id/files',
    async (c) => {
      const id = int(c.params.id, 'ID', { required: true });
      membership(c.db, id, c.user.id);
      const name = cleanFilename(c.query.get('name'), ATTACH_EXT);
      const body = str(c.query.get('body'), 'メッセージ', { max: 2000 });
      const saved = await store.receive(c.req);
      let mid;
      try {
        mid = tx(c.db, () => {
          const m = Number(c.db.prepare('INSERT INTO chat_messages (room_id, user_id, body) VALUES (?, ?, ?)').run(id, c.user.id, body).lastInsertRowid);
          c.db
            .prepare('INSERT INTO chat_files (message_id, original_name, stored_name, size) VALUES (?, ?, ?, ?)')
            .run(m, name, saved.stored, saved.size);
          c.db.prepare('UPDATE chat_members SET last_read_id = ? WHERE room_id = ? AND user_id = ?').run(m, id, c.user.id);
          return m;
        });
      } catch (err) {
        await store.remove(saved.stored);
        throw err;
      }
      notify(c.db, id, c.user, body ? `📎 ${name}\n${body}` : `📎 ${name}`);
      return { id: mid };
    },
    { raw: true },
  );

  // 添付の取得（メンバーのみ）。画像は画面内表示用にそのまま、それ以外はダウンロードとして返す。
  r.add('GET', '/api/chat/files/:id', async (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const f = c.db
      .prepare('SELECT f.*, m.room_id FROM chat_files f JOIN chat_messages m ON m.id = f.message_id WHERE f.id = ?')
      .get(id);
    if (!f) fail(404, 'ファイルが見つかりません');
    membership(c.db, f.room_id, c.user.id);
    const path = store.path(f.stored_name);
    try {
      await stat(path);
    } catch {
      fail(404, 'ファイル本体が見つかりません');
    }
    const imageType = IMAGE_TYPES[ext(f.original_name)];
    const inline = imageType && c.query.get('download') !== '1';
    return { file: path, size: f.size, filename: f.original_name, inlineType: inline ? imageType : null };
  });

  r.add('DELETE', '/api/chat/messages/:id', async (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const m = c.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
    if (!m || m.user_id !== c.user.id) fail(404, 'メッセージが見つかりません');
    const f = c.db.prepare('SELECT stored_name FROM chat_files WHERE message_id = ?').get(id);
    c.db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
    if (f) await store.remove(f.stored_name);
    return { ok: true };
  });
}
