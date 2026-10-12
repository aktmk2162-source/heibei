// 承認待ちの督促。一定日数処理されない申請を、現在の承認者へ再通知する。
// 夜間・休日に通知が鳴らないよう、平日の業務時間内だけ送る。

const DEFAULTS = { enabled: 1, after_days: 2, repeat_days: 1, start_hour: 9, end_hour: 18 };
export const MANUAL_INTERVAL_HOURS = 12;

const p2 = (n) => String(n).padStart(2, '0');
export const fmtLocal = (d) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const parseLocal = (s) => {
  const [y, m, d, hh = 0, mm = 0, ss = 0] = s.split(/[- :]/).map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
};

export function reminderSettings(db) {
  const out = { ...DEFAULTS };
  for (const { key, value } of db.prepare("SELECT key, value FROM settings WHERE key LIKE 'remind_%'").all()) {
    const k = key.slice('remind_'.length);
    if (k in out) out[k] = Number(value);
  }
  return out;
}

export function saveReminderSettings(db, s) {
  const up = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const k of Object.keys(DEFAULTS)) up.run(`remind_${k}`, String(s[k]));
}

// 土日を除いた経過日数（端数は切り捨て）
export function businessDaysBetween(from, to) {
  let days = 0;
  const d = new Date(from);
  for (;;) {
    d.setDate(d.getDate() + 1);
    if (d > to) break;
    if (d.getDay() !== 0 && d.getDay() !== 6) days++;
  }
  return days;
}

function withinBusinessHours(now, s) {
  const wd = now.getDay();
  return wd !== 0 && wd !== 6 && now.getHours() >= s.start_hour && now.getHours() < s.end_hour;
}

const PENDING_SQL = `
  SELECT r.id, r.type, r.title, r.applicant_id, a.name applicant_name, s.step_no, s.approver_id,
         COALESCE(s.arrived_at, r.updated_at) arrived_at, s.reminded_at, s.remind_count
    FROM requests r
    JOIN users a ON a.id = r.applicant_id
    JOIN request_steps s ON s.request_id = r.id AND s.step_no = r.current_step
   WHERE r.status = 'pending'`;

export function sendReminder(db, pusher, row, now, manual = false) {
  const days = businessDaysBetween(parseLocal(row.arrived_at), now);
  const waited = days >= 1 ? `${days}営業日` : '本日から';
  pusher?.notify(
    [row.approver_id],
    {
      title: manual ? '承認の催促' : '承認待ちの督促',
      body: `${row.applicant_name}さんの${row.type}「${row.title}」が${waited}承認待ちです`,
      url: `/#/workflow/${row.id}`,
      tag: `wf-${row.id}`,
    },
    'workflow',
  );
  db.prepare('UPDATE request_steps SET reminded_at = ?, remind_count = remind_count + 1 WHERE request_id = ? AND step_no = ?').run(
    fmtLocal(now),
    row.id,
    row.step_no,
  );
}

// 定期実行の本体。送った件数を返す。
export function runReminders(db, pusher, now = new Date()) {
  const s = reminderSettings(db);
  if (!s.enabled || !withinBusinessHours(now, s)) return 0;
  let sent = 0;
  for (const row of db.prepare(PENDING_SQL).all()) {
    if (businessDaysBetween(parseLocal(row.arrived_at), now) < s.after_days) continue;
    if (row.reminded_at && businessDaysBetween(parseLocal(row.reminded_at), now) < s.repeat_days) continue;
    sendReminder(db, pusher, row, now);
    sent++;
  }
  return sent;
}

export function pendingRow(db, requestId) {
  return db.prepare(`${PENDING_SQL} AND r.id = ?`).get(requestId);
}

export { parseLocal };
