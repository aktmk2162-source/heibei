// 社内グループウェア フロントエンド（依存ライブラリなし）。
// 画面は DOM API で組み立て、innerHTML は使わない（XSS 対策）。

// ================= 共通ユーティリティ =================
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    // CSP で style 属性は禁止しているため、CSSOM 経由で設定する
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
const $app = () => document.getElementById('app');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const today = () => ymd(new Date());
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const mondayOf = (s) => {
  const d = parseYmd(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};
const fmtDate = (s) => {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
};
const fmtDateTime = (s) => (s ? `${s.slice(0, 4)}/${s.slice(5, 7)}/${s.slice(8, 10)} ${s.slice(11, 16)}` : '');
const yen = (n) => (n === null || n === undefined ? '' : `${Number(n).toLocaleString('ja-JP')}円`);

function toast(msg, type = '') {
  const el = h('div', { class: type }, msg);
  document.getElementById('toast').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2500);
}

// ================= API =================
const state = { me: null, users: [], departments: [], facilities: [], types: [], counts: { approvals: 0, unread: 0 } };

class ApiError extends Error {
  constructor(status, data) {
    super(data.error || `エラー (${status})`);
    this.status = status;
    this.code = data.code;
  }
}

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && state.me?.csrf) headers['X-CSRF-Token'] = state.me.csrf;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : {};
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && path !== '/api/login') {
      state.me = null;
      renderLogin();
    } else if (err.code === 'must_change_password') {
      state.me.must_change_password = true;
      location.hash = '#/password';
    }
    throw err;
  }
  return data;
}

// 非同期処理のエラーをトーストで表示する
const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (e) {
    if (e.status !== 401) toast(e.message, 'error');
  }
};

async function loadMasters() {
  [state.users, state.departments, state.facilities, state.types] = await Promise.all([
    api('GET', '/api/users'),
    api('GET', '/api/departments'),
    api('GET', '/api/facilities'),
    api('GET', '/api/request-types'),
  ]);
}
const userName = (id) => state.users.find((u) => u.id === id)?.name ?? '（退職者等）';
const facilityName = (id) => state.facilities.find((f) => f.id === id)?.name ?? '（廃止施設）';

async function refreshCounts() {
  try {
    const d = await api('GET', `/api/dashboard?today=${today()}`);
    state.counts = { approvals: d.approvals, unread: d.unread.length };
    document.querySelectorAll('[data-badge]').forEach((el) => {
      const n = state.counts[el.dataset.badge];
      el.textContent = n || '';
      el.hidden = !n;
    });
  } catch {
    /* 件数表示の失敗は無視 */
  }
}

// ================= モーダル =================
function openModal(title, body, footer = []) {
  const root = document.getElementById('modal-root');
  const close = () => {
    root.replaceChildren();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  const backdrop = h(
    'div',
    { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && close() },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { class: 'link', 'aria-label': '閉じる', onclick: close }, '✕')),
      h('div', { class: 'body' }, body),
      footer.length ? h('footer', {}, footer) : null,
    ),
  );
  root.replaceChildren(backdrop);
  backdrop.querySelector('input, select, textarea')?.focus();
  return close;
}

function confirmDialog(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let close;
    const done = (v) => {
      close();
      resolve(v);
    };
    close = openModal('確認', h('p', { class: 'pre' }, message), [
      h('button', { onclick: () => done(false) }, 'キャンセル'),
      h('button', { class: danger ? 'danger' : 'primary', onclick: () => done(true) }, okLabel),
    ]);
  });
}

function showPassword(title, rows) {
  openModal(
    title,
    h('div', {},
      h('div', { class: 'alert info' }, 'この画面を閉じると初期パスワードは再表示できません。本人へ安全な方法で伝えてください。初回ログイン時に変更が求められます。'),
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, 'ログインID'), h('th', {}, '氏名'), h('th', {}, '初期パスワード'))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.login_id), h('td', {}, r.name), h('td', {}, h('code', { class: 'pw' }, r.initial_password))))),
      ),
    ),
  );
}

// 社員の複数選択（部署ごと・名前検索つき）
function userPicker(selected, { exclude = [] } = {}) {
  const sel = new Set(selected);
  const chips = h('div', { class: 'chips' });
  const list = h('div', { class: 'picker' });
  const search = h('input', { type: 'search', placeholder: '名前で絞り込み', style: 'width:100%;margin-bottom:6px' });
  const renderChips = () =>
    chips.replaceChildren(...(sel.size ? [...sel].map((id) => h('span', { class: 'chip' }, userName(id))) : [h('span', { class: 'muted small' }, '未選択')]));
  const renderList = () => {
    const q = search.value.trim();
    const groups = new Map();
    for (const u of state.users) {
      if (exclude.includes(u.id) || (q && !u.name.includes(q) && !u.login_id.includes(q))) continue;
      const g = u.department || '部署なし';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(u);
    }
    list.replaceChildren(
      ...[...groups].map(([g, us]) => [
        h('div', { class: 'grp' }, g),
        us.map((u) =>
          h('label', {},
            h('input', { type: 'checkbox', checked: sel.has(u.id), onchange: (e) => (e.target.checked ? sel.add(u.id) : sel.delete(u.id), renderChips()) }),
            u.name,
          ),
        ),
      ]).flat(2),
    );
  };
  search.addEventListener('input', renderList);
  renderChips();
  renderList();
  return { el: h('div', {}, chips, search, list), value: () => [...sel] };
}

// 承認者を順番に選ぶ（並び順＝承認順）
function approverPicker(initial) {
  const ids = [...initial];
  const box = h('div');
  const render = () => {
    const opts = state.users.filter((u) => u.id !== state.me.id);
    box.replaceChildren(
      ...ids.map((id, i) =>
        h('div', { class: 'row', style: 'margin-bottom:6px' },
          h('span', { class: 'muted', style: 'width:56px' }, `${i + 1}次承認`),
          h('select', { onchange: (e) => (ids[i] = Number(e.target.value)) },
            opts.map((u) => h('option', { value: u.id, selected: u.id === id }, `${u.name}${u.department ? `（${u.department}）` : ''}`)),
          ),
          h('button', { type: 'button', class: 'small', onclick: () => (ids.splice(i, 1), render()) }, '削除'),
        ),
      ),
      ids.length < 6 && opts.length
        ? h('button', { type: 'button', class: 'small', onclick: () => (ids.push(opts.find((u) => !ids.includes(u.id))?.id ?? opts[0].id), render()) }, '＋ 承認者を追加')
        : null,
    );
  };
  render();
  return { el: box, value: () => ids };
}

function field(label, input, required = false) {
  return h('label', { class: 'field' }, h('span', {}, label, required ? h('span', { class: 'req' }, '*') : null), input);
}

// ================= ログイン・パスワード変更 =================
function renderLogin(message) {
  document.getElementById('modal-root').replaceChildren();
  const err = h('div');
  const loginId = h('input', { type: 'text', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const form = h(
    'form',
    {
      class: 'card login',
      onsubmit: async (e) => {
        e.preventDefault();
        err.replaceChildren();
        try {
          state.me = await api('POST', '/api/login', { login_id: loginId.value, password: pw.value });
          await boot();
        } catch (ex) {
          err.replaceChildren(h('div', { class: 'alert error' }, ex.message));
        }
      },
    },
    h('h1', {}, '社内グループウェア'),
    message ? h('div', { class: 'alert info' }, message) : null,
    err,
    field('ログインID', loginId),
    field('パスワード', pw),
    h('button', { class: 'primary', type: 'submit', style: 'width:100%' }, 'ログイン'),
  );
  $app().replaceChildren(h('div', { class: 'login-wrap' }, form));
  loginId.focus();
}

function passwordForm(forced) {
  const err = h('div');
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const next2 = h('input', { type: 'password', autocomplete: 'new-password' });
  return h(
    'form',
    {
      class: 'card',
      style: 'max-width:480px',
      onsubmit: async (e) => {
        e.preventDefault();
        err.replaceChildren();
        if (next.value !== next2.value) return err.replaceChildren(h('div', { class: 'alert error' }, '確認用のパスワードが一致しません'));
        try {
          await api('POST', '/api/me/password', { current: cur.value, next: next.value });
          state.me.must_change_password = false;
          toast('パスワードを変更しました');
          if (forced) await boot();
          else e.target.reset();
        } catch (ex) {
          err.replaceChildren(h('div', { class: 'alert error' }, ex.message));
        }
      },
    },
    h('h2', {}, 'パスワード変更'),
    forced ? h('div', { class: 'alert info' }, '初期パスワードのため、新しいパスワードを設定してください。') : null,
    err,
    field(forced ? '初期パスワード' : '現在のパスワード', cur, true),
    field('新しいパスワード（10文字以上・英字と数字を含む）', next, true),
    field('新しいパスワード（確認）', next2, true),
    h('button', { class: 'primary', type: 'submit' }, '変更する'),
  );
}

// ================= 画面枠 =================
const NAV = [
  ['#/home', 'ホーム'],
  ['#/schedule', 'スケジュール'],
  ['#/facility', '施設予約'],
  ['#/workflow', 'ワークフロー', 'approvals'],
  ['#/board', '掲示板', 'unread'],
  ['#/todo', 'ToDo'],
  ['#/settings', '個人設定'],
];

function shell(content) {
  const path = location.hash.split('?')[0].split('/').slice(0, 2).join('/');
  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, '社内グループウェア'),
    h('nav', { class: 'nav' },
      [...NAV, ...(state.me.role === 'admin' ? [['#/admin', 'システム管理']] : [])].map(([href, label, badge]) =>
        h('a', { href, class: path === href ? 'active' : '', onclick: () => sidebar.classList.remove('open') },
          h('span', {}, label),
          badge ? h('span', { class: 'badge', 'data-badge': badge, hidden: !state.counts[badge] }, state.counts[badge] || '') : null,
        ),
      ),
    ),
    h('div', { class: 'me' },
      h('div', {}, state.me.name),
      h('div', { class: 'small', style: 'opacity:.7' }, state.me.login_id),
      h('button', { class: 'small', onclick: guard(async () => {
        await api('POST', '/api/logout');
        state.me = null;
        location.hash = '';
        renderLogin('ログアウトしました');
      }) }, 'ログアウト'),
    ),
  );
  const topbar = h('div', { class: 'topbar' }, h('button', { class: 'small', onclick: () => sidebar.classList.toggle('open') }, '☰ メニュー'), h('b', {}, '社内グループウェア'));
  $app().replaceChildren(h('div', { class: 'layout' }, sidebar, h('div', {}, topbar, h('main', { class: 'main' }, content))));
}

function query() {
  const q = location.hash.split('?')[1] || '';
  return new URLSearchParams(q);
}
function go(path, params) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  location.hash = `${path}${qs}`;
}

// ================= ホーム =================
async function pageHome() {
  const d = await api('GET', `/api/dashboard?today=${today()}`);
  state.counts = { approvals: d.approvals, unread: d.unread.length };
  const t = parseYmd(d.today);
  shell([
    h('h1', {}, `${t.getMonth() + 1}月${t.getDate()}日（${WD[t.getDay()]}）`),
    h('div', { class: 'stat' },
      h('a', { href: '#/workflow?box=todo' }, '承認待ち', h('b', {}, d.approvals)),
      h('a', { href: '#/workflow?box=mine' }, '自分の申請（処理中）', h('b', {}, d.my_pending)),
      h('a', { href: '#/board' }, '未読のお知らせ', h('b', {}, d.unread.length)),
      h('a', { href: '#/todo' }, '未完了の ToDo', h('b', {}, d.todos.length)),
    ),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, '今日の予定'), h('button', { class: 'small', onclick: () => openEventForm({ date: d.today }) }, '＋ 予定を登録')),
        d.events.length
          ? h('table', { class: 'list' }, h('tbody', {}, d.events.map((e) =>
              h('tr', { class: 'clickable', onclick: () => openEventDetail(e.id) },
                h('td', { style: 'width:120px;white-space:nowrap' }, timeLabel(e, d.today)),
                h('td', {}, e.title, e.location ? h('span', { class: 'muted small' }, ` @${e.location}`) : null),
              ))))
          : h('div', { class: 'empty' }, '今日の予定はありません'),
      ),
      h('div', { class: 'card' },
        h('h2', {}, '未読のお知らせ'),
        d.unread.length
          ? h('table', { class: 'list' }, h('tbody', {}, d.unread.map((p) =>
              h('tr', { class: 'clickable', onclick: () => go(`#/board/${p.id}`) },
                h('td', { class: 'unread' }, h('span', { class: 'dot' }), p.title),
                h('td', { class: 'muted small', style: 'white-space:nowrap' }, p.created_at.slice(5, 16).replace('-', '/')),
              ))))
          : h('div', { class: 'empty' }, '未読のお知らせはありません'),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'ToDo'),
        d.todos.length
          ? d.todos.map((t) => h('div', { class: 'todo-item' }, h('span', { class: 'title' }, t.title), dueLabel(t.due_date)))
          : h('div', { class: 'empty' }, '未完了の ToDo はありません'),
        h('a', { href: '#/todo' }, 'ToDo を開く →'),
      ),
    ),
  ]);
}

function timeLabel(e, day) {
  if (e.all_day) return '終日';
  const s = e.start_at.slice(0, 10) < day ? '…' : e.start_at.slice(11);
  const en = e.end_at.slice(0, 10) > day ? '…' : e.end_at.slice(11);
  return `${s}〜${en}`;
}
function dueLabel(due) {
  if (!due) return null;
  return h('span', { class: `small ${due < today() ? 'overdue' : 'muted'}` }, `期限 ${fmtDate(due)}`);
}

// ================= スケジュール（週表示） =================
function weekNav(path, params, start) {
  const set = (s) => go(path, { ...params, date: s });
  const end = addDays(start, 6);
  return [
    h('button', { onclick: () => set(addDays(start, -7)) }, '‹ 前週'),
    h('button', { onclick: () => set(mondayOf(today())) }, '今週'),
    h('button', { onclick: () => set(addDays(start, 7)) }, '翌週 ›'),
    h('input', { type: 'date', value: start, onchange: (e) => e.target.value && set(mondayOf(e.target.value)) }),
    h('span', { class: 'range' }, `${parseYmd(start).getFullYear()}年 ${fmtDate(start)} 〜 ${fmtDate(end)}`),
  ];
}

function weekGrid({ rows, days, events, rowKey, onCell }) {
  const t = today();
  const dayClass = (s) => {
    const w = parseYmd(s).getDay();
    return [w === 0 ? 'sun' : w === 6 ? 'sat' : '', s === t ? 'today' : ''].join(' ');
  };
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'week' },
      h('thead', {}, h('tr', {}, h('th', { class: 'rowhead' }, ''), days.map((s) => h('th', { class: dayClass(s) }, fmtDate(s))))),
      h('tbody', {}, rows.map((r) =>
        h('tr', {},
          h('th', { class: 'rowhead' }, r.label, r.sub ? h('span', { class: 'sub' }, r.sub) : null),
          days.map((s) => {
            const dayStart = `${s} 00:00`;
            const dayEnd = `${addDays(s, 1)} 00:00`;
            const evs = events.filter((e) => rowKey(e).includes(r.id) && e.start_at < dayEnd && e.end_at > dayStart);
            return h('td', { class: dayClass(s), title: 'クリックで予定を登録', onclick: (ev) => ev.target.tagName === 'TD' && onCell(r.id, s) },
              evs.map((e) =>
                h('button', {
                  class: `ev${e.masked ? ' private' : ''}${e.all_day ? ' allday' : ''}`,
                  title: `${timeLabel(e, s)} ${e.title}`,
                  onclick: () => openEventDetail(e.id),
                }, h('span', { class: 't' }, timeLabel(e, s)), e.title),
              ),
            );
          }),
        ),
      )),
    ),
  );
}

async function pageSchedule() {
  const q = query();
  const start = mondayOf(q.get('date') || today());
  const group = q.get('group') || (state.me.department_id ? `d${state.me.department_id}` : 'me');
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  let members;
  if (group === 'me') members = state.users.filter((u) => u.id === state.me.id);
  else if (group === 'all') members = state.users;
  else members = state.users.filter((u) => `d${u.department_id}` === group);
  // 自分を先頭に
  members = [...members].sort((a, b) => (b.id === state.me.id) - (a.id === state.me.id));
  const events = members.length
    ? await api('GET', `/api/events?from=${days[0]}&to=${days[6]}&users=${members.map((u) => u.id).join(',')}`)
    : [];
  shell([
    h('div', { class: 'row between' }, h('h1', {}, 'スケジュール'), h('button', { class: 'primary', onclick: () => openEventForm({ date: today() }) }, '＋ 予定を登録')),
    h('div', { class: 'week-toolbar' },
      h('select', { onchange: (e) => go('#/schedule', { date: start, group: e.target.value }) },
        h('option', { value: 'me', selected: group === 'me' }, '自分のみ'),
        state.departments.map((d) => h('option', { value: `d${d.id}`, selected: group === `d${d.id}` }, d.name)),
        h('option', { value: 'all', selected: group === 'all' }, '全員'),
      ),
      weekNav('#/schedule', { group }, start),
    ),
    members.length
      ? weekGrid({
          rows: members.map((u) => ({ id: u.id, label: u.name, sub: u.department })),
          days,
          events,
          rowKey: (e) => e.participant_ids,
          onCell: (uid, s) => openEventForm({ date: s, participants: [...new Set([state.me.id, uid])] }),
        })
      : h('div', { class: 'card empty' }, 'このグループには社員がいません'),
    h('p', { class: 'muted small', style: 'margin-top:8px' }, '空いている枠をクリックすると、その日・その人の予定を登録できます。非公開の予定は参加者以外には「予定あり」と表示されます。'),
  ]);
}

async function pageFacility() {
  const q = query();
  const start = mondayOf(q.get('date') || today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const facs = state.facilities;
  const events = facs.length
    ? await api('GET', `/api/events?from=${days[0]}&to=${days[6]}&facilities=${facs.map((f) => f.id).join(',')}`)
    : [];
  shell([
    h('h1', {}, '施設予約'),
    h('div', { class: 'week-toolbar' }, weekNav('#/facility', {}, start)),
    facs.length
      ? weekGrid({
          rows: facs.map((f) => ({ id: f.id, label: f.name, sub: [f.capacity ? `${f.capacity}名` : '', f.note].filter(Boolean).join(' / ') })),
          days,
          events,
          rowKey: (e) => e.facility_ids,
          onCell: (fid, s) => openEventForm({ date: s, facilities: [fid] }),
        })
      : h('div', { class: 'card empty' }, '施設が登録されていません。システム管理から登録してください。'),
    h('p', { class: 'muted small', style: 'margin-top:8px' }, '同じ時間帯に同じ施設を重複して予約することはできません。'),
  ]);
}

// ---- 予定の詳細・登録・編集 ----
async function openEventDetail(id) {
  try {
    const e = await api('GET', `/api/events/${id}`);
    const close = openModal(
      e.title,
      h('dl', { class: 'detail' },
        h('dt', {}, '日時'), h('dd', {}, eventPeriod(e)),
        e.masked ? null : [
          h('dt', {}, '参加者'), h('dd', {}, e.participant_ids.map(userName).join('、') || '—'),
          h('dt', {}, '施設'), h('dd', {}, e.facility_ids.map(facilityName).join('、') || '—'),
          h('dt', {}, '場所'), h('dd', {}, e.location || '—'),
          h('dt', {}, 'メモ'), h('dd', { class: 'pre' }, e.memo || '—'),
          h('dt', {}, '公開'), h('dd', {}, e.visibility === 'private' ? '非公開（参加者のみ）' : '公開'),
          h('dt', {}, '登録者'), h('dd', {}, e.created_by ? userName(e.created_by) : '—', h('span', { class: 'muted small' }, `　更新 ${e.updated_at.slice(0, 16)}`)),
          e.series_id ? [h('dt', {}, '繰り返し'), h('dd', {}, '繰り返し予定の1回分です')] : null,
        ],
      ),
      e.can_edit
        ? [
            h('div', { class: 'left' },
              h('button', { class: 'danger', onclick: guard(async () => {
                if (!(await confirmDialog('この予定を削除しますか？', '削除', true))) return;
                await api('DELETE', `/api/events/${id}`);
                toast('削除しました');
                route();
              }) }, '削除'),
              e.series_id
                ? h('button', { class: 'danger', onclick: guard(async () => {
                    if (!(await confirmDialog('この回以降の繰り返し予定をすべて削除しますか？', 'まとめて削除', true))) return;
                    const r = await api('DELETE', `/api/events/${id}?scope=following`);
                    toast(`${r.deleted}件削除しました`);
                    route();
                  }) }, 'この回以降を削除')
                : null,
            ),
            h('button', { onclick: () => openEventForm({ event: e, copy: true }) }, '複製'),
            h('button', { class: 'primary', onclick: () => (close(), openEventForm({ event: e })) }, '編集'),
          ]
        : [h('button', { onclick: () => close() }, '閉じる')],
    );
  } catch (e) {
    toast(e.message, 'error');
  }
}

function eventPeriod(e) {
  const sd = e.start_at.slice(0, 10);
  const ed = e.end_at.slice(0, 10);
  if (e.all_day) return sd === ed ? `${fmtDate(sd)} 終日` : `${fmtDate(sd)} 〜 ${fmtDate(ed)} 終日`;
  return sd === ed
    ? `${fmtDate(sd)} ${e.start_at.slice(11)}〜${e.end_at.slice(11)}`
    : `${fmtDate(sd)} ${e.start_at.slice(11)} 〜 ${fmtDate(ed)} ${e.end_at.slice(11)}`;
}

function openEventForm({ event, copy = false, date, participants, facilities }) {
  const editing = event && !copy;
  const base = event || {
    title: '',
    start_at: `${date} 09:00`,
    end_at: `${date} 10:00`,
    all_day: false,
    location: '',
    memo: '',
    visibility: 'public',
    participant_ids: participants || [state.me.id],
    facility_ids: facilities || [],
  };
  const err = h('div');
  const title = h('input', { type: 'text', value: base.title, maxlength: 100 });
  const allDay = h('input', { type: 'checkbox', checked: base.all_day });
  const sDate = h('input', { type: 'date', value: base.start_at.slice(0, 10) });
  const sTime = h('input', { type: 'time', value: base.all_day ? '09:00' : base.start_at.slice(11), step: 300 });
  const eDate = h('input', { type: 'date', value: base.end_at.slice(0, 10) });
  const eTime = h('input', { type: 'time', value: base.all_day ? '10:00' : base.end_at.slice(11).replace('24:00', '23:59'), step: 300 });
  const syncAllDay = () => {
    sTime.hidden = eTime.hidden = allDay.checked;
  };
  allDay.addEventListener('change', syncAllDay);
  syncAllDay();
  // 開始日を変えたら終了日も同じだけずらす
  let prevStart = sDate.value;
  sDate.addEventListener('change', () => {
    if (sDate.value && prevStart && eDate.value) {
      const diff = Math.round((parseYmd(sDate.value) - parseYmd(prevStart)) / 86400000);
      eDate.value = addDays(eDate.value, diff);
    }
    prevStart = sDate.value;
  });
  const picker = userPicker(base.participant_ids);
  const facSel = new Set(base.facility_ids);
  const facBox = h('div', { class: 'picker' },
    state.facilities.length
      ? state.facilities.map((f) => h('label', {}, h('input', { type: 'checkbox', checked: facSel.has(f.id), onchange: (e) => (e.target.checked ? facSel.add(f.id) : facSel.delete(f.id)) }), f.name, f.capacity ? h('span', { class: 'muted small' }, `（${f.capacity}名）`) : null))
      : h('span', { class: 'muted small' }, '施設は登録されていません'),
  );
  const location_ = h('input', { type: 'text', value: base.location, maxlength: 100 });
  const memo = h('textarea', { maxlength: 5000 }, base.memo);
  const priv = h('input', { type: 'checkbox', checked: base.visibility === 'private' });
  const repFreq = h('select', {},
    h('option', { value: 'none' }, 'しない'),
    h('option', { value: 'daily' }, '毎日'),
    h('option', { value: 'weekdays' }, '毎日（土日を除く）'),
    h('option', { value: 'weekly' }, '毎週'),
    h('option', { value: 'monthly' }, '毎月（同じ日）'),
  );
  const repUntil = h('input', { type: 'date', value: addDays(base.start_at.slice(0, 10), 28) });

  const submit = guard(async () => {
    err.replaceChildren();
    const body = {
      title: title.value,
      all_day: allDay.checked,
      start_at: allDay.checked ? sDate.value : `${sDate.value} ${sTime.value}`,
      end_at: allDay.checked ? eDate.value : `${eDate.value} ${eTime.value}`,
      participant_ids: picker.value(),
      facility_ids: [...facSel],
      location: location_.value,
      memo: memo.value,
      visibility: priv.checked ? 'private' : 'public',
    };
    if (!editing && repFreq.value !== 'none') body.repeat = { freq: repFreq.value, until: repUntil.value };
    try {
      if (editing) await api('PUT', `/api/events/${event.id}`, body);
      else {
        const r = await api('POST', '/api/events', body);
        if (r.ids.length > 1) toast(`${r.ids.length}件の予定を登録しました`);
      }
      close();
      toast(editing ? '予定を更新しました' : '予定を登録しました');
      route();
    } catch (e) {
      err.replaceChildren(h('div', { class: 'alert error' }, e.message));
    }
  });

  const close = openModal(
    editing ? '予定の編集' : '予定の登録',
    h('form', { onsubmit: (e) => (e.preventDefault(), submit()) },
      err,
      field('件名', title, true),
      h('div', { class: 'field' },
        h('div', { class: 'row', style: 'margin-bottom:6px' }, h('b', { class: 'small' }, '日時'), h('label', { class: 'check small' }, allDay, '終日')),
        h('div', { class: 'dt' }, sDate, sTime, '〜', eDate, eTime),
      ),
      editing ? null : h('div', { class: 'field', style: 'margin:12px 0' }, h('div', { class: 'dt' }, h('b', { class: 'small' }, '繰り返し'), repFreq, h('span', { class: 'small' }, '終了日'), repUntil)),
      h('div', { class: 'field', style: 'margin-top:12px' }, h('b', { class: 'small' }, '参加者'), picker.el),
      h('div', { class: 'field', style: 'margin-top:12px' }, h('b', { class: 'small' }, '施設'), facBox),
      h('div', { style: 'margin-top:12px' }, field('場所', location_)),
      field('メモ', memo),
      h('label', { class: 'check' }, priv, '非公開にする（参加者以外には「予定あり」と表示）'),
      h('button', { type: 'submit', hidden: true }),
    ),
    [h('button', { onclick: () => close() }, 'キャンセル'), h('button', { class: 'primary', onclick: submit }, editing ? '更新する' : '登録する')],
  );
}

// ================= ワークフロー =================
const STATUS_LABEL = { pending: '承認待ち', approved: '承認済み', rejected: '却下', returned: '差し戻し', withdrawn: '取り下げ' };
const statusBadge = (s) => h('span', { class: `status ${s}` }, STATUS_LABEL[s] || s);

async function pageWorkflow() {
  const box = query().get('box') || 'todo';
  const rows = await api('GET', `/api/requests?box=${box}`);
  const tabs = [['todo', '承認待ち'], ['mine', '自分の申請'], ['done', '処理済み'], ...(state.me.role === 'admin' ? [['all', 'すべて（管理者）']] : [])];
  shell([
    h('div', { class: 'row between' }, h('h1', {}, 'ワークフロー'), h('button', { class: 'primary', onclick: () => go('#/workflow/new') }, '＋ 新規申請')),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { href: `#/workflow?box=${k}`, class: k === box ? 'active' : '' }, l))),
    rows.length
      ? h('div', { class: 'table-wrap' },
          h('table', { class: 'list' },
            h('thead', {}, h('tr', {}, ['No.', '種別', '件名', '申請者', '金額', '状況', '現在の承認者', '更新日時'].map((t) => h('th', {}, t)))),
            h('tbody', {}, rows.map((r) =>
              h('tr', { class: 'clickable', onclick: () => go(`#/workflow/${r.id}`) },
                h('td', {}, r.id),
                h('td', {}, r.type),
                h('td', {}, r.title),
                h('td', {}, r.applicant_name),
                h('td', { style: 'text-align:right' }, yen(r.amount)),
                h('td', {}, statusBadge(r.status), r.status === 'pending' ? h('span', { class: 'muted small' }, ` ${r.current_step}/${r.step_count}`) : null),
                h('td', {}, r.status === 'pending' ? r.current_approver_name : '—'),
                h('td', { class: 'small muted', style: 'white-space:nowrap' }, r.updated_at.slice(0, 16)),
              ),
            )),
          ),
        )
      : h('div', { class: 'card empty' }, box === 'todo' ? 'あなたの承認待ちはありません' : '該当する申請はありません'),
  ]);
}

async function pageWorkflowForm(id) {
  const existing = id ? await api('GET', `/api/requests/${id}`) : null;
  const err = h('div');
  const type = h('select', {}, state.types.map((t) => h('option', { value: t, selected: existing?.type === t }, t)));
  const title = h('input', { type: 'text', value: existing?.title || '', maxlength: 100 });
  const amount = h('input', { type: 'number', min: 0, step: 1, value: existing?.amount ?? '', placeholder: '金額がある場合のみ' });
  const body = h('textarea', { maxlength: 10000, style: 'min-height:200px' }, existing?.body || '');
  const approvers = approverPicker(existing ? existing.steps.map((s) => s.approver_id) : []);
  const submit = guard(async () => {
    err.replaceChildren();
    const data = { type: type.value, title: title.value, amount: amount.value === '' ? null : Number(amount.value), body: body.value, approver_ids: approvers.value() };
    try {
      if (existing) {
        await api('PUT', `/api/requests/${existing.id}`, data);
        toast('再申請しました');
        go(`#/workflow/${existing.id}`);
      } else {
        const r = await api('POST', '/api/requests', data);
        toast('申請しました');
        go(`#/workflow/${r.id}`);
      }
    } catch (e) {
      err.replaceChildren(h('div', { class: 'alert error' }, e.message));
    }
  });
  shell([
    h('h1', {}, existing ? `申請の修正・再申請（No.${existing.id}）` : '新規申請'),
    h('div', { class: 'card', style: 'max-width:760px' },
      err,
      field('申請種別', type, true),
      field('件名', title, true),
      field('金額（円）', amount),
      field('内容', body),
      h('div', { class: 'field' }, h('b', { class: 'small' }, '承認ルート（上から順に承認されます）'), h('div', { style: 'margin-top:6px' }, approvers.el)),
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { onclick: () => history.back() }, 'キャンセル'),
        h('button', { class: 'primary', onclick: submit }, existing ? '再申請する' : '申請する'),
      ),
    ),
  ]);
}

async function pageWorkflowDetail(id) {
  const r = await api('GET', `/api/requests/${id}`);
  const comment = h('textarea', { placeholder: 'コメント（却下・差し戻しの場合は必須）', style: 'min-height:80px' });
  const act = (action, label) =>
    guard(async () => {
      if (action !== 'approve' && !comment.value.trim()) return toast('コメントを入力してください', 'error');
      if (!(await confirmDialog(`この申請を「${label}」します。よろしいですか？`, label, action !== 'approve'))) return;
      await api('POST', `/api/requests/${id}/act`, { action, comment: comment.value });
      toast(`${label}しました`);
      refreshCounts();
      route();
    });
  shell([
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('a', { href: '#/workflow' }, '← 一覧へ戻る')),
    h('div', { class: 'row', style: 'margin-bottom:16px' }, h('h1', { style: 'margin:0' }, `${r.title}`), statusBadge(r.status)),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('dl', { class: 'detail' },
          h('dt', {}, '申請No.'), h('dd', {}, r.id),
          h('dt', {}, '種別'), h('dd', {}, r.type),
          h('dt', {}, '申請者'), h('dd', {}, r.applicant_name),
          h('dt', {}, '申請日時'), h('dd', {}, r.created_at.slice(0, 16)),
          r.amount !== null ? [h('dt', {}, '金額'), h('dd', {}, yen(r.amount))] : null,
          h('dt', {}, '内容'), h('dd', { class: 'pre' }, r.body || '—'),
        ),
      ),
      h('div', { class: 'card' },
        h('h2', {}, '承認ルート'),
        h('ol', { class: 'steps' },
          r.steps.map((s) =>
            h('li', { class: r.status === 'pending' && s.step_no === r.current_step ? 'current' : '' },
              h('span', { class: 'no' }, `${s.step_no}次`),
              h('b', {}, s.approver_name),
              s.status === 'waiting' ? h('span', { class: 'muted small' }, r.status === 'pending' && s.step_no === r.current_step ? '承認待ち' : '未処理') : statusBadge(s.status),
              s.acted_at ? h('span', { class: 'muted small' }, s.acted_at.slice(0, 16)) : null,
              s.comment ? h('div', { class: 'pre small', style: 'width:100%;padding-left:60px' }, `💬 ${s.comment}`) : null,
            ),
          ),
        ),
      ),
    ),
    r.can_act
      ? h('div', { class: 'card' },
          h('h2', {}, 'あなたの承認待ちです'),
          comment,
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'primary', onclick: act('approve', '承認') }, '承認'),
            h('button', { onclick: act('return', '差し戻し') }, '差し戻し'),
            h('button', { class: 'danger', onclick: act('reject', '却下') }, '却下'),
          ),
        )
      : null,
    r.can_withdraw || r.can_resubmit
      ? h('div', { class: 'row' },
          r.can_resubmit ? h('button', { class: 'primary', onclick: () => go(`#/workflow/${id}/edit`) }, '修正して再申請') : null,
          r.can_withdraw ? h('button', { class: 'danger', onclick: guard(async () => {
            if (!(await confirmDialog('この申請を取り下げますか？', '取り下げ', true))) return;
            await api('POST', `/api/requests/${id}/withdraw`);
            toast('取り下げました');
            route();
          }) }, '取り下げ') : null,
        )
      : null,
  ]);
}

// ================= 掲示板 =================
async function pageBoard() {
  const posts = await api('GET', '/api/posts');
  shell([
    h('div', { class: 'row between' }, h('h1', {}, '掲示板'), h('button', { class: 'primary', onclick: () => go('#/board/new') }, '＋ お知らせを投稿')),
    posts.length
      ? h('div', { class: 'table-wrap' },
          h('table', { class: 'list' },
            h('thead', {}, h('tr', {}, h('th', {}, '件名'), h('th', {}, '投稿者'), h('th', {}, '投稿日時'))),
            h('tbody', {}, posts.map((p) =>
              h('tr', { class: 'clickable', onclick: () => go(`#/board/${p.id}`) },
                h('td', { class: p.is_read ? '' : 'unread' }, p.is_read ? null : h('span', { class: 'dot' }), p.pinned ? h('span', { class: 'pin' }, '【重要】') : null, p.title),
                h('td', {}, p.author_name || '—'),
                h('td', { class: 'small muted', style: 'white-space:nowrap' }, p.created_at.slice(0, 16)),
              ),
            )),
          ),
        )
      : h('div', { class: 'card empty' }, 'お知らせはまだありません'),
  ]);
}

async function pageBoardDetail(id) {
  const p = await api('GET', `/api/posts/${id}`);
  refreshCounts();
  shell([
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('a', { href: '#/board' }, '← 一覧へ戻る')),
    h('div', { class: 'card' },
      h('h1', {}, p.pinned ? h('span', { class: 'pin' }, '【重要】') : null, p.title),
      h('p', { class: 'muted small' }, `${p.author_name || '—'}　${p.created_at.slice(0, 16)}${p.updated_at !== p.created_at ? `（更新 ${p.updated_at.slice(0, 16)}）` : ''}`),
      h('div', { class: 'pre', style: 'margin:16px 0' }, p.body),
      p.can_edit
        ? h('div', { class: 'row' },
            h('button', { onclick: () => go(`#/board/${id}/edit`) }, '編集'),
            h('button', { class: 'danger', onclick: guard(async () => {
              if (!(await confirmDialog('このお知らせを削除しますか？', '削除', true))) return;
              await api('DELETE', `/api/posts/${id}`);
              toast('削除しました');
              go('#/board');
            }) }, '削除'),
          )
        : null,
    ),
    h('details', { class: 'card' },
      h('summary', {}, `既読 ${p.readers.length} / ${p.active_users}名`),
      h('div', { class: 'small', style: 'margin-top:8px' }, p.readers.map((r) => `${r.name}（${r.read_at.slice(5, 16)}）`).join('、')),
    ),
  ]);
}

async function pageBoardForm(id) {
  const p = id ? await api('GET', `/api/posts/${id}`) : null;
  const err = h('div');
  const title = h('input', { type: 'text', value: p?.title || '', maxlength: 100 });
  const body = h('textarea', { style: 'min-height:260px', maxlength: 20000 }, p?.body || '');
  const pinned = h('input', { type: 'checkbox', checked: p?.pinned });
  const submit = guard(async () => {
    err.replaceChildren();
    const data = { title: title.value, body: body.value, pinned: pinned.checked };
    try {
      const r = p ? await api('PUT', `/api/posts/${id}`, data) : await api('POST', '/api/posts', data);
      toast(p ? '更新しました' : '投稿しました');
      go(`#/board/${p ? id : r.id}`);
    } catch (e) {
      err.replaceChildren(h('div', { class: 'alert error' }, e.message));
    }
  });
  shell([
    h('h1', {}, p ? 'お知らせの編集' : 'お知らせの投稿'),
    h('div', { class: 'card', style: 'max-width:760px' },
      err,
      field('件名', title, true),
      field('本文', body, true),
      state.me.role === 'admin' ? h('label', { class: 'check', style: 'margin-bottom:12px' }, pinned, '【重要】として一覧の上部に固定する') : null,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { onclick: () => history.back() }, 'キャンセル'), h('button', { class: 'primary', onclick: submit }, p ? '更新する' : '投稿する')),
    ),
  ]);
}

// ================= ToDo =================
async function pageTodo() {
  const todos = await api('GET', '/api/todos');
  const title = h('input', { type: 'text', placeholder: 'やること', maxlength: 200, style: 'flex:1;min-width:200px' });
  const due = h('input', { type: 'date' });
  const add = guard(async (e) => {
    e?.preventDefault();
    await api('POST', '/api/todos', { title: title.value, due_date: due.value || null });
    route();
  });
  shell([
    h('h1', {}, 'ToDo'),
    h('form', { class: 'card row', onsubmit: add }, title, h('span', { class: 'small muted' }, '期限'), due, h('button', { class: 'primary', type: 'submit' }, '追加')),
    h('div', { class: 'card' },
      todos.length
        ? todos.map((t) =>
            h('div', { class: `todo-item${t.done ? ' done' : ''}` },
              h('input', { type: 'checkbox', checked: t.done, 'aria-label': '完了', onchange: guard(async (e) => (await api('PUT', `/api/todos/${t.id}`, { done: e.target.checked }), route())) }),
              h('span', { class: 'title' }, t.title),
              t.done ? null : dueLabel(t.due_date),
              h('button', { class: 'small danger', onclick: guard(async () => (await api('DELETE', `/api/todos/${t.id}`), route())) }, '削除'),
            ),
          )
        : h('div', { class: 'empty' }, 'ToDo はありません'),
    ),
  ]);
}

// ================= 個人設定 =================
async function pageSettings() {
  const email = h('input', { type: 'email', value: state.me.email || '' });
  shell([
    h('h1', {}, '個人設定'),
    h('div', { class: 'card', style: 'max-width:480px' },
      h('h2', {}, 'プロフィール'),
      h('dl', { class: 'detail', style: 'margin-bottom:12px' },
        h('dt', {}, '氏名'), h('dd', {}, state.me.name),
        h('dt', {}, 'ログインID'), h('dd', {}, state.me.login_id),
        h('dt', {}, '部署'), h('dd', {}, state.departments.find((d) => d.id === state.me.department_id)?.name || '—'),
      ),
      field('メールアドレス', email),
      h('button', { class: 'primary', onclick: guard(async () => {
        await api('PUT', '/api/me', { email: email.value });
        state.me.email = email.value;
        toast('保存しました');
      }) }, '保存'),
      h('p', { class: 'muted small', style: 'margin-top:8px' }, '氏名・部署の変更はシステム管理者に依頼してください。'),
    ),
    passwordForm(false),
  ]);
}

// ================= システム管理 =================
async function pageAdmin() {
  const tab = query().get('tab') || 'users';
  const tabs = [['users', 'ユーザー'], ['departments', '部署'], ['facilities', '施設'], ['data', 'データ移行'], ['audit', '操作ログ']];
  const content = await {
    users: adminUsers,
    departments: adminDepartments,
    facilities: adminFacilities,
    data: adminData,
    audit: adminAudit,
  }[tab]?.();
  shell([
    h('h1', {}, 'システム管理'),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { href: `#/admin?tab=${k}`, class: k === tab ? 'active' : '' }, l))),
    content,
  ]);
}

async function adminUsers() {
  const users = await api('GET', '/api/admin/users');
  const form = (u) => {
    const err = h('div');
    const loginId = h('input', { type: 'text', value: u?.login_id || '' });
    const name = h('input', { type: 'text', value: u?.name || '' });
    const email = h('input', { type: 'email', value: u?.email || '' });
    const dept = h('select', {}, h('option', { value: '' }, '（なし）'), state.departments.map((d) => h('option', { value: d.id, selected: u?.department_id === d.id }, d.name)));
    const role = h('select', {}, h('option', { value: 'member' }, '一般'), h('option', { value: 'admin', selected: u?.role === 'admin' }, '管理者'));
    const sort = h('input', { type: 'number', min: 0, value: u?.sort ?? 0 });
    const active = h('input', { type: 'checkbox', checked: u ? u.active : true });
    const save = guard(async () => {
      err.replaceChildren();
      const data = { login_id: loginId.value, name: name.value, email: email.value, department_id: dept.value ? Number(dept.value) : null, role: role.value, sort: Number(sort.value || 0), active: active.checked };
      try {
        if (u) await api('PUT', `/api/admin/users/${u.id}`, data);
        else {
          const r = await api('POST', '/api/admin/users', data);
          close();
          await loadMasters();
          route();
          return showPassword('ユーザーを登録しました', [{ login_id: data.login_id, name: data.name, initial_password: r.initial_password }]);
        }
        close();
        toast('保存しました');
        await loadMasters();
        route();
      } catch (e) {
        err.replaceChildren(h('div', { class: 'alert error' }, e.message));
      }
    });
    const close = openModal(u ? 'ユーザーの編集' : 'ユーザーの追加',
      h('div', {}, err, field('ログインID', loginId, true), field('氏名', name, true), field('メールアドレス', email), field('部署', dept), field('権限', role), field('表示順（小さいほど上）', sort), u ? h('label', { class: 'check' }, active, '有効（オフにするとログイン不可・一覧から非表示）') : null),
      [
        u ? h('div', { class: 'left' }, h('button', { onclick: guard(async () => {
          if (!(await confirmDialog(`${u.name} さんのパスワードを初期化しますか？`, '初期化'))) return;
          const r = await api('POST', `/api/admin/users/${u.id}/reset-password`);
          close();
          showPassword('パスワードを初期化しました', [{ login_id: u.login_id, name: u.name, initial_password: r.initial_password }]);
        }) }, 'パスワード初期化')) : null,
        h('button', { onclick: () => close() }, 'キャンセル'),
        h('button', { class: 'primary', onclick: save }, '保存'),
      ],
    );
  };
  return h('div', {},
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('button', { class: 'primary', onclick: () => form() }, '＋ ユーザーを追加'), h('span', { class: 'muted small' }, `${users.filter((u) => u.active).length}名が有効`)),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ['ログインID', '氏名', '部署', '権限', '状態', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, users.map((u) =>
          h('tr', { class: 'clickable', onclick: () => form(u) },
            h('td', {}, u.login_id),
            h('td', {}, u.name),
            h('td', {}, u.department || '—'),
            h('td', {}, u.role === 'admin' ? '管理者' : '一般'),
            h('td', {}, u.active ? (u.must_change_password ? h('span', { class: 'muted small' }, '初回ログイン待ち') : '有効') : h('span', { class: 'muted' }, '無効')),
            h('td', {}, h('button', { class: 'small' }, '編集')),
          ),
        )),
      ),
    ),
  );
}

async function adminDepartments() {
  const depts = await api('GET', '/api/departments');
  const edit = (d) => {
    const err = h('div');
    const name = h('input', { type: 'text', value: d?.name || '' });
    const sort = h('input', { type: 'number', min: 0, value: d?.sort ?? 0 });
    const close = openModal(d ? '部署の編集' : '部署の追加', h('div', {}, err, field('部署名', name, true), field('表示順（小さいほど上）', sort)), [
      d ? h('div', { class: 'left' }, h('button', { class: 'danger', onclick: guard(async () => {
        if (!(await confirmDialog(`部署「${d.name}」を削除しますか？\n所属していた社員は「部署なし」になります。`, '削除', true))) return;
        await api('DELETE', `/api/admin/departments/${d.id}`);
        close();
        await loadMasters();
        route();
      }) }, '削除')) : null,
      h('button', { onclick: () => close() }, 'キャンセル'),
      h('button', { class: 'primary', onclick: guard(async () => {
        try {
          const data = { name: name.value, sort: Number(sort.value || 0) };
          if (d) await api('PUT', `/api/admin/departments/${d.id}`, data);
          else await api('POST', '/api/admin/departments', data);
          close();
          await loadMasters();
          route();
        } catch (e) {
          err.replaceChildren(h('div', { class: 'alert error' }, e.message));
        }
      }) }, '保存'),
    ]);
  };
  return h('div', {},
    h('button', { class: 'primary', style: 'margin-bottom:12px', onclick: () => edit() }, '＋ 部署を追加'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', {}, '部署名'), h('th', {}, '表示順'), h('th', {}, '人数'))),
      h('tbody', {}, depts.map((d) => h('tr', { class: 'clickable', onclick: () => edit(d) }, h('td', {}, d.name), h('td', {}, d.sort), h('td', {}, state.users.filter((u) => u.department_id === d.id).length)))),
    )),
  );
}

async function adminFacilities() {
  const facs = await api('GET', '/api/admin/facilities');
  const edit = (f) => {
    const err = h('div');
    const name = h('input', { type: 'text', value: f?.name || '' });
    const cap = h('input', { type: 'number', min: 0, value: f?.capacity ?? '' });
    const note = h('input', { type: 'text', value: f?.note || '' });
    const sort = h('input', { type: 'number', min: 0, value: f?.sort ?? 0 });
    const active = h('input', { type: 'checkbox', checked: f ? f.active : true });
    const close = openModal(f ? '施設の編集' : '施設の追加',
      h('div', {}, err, field('施設名', name, true), field('定員', cap), field('備考（設備など）', note), field('表示順（小さいほど上）', sort), h('label', { class: 'check' }, active, '予約を受け付ける')),
      [
        h('button', { onclick: () => close() }, 'キャンセル'),
        h('button', { class: 'primary', onclick: guard(async () => {
          try {
            const data = { name: name.value, capacity: cap.value === '' ? null : Number(cap.value), note: note.value, sort: Number(sort.value || 0), active: active.checked };
            if (f) await api('PUT', `/api/admin/facilities/${f.id}`, data);
            else await api('POST', '/api/admin/facilities', data);
            close();
            await loadMasters();
            route();
          } catch (e) {
            err.replaceChildren(h('div', { class: 'alert error' }, e.message));
          }
        }) }, '保存'),
      ],
    );
  };
  return h('div', {},
    h('button', { class: 'primary', style: 'margin-bottom:12px', onclick: () => edit() }, '＋ 施設を追加'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['施設名', '定員', '備考', '状態'].map((t) => h('th', {}, t)))),
      h('tbody', {}, facs.map((f) => h('tr', { class: 'clickable', onclick: () => edit(f) }, h('td', {}, f.name), h('td', {}, f.capacity ?? '—'), h('td', {}, f.note || '—'), h('td', {}, f.active ? '利用可' : h('span', { class: 'muted' }, '停止中'))))),
    )),
  );
}

function csvImporter(title, help, sample, endpoint, onDone) {
  const file = h('input', { type: 'file', accept: '.csv,text/csv' });
  const result = h('div');
  return h('div', { class: 'card' },
    h('h2', {}, title),
    h('p', { class: 'small' }, help),
    h('p', { class: 'small muted' }, '1行目が見出しの場合は自動で読み飛ばします。文字コードは UTF-8 または Shift_JIS（Excel 保存の CSV）に対応しています。'),
    h('pre', { class: 'small', style: 'background:var(--surface-2);padding:8px;border-radius:4px;overflow-x:auto' }, sample),
    h('div', { class: 'row' }, file, h('button', { class: 'primary', onclick: guard(async () => {
      const f = file.files[0];
      if (!f) return toast('CSV ファイルを選択してください', 'error');
      const buf = await f.arrayBuffer();
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buf);
      const r = await api('POST', endpoint, { csv: text });
      result.replaceChildren(
        h('div', { class: 'alert ok' }, `${r.created ? r.created.length : r.imported}件を取り込みました。${r.skipped.length ? `${r.skipped.length}件はスキップしました。` : ''}`),
        r.skipped.length ? h('ul', { class: 'small' }, r.skipped.map((s) => h('li', {}, `${s.line}行目: ${s.reason}`))) : null,
      );
      await onDone?.(r);
    }) }, '取り込む')),
    result,
  );
}

async function adminData() {
  const from = h('input', { type: 'date', value: addDays(today(), -365) });
  const to = h('input', { type: 'date', value: addDays(today(), 365) });
  return h('div', {},
    h('div', { class: 'alert info' }, 'クロジカからの移行手順：①部署・施設を登録 → ②ユーザーを CSV で一括登録 → ③クロジカから出力した予定を下記の列順に整えて CSV で取り込み。詳しくは README の「クロジカからの移行」を参照してください。'),
    csvImporter('① ユーザーの一括登録', '列: ログインID, 氏名, メールアドレス, 部署名, 権限(admin/member)。部署名が未登録の場合は自動で作成します。登録済みのログインIDはスキップします。',
      'ログインID,氏名,メールアドレス,部署,権限\nyamada,山田 太郎,yamada@example.co.jp,営業部,member', '/api/admin/users/import',
      async (r) => {
        await loadMasters();
        if (r.created.length) showPassword(`${r.created.length}名を登録しました`, r.created);
      }),
    csvImporter('② 予定の一括取り込み', '列: 件名, 開始日時, 終了日時, 終日(1/0), 参加者ログインID(;区切り), 施設名(;区切り), 場所, メモ, 非公開(1/0)。日時は「2026/4/1 9:00」形式も可。移行データのため施設の重複チェックは行いません。',
      '件名,開始日時,終了日時,終日,参加者,施設,場所,メモ,非公開\n営業会議,2026-04-01 09:00,2026-04-01 10:00,0,yamada;sato,会議室A,,定例,0', '/api/admin/events/import'),
    h('div', { class: 'card' },
      h('h2', {}, '予定の書き出し（CSV）'),
      h('p', { class: 'small' }, 'バックアップや他システムへの移行用に、期間内の全予定を上記と同じ形式で書き出します。'),
      h('div', { class: 'row' }, from, '〜', to, h('button', { onclick: guard(async () => {
        const res = await fetch(`/api/admin/events/export?from=${from.value}&to=${to.value}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error((await res.json()).error);
        const blob = await res.blob();
        const a = h('a', { href: URL.createObjectURL(blob), download: `schedule_${from.value}_${to.value}.csv` });
        document.body.append(a);
        a.click();
        a.remove();
      }) }, '書き出す')),
    ),
  );
}

async function adminAudit() {
  const rows = await api('GET', '/api/admin/audit');
  const LABEL = {
    login: 'ログイン', login_failed: 'ログイン失敗', password_changed: 'パスワード変更', password_reset: 'パスワード初期化',
    user_created: 'ユーザー登録', user_updated: 'ユーザー更新', users_imported: 'ユーザー一括登録', events_imported: '予定一括取込',
    request_submitted: '申請', request_resubmitted: '再申請', request_approve: '承認', request_reject: '却下', request_return: '差し戻し', request_withdrawn: '取り下げ',
  };
  return h('div', {},
    h('p', { class: 'muted small' }, '直近300件を表示しています。'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['日時', '操作者', '操作', '対象'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { class: 'small', style: 'white-space:nowrap' }, r.at), h('td', {}, r.user_name || '—'), h('td', {}, LABEL[r.action] || r.action), h('td', {}, r.target)))),
    )),
  );
}

// ================= ルーティング =================
async function route() {
  if (!state.me) return renderLogin();
  if (state.me.must_change_password) {
    return $app().replaceChildren(h('div', { class: 'login-wrap' }, passwordForm(true)));
  }
  const [path] = location.hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  try {
    switch (parts[0]) {
      case 'schedule': return await pageSchedule();
      case 'facility': return await pageFacility();
      case 'workflow':
        if (parts[1] === 'new') return await pageWorkflowForm();
        if (parts[1] && parts[2] === 'edit') return await pageWorkflowForm(parts[1]);
        if (parts[1]) return await pageWorkflowDetail(parts[1]);
        return await pageWorkflow();
      case 'board':
        if (parts[1] === 'new') return await pageBoardForm();
        if (parts[1] && parts[2] === 'edit') return await pageBoardForm(parts[1]);
        if (parts[1]) return await pageBoardDetail(parts[1]);
        return await pageBoard();
      case 'todo': return await pageTodo();
      case 'settings': return await pageSettings();
      case 'admin':
        if (state.me.role === 'admin') return await pageAdmin();
        return go('#/home');
      default: return await pageHome();
    }
  } catch (e) {
    if (e.status === 401 || e.code === 'must_change_password') return;
    shell(h('div', { class: 'alert error' }, e.message));
  }
}

async function boot() {
  try {
    state.me = state.me || (await api('GET', '/api/me'));
  } catch {
    return renderLogin();
  }
  if (!state.me.must_change_password) {
    if (!state.me.csrf) state.me = await api('GET', '/api/me');
    await loadMasters();
    refreshCounts();
  }
  route();
}

window.addEventListener('hashchange', () => {
  document.getElementById('modal-root').replaceChildren();
  route();
});
// 承認待ち・未読件数を定期的に更新
setInterval(() => state.me && !state.me.must_change_password && refreshCounts(), 120000);
boot();
