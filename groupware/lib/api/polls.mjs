// 日程調整。候補日時に ○△× で回答してもらい、決定するとスケジュールに自動登録する。
import { tx } from '../db.mjs';
import { fail } from '../http.mjs';
import { datetime, ids, int, str } from '../validate.mjs';
import { assertNoConflict, insertEvent } from './events.mjs';

const ANSWERS = ['yes', 'maybe', 'no'];
const MAX_SLOTS = 30;

export function unansweredPollCount(db, userId) {
  return db
    .prepare(
      `SELECT COUNT(*) n FROM polls p JOIN poll_members pm ON pm.poll_id = p.id AND pm.user_id = ?
        WHERE p.status = 'open' AND pm.answered_at IS NULL AND (p.organizer_id IS NULL OR p.organizer_id != ?)`,
    )
    .get(userId, userId).n;
}

function loadPoll(db, id, user) {
  const p = db
    .prepare('SELECT p.*, u.name organizer_name FROM polls p LEFT JOIN users u ON u.id = p.organizer_id WHERE p.id = ?')
    .get(id);
  if (!p) fail(404, '日程調整が見つかりません');
  const isMember = !!db.prepare('SELECT 1 FROM poll_members WHERE poll_id = ? AND user_id = ?').get(id, user.id);
  if (!isMember && p.organizer_id !== user.id && user.role !== 'admin') fail(404, '日程調整が見つかりません');
  return { ...p, is_member: isMember, is_organizer: p.organizer_id === user.id };
}

export function register(r) {
  r.add('GET', '/api/polls', (c) =>
    c.db
      .prepare(
        `SELECT p.id, p.title, p.status, p.created_at, u.name organizer_name, p.organizer_id,
                (SELECT COUNT(*) FROM poll_members m WHERE m.poll_id = p.id) member_count,
                (SELECT COUNT(*) FROM poll_members m WHERE m.poll_id = p.id AND m.answered_at IS NOT NULL) answered_count,
                (SELECT answered_at IS NOT NULL FROM poll_members m WHERE m.poll_id = p.id AND m.user_id = ?) my_answered,
                (SELECT MIN(start_at) FROM poll_slots s WHERE s.poll_id = p.id) first_slot,
                (SELECT s.start_at FROM poll_slots s WHERE s.id = p.decided_slot_id) decided_at
           FROM polls p LEFT JOIN users u ON u.id = p.organizer_id
          WHERE p.organizer_id = ? OR p.id IN (SELECT poll_id FROM poll_members WHERE user_id = ?)
          ORDER BY p.status = 'open' DESC, p.id DESC LIMIT 300`,
      )
      .all(c.user.id, c.user.id, c.user.id)
      .map((p) => ({ ...p, my_answered: p.my_answered === null ? null : !!p.my_answered })),
  );

  r.add('GET', '/api/polls/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPoll(c.db, id, c.user);
    const slots = c.db.prepare('SELECT id, start_at, end_at FROM poll_slots WHERE poll_id = ? ORDER BY start_at, id').all(id);
    const members = c.db
      .prepare(
        `SELECT u.id, u.name, pm.comment, pm.answered_at FROM poll_members pm JOIN users u ON u.id = pm.user_id
          WHERE pm.poll_id = ? ORDER BY u.id = ? DESC, u.name`,
      )
      .all(id, p.organizer_id ?? 0);
    const answers = {};
    for (const a of c.db
      .prepare('SELECT a.slot_id, a.user_id, a.answer FROM poll_answers a JOIN poll_slots s ON s.id = a.slot_id WHERE s.poll_id = ?')
      .all(id)) {
      answers[`${a.slot_id}:${a.user_id}`] = a.answer;
    }
    // 各候補の時間帯に、各メンバーの既存の予定があるか（内容は見せず有無のみ）
    const busyStmt = c.db.prepare(
      `SELECT 1 FROM events e JOIN event_participants ep ON ep.event_id = e.id AND ep.user_id = ?
        WHERE e.start_at < ? AND e.end_at > ? AND e.id IS NOT ? LIMIT 1`,
    );
    const busy = {};
    for (const s of slots) {
      for (const m of members) {
        if (busyStmt.get(m.id, s.end_at, s.start_at, p.event_id)) busy[`${s.id}:${m.id}`] = true;
      }
    }
    return { ...p, slots, members, answers, busy };
  });

  r.add('POST', '/api/polls', (c) => {
    const title = str(c.body.title, '件名', { required: true, max: 100 });
    const memo = str(c.body.memo, 'メモ', { max: 5000 });
    const location = str(c.body.location, '場所', { max: 100 });
    if (!Array.isArray(c.body.slots) || !c.body.slots.length) fail(400, '候補日時を1つ以上指定してください');
    if (c.body.slots.length > MAX_SLOTS) fail(400, `候補日時は${MAX_SLOTS}件までです`);
    const slots = c.body.slots.map((s) => {
      const start = datetime(s?.start_at, '候補の開始日時');
      const end = datetime(s?.end_at, '候補の終了日時');
      if (end <= start) fail(400, '候補の終了日時は開始日時より後にしてください');
      return [start, end];
    });
    const members = [...new Set([c.user.id, ...ids(c.body.member_ids, '参加者')])];
    if (members.length < 2) fail(400, '自分以外の参加者を1人以上指定してください');
    for (const uid of members) {
      if (!c.db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(uid)) fail(400, '参加者に無効なユーザーが含まれています');
    }
    const id = tx(c.db, () => {
      const pid = Number(
        c.db.prepare('INSERT INTO polls (title, memo, location, organizer_id) VALUES (?, ?, ?, ?)').run(title, memo, location, c.user.id).lastInsertRowid,
      );
      const is = c.db.prepare('INSERT INTO poll_slots (poll_id, start_at, end_at) VALUES (?, ?, ?)');
      for (const [s, e] of slots) is.run(pid, s, e);
      const im = c.db.prepare('INSERT INTO poll_members (poll_id, user_id) VALUES (?, ?)');
      for (const uid of members) im.run(pid, uid);
      return pid;
    });
    return { id };
  });

  // 自分の回答を登録・更新する。answers は { 候補ID: 'yes' | 'maybe' | 'no' }
  r.add('PUT', '/api/polls/:id/answer', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPoll(c.db, id, c.user);
    if (!p.is_member) fail(403, '参加者のみ回答できます');
    if (p.status !== 'open') fail(409, 'この日程調整は締め切られています');
    const answers = c.body.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail(400, '回答の形式が正しくありません');
    const slotIds = new Set(c.db.prepare('SELECT id FROM poll_slots WHERE poll_id = ?').all(id).map((s) => s.id));
    const comment = str(c.body.comment, 'コメント', { max: 500 });
    tx(c.db, () => {
      const up = c.db.prepare(
        'INSERT INTO poll_answers (slot_id, user_id, answer) VALUES (?, ?, ?) ON CONFLICT(slot_id, user_id) DO UPDATE SET answer = excluded.answer',
      );
      for (const [k, v] of Object.entries(answers)) {
        const sid = Number(k);
        if (!slotIds.has(sid)) fail(400, '候補日時が見つかりません');
        if (!ANSWERS.includes(v)) fail(400, '回答は ○・△・× のいずれかにしてください');
        up.run(sid, c.user.id, v);
      }
      c.db
        .prepare(`UPDATE poll_members SET comment = ?, answered_at = datetime('now','localtime') WHERE poll_id = ? AND user_id = ?`)
        .run(comment, id, c.user.id);
    });
    return { ok: true };
  });

  // 主催者が日時を決定し、参加者全員の予定として登録する
  r.add('POST', '/api/polls/:id/decide', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPoll(c.db, id, c.user);
    if (!p.is_organizer) fail(403, '主催者のみ決定できます');
    if (p.status !== 'open') fail(409, 'この日程調整は既に決定・中止されています');
    const slotId = int(c.body.slot_id, '候補', { required: true });
    const slot = c.db.prepare('SELECT * FROM poll_slots WHERE id = ? AND poll_id = ?').get(slotId, id);
    if (!slot) fail(400, '候補日時が見つかりません');
    const facilityIds = ids(c.body.facility_ids, '施設');
    for (const fid of facilityIds) {
      if (!c.db.prepare('SELECT 1 FROM facilities WHERE id = ? AND active = 1').get(fid)) fail(400, '利用できない施設が含まれています');
    }
    const participantIds = c.db.prepare('SELECT user_id FROM poll_members WHERE poll_id = ?').all(id).map((m) => m.user_id);
    const f = {
      title: p.title,
      all_day: 0,
      location: p.location,
      memo: p.memo,
      visibility: 'public',
      participantIds,
      facilityIds,
    };
    const eventId = tx(c.db, () => {
      assertNoConflict(c.db, f, [[slot.start_at, slot.end_at]], []);
      const eid = insertEvent(c.db, f, slot.start_at, slot.end_at, null, c.user.id);
      c.db.prepare(`UPDATE polls SET status = 'decided', decided_slot_id = ?, event_id = ? WHERE id = ?`).run(slotId, eid, id);
      return eid;
    });
    return { event_id: eventId };
  });

  r.add('POST', '/api/polls/:id/close', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPoll(c.db, id, c.user);
    if (!p.is_organizer) fail(403, '主催者のみ中止できます');
    if (p.status !== 'open') fail(409, 'この日程調整は既に決定・中止されています');
    c.db.prepare(`UPDATE polls SET status = 'closed' WHERE id = ?`).run(id);
    return { ok: true };
  });

  r.add('DELETE', '/api/polls/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const p = loadPoll(c.db, id, c.user);
    if (!p.is_organizer && c.user.role !== 'admin') fail(403, '主催者のみ削除できます');
    c.db.prepare('DELETE FROM polls WHERE id = ?').run(id);
    return { ok: true };
  });
}
