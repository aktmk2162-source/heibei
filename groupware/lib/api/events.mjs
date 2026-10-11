// スケジュール・施設予約。
import { randomUUID } from 'node:crypto';
import { tx } from '../db.mjs';
import { fail } from '../http.mjs';
import {
  addDays,
  addMonths,
  bool,
  date,
  datetime,
  daysBetween,
  ids,
  int,
  parseCsv,
  str,
  toCsv,
  weekday,
} from '../validate.mjs';

const MAX_OCCURRENCES = 366;
const MAX_RANGE_DAYS = 62;

function loadRelations(db, eventIds) {
  const parts = new Map();
  const facs = new Map();
  if (!eventIds.length) return { parts, facs };
  const placeholders = eventIds.map(() => '?').join(',');
  for (const row of db.prepare(`SELECT event_id, user_id FROM event_participants WHERE event_id IN (${placeholders})`).all(...eventIds)) {
    if (!parts.has(row.event_id)) parts.set(row.event_id, []);
    parts.get(row.event_id).push(row.user_id);
  }
  for (const row of db.prepare(`SELECT event_id, facility_id FROM event_facilities WHERE event_id IN (${placeholders})`).all(...eventIds)) {
    if (!facs.has(row.event_id)) facs.set(row.event_id, []);
    facs.get(row.event_id).push(row.facility_id);
  }
  return { parts, facs };
}

// 閲覧者に応じて非公開予定を「予定あり」に置き換える。
function present(ev, participants, facilities, user) {
  const involved = ev.created_by === user.id || participants.includes(user.id);
  const masked = ev.visibility === 'private' && !involved;
  return {
    id: ev.id,
    series_id: ev.series_id,
    title: masked ? '予定あり' : ev.title,
    start_at: ev.start_at,
    end_at: ev.end_at,
    all_day: !!ev.all_day,
    location: masked ? '' : ev.location,
    memo: masked ? '' : ev.memo,
    visibility: ev.visibility,
    created_by: ev.created_by,
    updated_at: ev.updated_at,
    participant_ids: participants,
    facility_ids: facilities,
    masked,
    can_edit: !masked && (involved || user.role === 'admin'),
  };
}

function fetchEvent(db, id, user) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) fail(404, '予定が見つかりません');
  const { parts, facs } = loadRelations(db, [id]);
  return present(ev, parts.get(id) || [], facs.get(id) || [], user);
}

function eventFields(c) {
  const allDay = bool(c.body.all_day);
  let start, end;
  if (allDay) {
    const sd = date(String(c.body.start_at ?? '').slice(0, 10), '開始日', { required: true });
    const ed = date(String(c.body.end_at ?? c.body.start_at ?? '').slice(0, 10), '終了日', { required: true });
    start = `${sd} 00:00`;
    end = `${ed} 24:00`;
  } else {
    start = datetime(c.body.start_at, '開始日時');
    end = datetime(c.body.end_at, '終了日時');
  }
  if (end <= start) fail(400, '終了日時は開始日時より後にしてください');
  if (daysBetween(start.slice(0, 10), end.slice(0, 10)) > 31) fail(400, '1件の予定は31日以内にしてください');
  const visibility = c.body.visibility === 'private' ? 'private' : 'public';
  const participantIds = ids(c.body.participant_ids, '参加者');
  const facilityIds = ids(c.body.facility_ids, '施設');
  if (!participantIds.length && !facilityIds.length) fail(400, '参加者または施設を1つ以上指定してください');
  for (const uid of participantIds) {
    if (!c.db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(uid)) fail(400, '参加者に無効なユーザーが含まれています');
  }
  for (const fid of facilityIds) {
    if (!c.db.prepare('SELECT 1 FROM facilities WHERE id = ? AND active = 1').get(fid)) fail(400, '利用できない施設が含まれています');
  }
  return {
    title: str(c.body.title, '件名', { required: true, max: 100 }),
    start_at: start,
    end_at: end,
    all_day: allDay ? 1 : 0,
    location: str(c.body.location, '場所', { max: 100 }),
    memo: str(c.body.memo, 'メモ', { max: 5000 }),
    visibility,
    participantIds,
    facilityIds,
  };
}

// 繰り返し設定から各回の [開始, 終了] を作る。
function occurrences(f, repeat) {
  if (!repeat || !repeat.freq || repeat.freq === 'none') return [[f.start_at, f.end_at]];
  const freq = repeat.freq;
  if (!['daily', 'weekdays', 'weekly', 'monthly'].includes(freq)) fail(400, '繰り返しの指定が正しくありません');
  const until = date(repeat.until, '繰り返しの終了日', { required: true });
  const sd = f.start_at.slice(0, 10);
  if (until < sd) fail(400, '繰り返しの終了日は開始日以降にしてください');
  const spanDays = daysBetween(sd, f.end_at.slice(0, 10));
  const sTime = f.start_at.slice(11);
  const eTime = f.end_at.slice(11);
  const out = [];
  for (let i = 0; ; i++) {
    let d;
    if (freq === 'daily' || freq === 'weekdays') d = addDays(sd, i);
    else if (freq === 'weekly') d = addDays(sd, i * 7);
    else {
      d = addMonths(sd, i);
      if (d === null) continue;
    }
    if (d > until) break;
    if (freq === 'weekdays' && [0, 6].includes(weekday(d))) continue;
    out.push([`${d} ${sTime}`, `${addDays(d, spanDays)} ${eTime}`]);
    if (out.length > MAX_OCCURRENCES) fail(400, `繰り返しは${MAX_OCCURRENCES}回以内にしてください`);
    if (i > 5000) break;
  }
  if (!out.length) fail(400, '繰り返し条件に該当する日がありません');
  return out;
}

function facilityConflicts(db, facilityIds, start, end, exceptIds = []) {
  if (!facilityIds.length) return [];
  const fph = facilityIds.map(() => '?').join(',');
  const eph = exceptIds.length ? `AND e.id NOT IN (${exceptIds.map(() => '?').join(',')})` : '';
  return db
    .prepare(
      `SELECT f.name facility, e.start_at, e.end_at
         FROM event_facilities ef
         JOIN events e ON e.id = ef.event_id
         JOIN facilities f ON f.id = ef.facility_id
        WHERE ef.facility_id IN (${fph}) AND e.start_at < ? AND e.end_at > ? ${eph}
        LIMIT 5`,
    )
    .all(...facilityIds, end, start, ...exceptIds);
}

function assertNoConflict(db, f, ranges, exceptIds) {
  for (const [s, e] of ranges) {
    const hits = facilityConflicts(db, f.facilityIds, s, e, exceptIds);
    if (hits.length) {
      const h = hits[0];
      fail(409, `${h.facility} は ${h.start_at.replace('24:00', '終日')}〜${h.end_at.slice(11).replace('24:00', '終日')} に予約済みです（${s.slice(0, 10)}）`);
    }
  }
}

function insertEvent(db, f, start, end, seriesId, userId) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO events (series_id, title, start_at, end_at, all_day, location, memo, visibility, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(seriesId, f.title, start, end, f.all_day, f.location, f.memo, f.visibility, userId);
  const id = Number(lastInsertRowid);
  const ip = db.prepare('INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)');
  for (const uid of f.participantIds) ip.run(id, uid);
  const ifc = db.prepare('INSERT INTO event_facilities (event_id, facility_id) VALUES (?, ?)');
  for (const fid of f.facilityIds) ifc.run(id, fid);
  return id;
}

function assertCanEdit(db, id, user) {
  const ev = fetchEvent(db, id, user);
  if (!ev.can_edit) fail(403, 'この予定を変更する権限がありません');
  return ev;
}

export function register(r) {
  // 期間内の予定。users / facilities（カンマ区切りID）で絞り込む。
  r.add('GET', '/api/events', (c) => {
    const from = date(c.query.get('from'), '開始日', { required: true });
    const to = date(c.query.get('to'), '終了日', { required: true });
    if (to < from || daysBetween(from, to) > MAX_RANGE_DAYS) fail(400, `期間は${MAX_RANGE_DAYS}日以内で指定してください`);
    const parseList = (k) =>
      (c.query.get(k) || '')
        .split(',')
        .filter(Boolean)
        .map((v) => int(v, k, { required: true, min: 1 }))
        .slice(0, 500);
    const userIds = parseList('users');
    const facilityIds = parseList('facilities');
    if (!userIds.length && !facilityIds.length) return [];
    const conds = [];
    const args = [`${addDays(to, 1)} 00:00`, `${from} 00:00`];
    if (userIds.length) {
      conds.push(`e.id IN (SELECT event_id FROM event_participants WHERE user_id IN (${userIds.map(() => '?').join(',')}))`);
      args.push(...userIds);
    }
    if (facilityIds.length) {
      conds.push(`e.id IN (SELECT event_id FROM event_facilities WHERE facility_id IN (${facilityIds.map(() => '?').join(',')}))`);
      args.push(...facilityIds);
    }
    const rows = c.db
      .prepare(`SELECT e.* FROM events e WHERE e.start_at < ? AND e.end_at > ? AND (${conds.join(' OR ')}) ORDER BY e.all_day DESC, e.start_at`)
      .all(...args);
    const { parts, facs } = loadRelations(c.db, rows.map((e) => e.id));
    return rows.map((e) => present(e, parts.get(e.id) || [], facs.get(e.id) || [], c.user));
  });

  r.add('GET', '/api/events/:id', (c) => fetchEvent(c.db, int(c.params.id, 'ID', { required: true }), c.user));

  r.add('POST', '/api/events', (c) => {
    const f = eventFields(c);
    const ranges = occurrences(f, c.body.repeat);
    const seriesId = ranges.length > 1 ? randomUUID() : null;
    const created = tx(c.db, () => {
      assertNoConflict(c.db, f, ranges, []);
      return ranges.map(([s, e]) => insertEvent(c.db, f, s, e, seriesId, c.user.id));
    });
    return { id: created[0], ids: created };
  });

  r.add('PUT', '/api/events/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    assertCanEdit(c.db, id, c.user);
    const f = eventFields(c);
    tx(c.db, () => {
      assertNoConflict(c.db, f, [[f.start_at, f.end_at]], [id]);
      c.db
        .prepare(
          `UPDATE events SET title = ?, start_at = ?, end_at = ?, all_day = ?, location = ?, memo = ?, visibility = ?,
                  updated_at = datetime('now','localtime')
            WHERE id = ?`,
        )
        .run(f.title, f.start_at, f.end_at, f.all_day, f.location, f.memo, f.visibility, id);
      c.db.prepare('DELETE FROM event_participants WHERE event_id = ?').run(id);
      c.db.prepare('DELETE FROM event_facilities WHERE event_id = ?').run(id);
      const ip = c.db.prepare('INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)');
      for (const uid of f.participantIds) ip.run(id, uid);
      const ifc = c.db.prepare('INSERT INTO event_facilities (event_id, facility_id) VALUES (?, ?)');
      for (const fid of f.facilityIds) ifc.run(id, fid);
    });
    return { ok: true };
  });

  // scope=following で、繰り返し予定のこの回以降をまとめて削除する。
  r.add('DELETE', '/api/events/:id', (c) => {
    const id = int(c.params.id, 'ID', { required: true });
    const ev = assertCanEdit(c.db, id, c.user);
    if (c.query.get('scope') === 'following' && ev.series_id) {
      const { changes } = c.db.prepare('DELETE FROM events WHERE series_id = ? AND start_at >= ?').run(ev.series_id, ev.start_at);
      return { deleted: Number(changes) };
    }
    c.db.prepare('DELETE FROM events WHERE id = ?').run(id);
    return { deleted: 1 };
  });

  // ---- 管理: 移行用 CSV 入出力 ----
  // 列: 件名,開始日時,終了日時,終日(1/0),参加者ログインID(;区切り),施設名(;区切り),場所,メモ,非公開(1/0)
  r.add(
    'POST',
    '/api/admin/events/import',
    (c) => {
      const rows = parseCsv(str(c.body.csv, 'CSV', { required: true, max: 5_000_000 }));
      if (rows[0] && /件名|title/i.test(rows[0][0])) rows.shift();
      if (!rows.length) fail(400, 'CSV にデータ行がありません');
      if (rows.length > 20000) fail(400, '一度に取り込めるのは20000件までです');
      let imported = 0;
      const skipped = [];
      tx(c.db, () => {
        rows.forEach((row, i) => {
          const line = i + 1;
          const [title, start, end, allDay, logins = '', facNames = '', location = '', memo = '', priv = ''] = row.map((s) => s.trim());
          try {
            const participant_ids = logins
              .split(/[;；]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((l) => {
                const u = c.db.prepare('SELECT id FROM users WHERE login_id = ?').get(l);
                if (!u) fail(400, `ログインID「${l}」が見つかりません`);
                return u.id;
              });
            const facility_ids = facNames
              .split(/[;；]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((n) => {
                const f = c.db.prepare('SELECT id FROM facilities WHERE name = ?').get(n);
                if (!f) fail(400, `施設「${n}」が見つかりません`);
                return f.id;
              });
            const norm = (s) => (s || '').replace(/\//g, '-').replace(/^(\d{4})-(\d{1,2})-(\d{1,2})/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`).replace(/ (\d):/, ' 0$1:');
            const f = eventFields({
              db: c.db,
              body: { title, start_at: norm(start), end_at: norm(end), all_day: allDay === '1', location, memo, visibility: priv === '1' ? 'private' : 'public', participant_ids, facility_ids },
            });
            insertEvent(c.db, f, f.start_at, f.end_at, null, c.user.id);
            imported++;
          } catch (err) {
            if (!err.status) throw err;
            skipped.push({ line, reason: err.message });
          }
        });
      });
      c.audit('events_imported', `${imported}件`);
      return { imported, skipped };
    },
    { admin: true },
  );

  r.add(
    'GET',
    '/api/admin/events/export',
    (c) => {
      const from = date(c.query.get('from'), '開始日', { required: true });
      const to = date(c.query.get('to'), '終了日', { required: true });
      const rows = c.db.prepare('SELECT * FROM events WHERE start_at < ? AND end_at > ? ORDER BY start_at').all(`${addDays(to, 1)} 00:00`, `${from} 00:00`);
      const out = [['件名', '開始日時', '終了日時', '終日', '参加者', '施設', '場所', 'メモ', '非公開']];
      const pl = c.db.prepare('SELECT u.login_id FROM event_participants p JOIN users u ON u.id = p.user_id WHERE p.event_id = ?');
      const fl = c.db.prepare('SELECT f.name FROM event_facilities ef JOIN facilities f ON f.id = ef.facility_id WHERE ef.event_id = ?');
      for (const e of rows) {
        out.push([
          e.title,
          e.start_at,
          e.end_at,
          e.all_day ? 1 : 0,
          pl.all(e.id).map((x) => x.login_id).join(';'),
          fl.all(e.id).map((x) => x.name).join(';'),
          e.location,
          e.memo,
          e.visibility === 'private' ? 1 : 0,
        ]);
      }
      return { raw: toCsv(out), type: 'text/csv; charset=utf-8', filename: `schedule_${from}_${to}.csv` };
    },
    { admin: true },
  );
}
