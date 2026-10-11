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
  const box = document.getElementById('toast');
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2500);
}

// ================= API =================
const state = { me: null, users: [], departments: [], facilities: [], types: [], templateCategories: [], counts: { approvals: 0, unread: 0, chat: 0, polls: 0 }, chatTimer: null };

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
  [state.users, state.departments, state.facilities, state.types, state.templateCategories] = await Promise.all([
    api('GET', '/api/users'),
    api('GET', '/api/departments'),
    api('GET', '/api/facilities'),
    api('GET', '/api/request-types'),
    api('GET', '/api/template-categories'),
  ]);
}
const userName = (id) => state.users.find((u) => u.id === id)?.name ?? '（退職者等）';
const facilityName = (id) => state.facilities.find((f) => f.id === id)?.name ?? '（廃止施設）';

function setCounts(d) {
  state.counts = { approvals: d.approvals, unread: d.unread.length, chat: d.chat_unread, polls: d.polls_unanswered };
}

async function refreshCounts() {
  try {
    const d = await api('GET', `/api/dashboard?today=${today()}`);
    setCounts(d);
    document.querySelectorAll('[data-badge]').forEach((el) => {
      const n = state.counts[el.dataset.badge];
      el.textContent = n || '';
      el.hidden = !n;
    });
    document.title = state.counts.chat ? `(${state.counts.chat}) 社内グループウェア` : '社内グループウェア';
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
  ['#/poll', '日程調整', 'polls'],
  ['#/workflow', 'ワークフロー', 'approvals'],
  ['#/board', '掲示板', 'unread'],
  ['#/templates', 'テンプレート集'],
  ['#/blog', 'ブログ'],
  ['#/chat', 'チャット', 'chat'],
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
        await pushUnsubscribe().catch(() => {});
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
  setCounts(d);
  const t = parseYmd(d.today);
  shell([
    h('h1', {}, `${t.getMonth() + 1}月${t.getDate()}日（${WD[t.getDay()]}）`),
    h('div', { class: 'stat' },
      h('a', { href: '#/workflow?box=todo' }, '承認待ち', h('b', {}, d.approvals)),
      h('a', { href: '#/workflow?box=mine' }, '自分の申請（処理中）', h('b', {}, d.my_pending)),
      h('a', { href: '#/board' }, '未読のお知らせ', h('b', {}, d.unread.length)),
      h('a', { href: '#/chat' }, 'チャット未読', h('b', {}, d.chat_unread)),
      h('a', { href: '#/poll' }, '日程調整の未回答', h('b', {}, d.polls_unanswered)),
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
          ? d.todos.map((t) => h('div', { class: 'todo-item' }, h('span', { class: 'title' }, t.title, t.created_by !== state.me.id ? h('span', { class: 'muted small' }, `（${t.requester_name}さんから依頼）`) : null), dueLabel(t.due_date)))
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
  const box = query().get('box') || 'mine';
  const todos = await api('GET', `/api/todos?box=${box}`);
  const title = h('input', { type: 'text', placeholder: 'やること', maxlength: 200, style: 'flex:1;min-width:200px' });
  const due = h('input', { type: 'date' });
  const assignee = h('select', { 'aria-label': '担当者' },
    h('option', { value: state.me.id }, '自分'),
    state.users.filter((u) => u.id !== state.me.id).map((u) => h('option', { value: u.id }, `${u.name}に依頼`)),
  );
  const add = guard(async (e) => {
    e?.preventDefault();
    await api('POST', '/api/todos', { title: title.value, due_date: due.value || null, assignee_id: Number(assignee.value) });
    toast(Number(assignee.value) === state.me.id ? '追加しました' : '依頼しました');
    route();
  });
  const editTodo = (t) => {
    const err = h('div');
    const ti = h('input', { type: 'text', value: t.title, maxlength: 200 });
    const du = h('input', { type: 'date', value: t.due_date || '' });
    const me = h('textarea', { maxlength: 2000, style: 'min-height:80px' }, t.memo || '');
    const close = openModal('ToDo の編集', h('div', {}, err,
      h('p', { class: 'small muted' }, `担当: ${t.assignee_name}　依頼者: ${t.requester_name || '—'}`),
      field('内容', ti, true), field('期限', du), field('メモ', me)), [
      h('div', { class: 'left' }, h('button', { class: 'danger', onclick: guard(async () => {
        if (!(await confirmDialog('この ToDo を削除しますか？', '削除', true))) return;
        await api('DELETE', `/api/todos/${t.id}`);
        close();
        route();
      }) }, '削除')),
      h('button', { onclick: () => close() }, 'キャンセル'),
      h('button', { class: 'primary', onclick: guard(async () => {
        try {
          await api('PUT', `/api/todos/${t.id}`, { title: ti.value, due_date: du.value || null, memo: me.value });
          close();
          route();
        } catch (e) {
          err.replaceChildren(h('div', { class: 'alert error' }, e.message));
        }
      }) }, '保存'),
    ]);
  };
  shell([
    h('h1', {}, 'ToDo'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/todo?box=mine', class: box === 'mine' ? 'active' : '' }, '自分の ToDo'),
      h('a', { href: '#/todo?box=requested', class: box === 'requested' ? 'active' : '' }, '依頼した ToDo'),
    ),
    h('form', { class: 'card row', onsubmit: add }, title, h('span', { class: 'small muted' }, '期限'), due, assignee, h('button', { class: 'primary', type: 'submit' }, '追加')),
    h('div', { class: 'card' },
      todos.length
        ? todos.map((t) =>
            h('div', { class: `todo-item${t.done ? ' done' : ''}` },
              h('input', { type: 'checkbox', checked: t.done, 'aria-label': '完了', onchange: guard(async (e) => (await api('PUT', `/api/todos/${t.id}`, { done: e.target.checked }), route())) }),
              h('span', { class: 'title' },
                t.title,
                box === 'requested' ? h('span', { class: 'muted small' }, `（担当: ${t.assignee_name}）`) : t.created_by && t.created_by !== state.me.id ? h('span', { class: 'muted small' }, `（${t.requester_name}さんから依頼）`) : null,
                t.memo ? h('div', { class: 'muted small pre' }, t.memo) : null,
              ),
              t.done ? null : dueLabel(t.due_date),
              h('button', { class: 'small', onclick: () => editTodo(t) }, '編集'),
            ),
          )
        : h('div', { class: 'empty' }, box === 'mine' ? 'ToDo はありません' : '他の人に依頼した ToDo はありません'),
    ),
  ]);
}

// ================= ブログ =================
async function pageBlog() {
  const q = query();
  const word = q.get('q') || '';
  const author = q.get('author') || '';
  const params = new URLSearchParams();
  if (word) params.set('q', word);
  if (author) params.set('author', author);
  const blogs = await api('GET', `/api/blogs?${params}`);
  const search = h('input', { type: 'search', value: word, placeholder: 'キーワードで検索', style: 'min-width:200px' });
  const who = h('select', {}, h('option', { value: '' }, '全員の記事'), state.users.map((u) => h('option', { value: u.id, selected: String(u.id) === author }, u.name)));
  const apply = (e) => {
    e?.preventDefault();
    const p = {};
    if (search.value.trim()) p.q = search.value.trim();
    if (who.value) p.author = who.value;
    go('#/blog', p);
  };
  who.addEventListener('change', apply);
  shell([
    h('div', { class: 'row between' }, h('h1', {}, 'ブログ'), h('button', { class: 'primary', onclick: () => go('#/blog/new') }, '＋ 記事を書く')),
    h('form', { class: 'row', style: 'margin-bottom:16px', onsubmit: apply }, search, who, h('button', { type: 'submit' }, '検索')),
    blogs.length
      ? blogs.map((b) =>
          h('a', { class: 'card blog-card', href: `#/blog/${b.id}` },
            h('h2', {}, b.title),
            h('p', { class: 'muted small' }, `${b.author_name || '—'}　${b.created_at.slice(0, 16)}`),
            h('p', { class: 'excerpt' }, b.excerpt.replace(/\s+/g, ' '), b.excerpt.length >= 120 ? '…' : ''),
            h('div', { class: 'small muted' }, `${b.liked ? '❤' : '♡'} いいね ${b.likes}　💬 コメント ${b.comments}`),
          ),
        )
      : h('div', { class: 'card empty' }, word || author ? '該当する記事はありません' : 'まだ記事がありません。最初の記事を書いてみましょう'),
  ]);
}

async function pageBlogDetail(id) {
  const b = await api('GET', `/api/blogs/${id}`);
  const comment = h('textarea', { placeholder: 'コメントを書く', style: 'min-height:70px', maxlength: 2000 });
  shell([
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('a', { href: '#/blog' }, '← 一覧へ戻る')),
    h('article', { class: 'card' },
      h('h1', {}, b.title),
      h('p', { class: 'muted small' },
        h('a', { href: `#/blog?author=${b.author_id}` }, b.author_name || '—'),
        `　${b.created_at.slice(0, 16)}${b.updated_at !== b.created_at ? `（更新 ${b.updated_at.slice(0, 16)}）` : ''}`,
      ),
      h('div', { class: 'pre blog-body' }, b.body),
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { class: b.liked ? 'primary' : '', onclick: guard(async () => (await api('POST', `/api/blogs/${id}/like`), route())) }, `${b.liked ? '❤' : '♡'} いいね ${b.likers.length}`),
        b.likers.length ? h('span', { class: 'muted small' }, b.likers.join('、')) : null,
        h('span', { class: 'spacer' }),
        b.can_edit ? h('button', { onclick: () => go(`#/blog/${id}/edit`) }, '編集') : null,
        b.can_edit ? h('button', { class: 'danger', onclick: guard(async () => {
          if (!(await confirmDialog('この記事を削除しますか？', '削除', true))) return;
          await api('DELETE', `/api/blogs/${id}`);
          toast('削除しました');
          go('#/blog');
        }) }, '削除') : null,
      ),
    ),
    h('div', { class: 'card' },
      h('h2', {}, `コメント（${b.comments.length}）`),
      b.comments.map((m) =>
        h('div', { class: 'comment' },
          h('div', { class: 'row small' }, h('b', {}, m.author_name || '—'), h('span', { class: 'muted' }, m.created_at.slice(0, 16)),
            m.can_delete ? h('button', { class: 'link small', onclick: guard(async () => {
              if (!(await confirmDialog('このコメントを削除しますか？', '削除', true))) return;
              await api('DELETE', `/api/blog-comments/${m.id}`);
              route();
            }) }, '削除') : null),
          h('div', { class: 'pre' }, m.body),
        ),
      ),
      comment,
      h('button', { class: 'primary', style: 'margin-top:8px', onclick: guard(async () => {
        await api('POST', `/api/blogs/${id}/comments`, { body: comment.value });
        route();
      }) }, 'コメントする'),
    ),
  ]);
}

async function pageBlogForm(id) {
  const b = id ? await api('GET', `/api/blogs/${id}`) : null;
  const err = h('div');
  const title = h('input', { type: 'text', value: b?.title || '', maxlength: 100 });
  const body = h('textarea', { style: 'min-height:320px', maxlength: 30000 }, b?.body || '');
  const submit = guard(async () => {
    err.replaceChildren();
    try {
      const data = { title: title.value, body: body.value };
      const r = b ? await api('PUT', `/api/blogs/${id}`, data) : await api('POST', '/api/blogs', data);
      toast(b ? '更新しました' : '投稿しました');
      go(`#/blog/${b ? id : r.id}`);
    } catch (e) {
      err.replaceChildren(h('div', { class: 'alert error' }, e.message));
    }
  });
  shell([
    h('h1', {}, b ? '記事の編集' : '記事を書く'),
    h('div', { class: 'card', style: 'max-width:820px' },
      err,
      field('タイトル', title, true),
      field('本文', body, true),
      h('p', { class: 'muted small' }, '日々の業務の気づき、成功事例、物件・地域の情報、自己紹介など、社内で共有したいことを気軽に書いてください。'),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { onclick: () => history.back() }, 'キャンセル'), h('button', { class: 'primary', onclick: submit }, b ? '更新する' : '投稿する')),
    ),
  ]);
}

// ================= チャット =================
function chatRoomForm(room) {
  const err = h('div');
  const name = h('input', { type: 'text', value: room?.name || '', maxlength: 50 });
  const picker = userPicker(room ? room.members.map((m) => m.id) : [state.me.id]);
  const close = openModal(room ? 'グループの設定' : 'グループを作る',
    h('div', {}, err, field('グループ名', name, true), h('div', { class: 'field' }, h('b', { class: 'small' }, 'メンバー（自分は自動で参加します）'), picker.el)),
    [
      h('button', { onclick: () => close() }, 'キャンセル'),
      h('button', { class: 'primary', onclick: guard(async () => {
        try {
          const data = { name: name.value, member_ids: picker.value() };
          if (room) {
            await api('PUT', `/api/chat/rooms/${room.id}`, data);
            close();
            route();
          } else {
            const r = await api('POST', '/api/chat/rooms', data);
            close();
            go(`#/chat/${r.id}`);
          }
        } catch (e) {
          err.replaceChildren(h('div', { class: 'alert error' }, e.message));
        }
      }) }, room ? '保存' : '作成'),
    ],
  );
}

function chatDirectForm() {
  const search = h('input', { type: 'search', placeholder: '名前で絞り込み', style: 'width:100%;margin-bottom:8px' });
  const list = h('div', { class: 'picker', style: 'max-height:360px' });
  let close;
  const render = () => {
    const q = search.value.trim();
    list.replaceChildren(
      ...state.users
        .filter((u) => u.id !== state.me.id && (!q || u.name.includes(q)))
        .map((u) => h('button', { class: 'link', style: 'display:block;padding:6px 0;text-align:left;width:100%', onclick: guard(async () => {
          const r = await api('POST', '/api/chat/direct', { user_id: u.id });
          close();
          go(`#/chat/${r.id}`);
        }) }, u.name, u.department ? h('span', { class: 'muted small' }, `（${u.department}）`) : null)),
    );
  };
  search.addEventListener('input', render);
  render();
  close = openModal('1対1で話す', h('div', {}, search, list));
}

async function pageChat(roomId) {
  const roomList = h('div', { class: 'chat-rooms' });
  const renderRooms = (rooms) => roomList.replaceChildren(
    h('div', { class: 'row', style: 'padding:8px' },
      h('button', { class: 'small primary', onclick: chatDirectForm }, '＋ 1対1'),
      h('button', { class: 'small', onclick: () => chatRoomForm() }, '＋ グループ'),
    ),
    rooms.length
      ? h('div', {}, rooms.map((r) =>
          h('a', { href: `#/chat/${r.id}`, class: `chat-room${String(r.id) === roomId ? ' active' : ''}` },
            h('div', { class: 'row between' },
              h('b', {}, r.name, r.is_direct ? null : h('span', { class: 'muted small' }, ` (${r.member_count})`), r.muted ? ' 🔕' : null),
              r.unread ? h('span', { class: 'badge' }, r.unread) : null,
            ),
            h('div', { class: 'muted small ellipsis' }, r.last_body || 'メッセージはまだありません'),
          ),
        ))
      : h('div', { class: 'empty', style: 'padding:12px' }, 'トークはまだありません'),
  );
  const loadRooms = async () => renderRooms(await api('GET', '/api/chat/rooms'));
  await loadRooms();

  if (!roomId) {
    shell([h('h1', {}, 'チャット'), h('div', { class: 'chat' }, roomList, h('div', { class: 'chat-main empty-main' }, '左の一覧からトークを選ぶか、新しく始めてください'))]);
    state.chatTimer = setInterval(() => loadRooms().catch(() => {}), 5000);
    return;
  }

  const room = await api('GET', `/api/chat/rooms/${roomId}`);
  const log = h('div', { class: 'chat-log' });
  let lastId = 0;
  let firstId = 0;
  let lastDay = '';
  const stickToBottom = () => {
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 400) log.scrollTop = log.scrollHeight;
  };
  const fileEl = (f) =>
    f.is_image
      ? h('a', { class: 'chat-image', href: `/api/chat/files/${f.id}`, target: '_blank', rel: 'noopener', title: f.name },
          h('img', { src: `/api/chat/files/${f.id}`, alt: f.name, loading: 'lazy', onload: stickToBottom }))
      : h('a', { class: 'chat-file', href: `/api/chat/files/${f.id}?download=1`, download: f.name },
          fileBadge(f.name.split('.').pop().toLowerCase()), h('span', { class: 'name' }, f.name), h('span', { class: 'muted small' }, fmtSize(f.size)));
  const msgEl = (m) => {
    const mine = m.user_id === state.me.id;
    return h('div', { class: `msg${mine ? ' mine' : ''}`, 'data-id': m.id },
      mine ? null : h('div', { class: 'who small' }, m.user_name || '（退職者等）'),
      m.file ? fileEl(m.file) : null,
      m.body ? h('div', { class: 'bubble pre' }, m.body) : null,
      h('div', { class: 'meta small muted' }, m.created_at.slice(11, 16),
        mine ? h('button', { class: 'link small', onclick: guard(async () => {
          if (!(await confirmDialog('このメッセージを削除しますか？', '削除', true))) return;
          await api('DELETE', `/api/chat/messages/${m.id}`);
          route();
        }) }, ' 削除') : null),
    );
  };
  const appendMessages = (msgs) => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    for (const m of msgs) {
      const day = m.created_at.slice(0, 10);
      if (day !== lastDay) {
        log.append(h('div', { class: 'day-sep small muted' }, fmtDate(day)));
        lastDay = day;
      }
      log.append(msgEl(m));
      lastId = Math.max(lastId, m.id);
      if (!firstId) firstId = m.id;
    }
    if (atBottom || msgs.some((m) => m.user_id === state.me.id)) log.scrollTop = log.scrollHeight;
  };
  const first = await api('GET', `/api/chat/rooms/${roomId}/messages`);
  const more = h('button', { class: 'small', hidden: !first.has_more, onclick: guard(async () => {
    const older = await api('GET', `/api/chat/rooms/${roomId}/messages?before=${firstId}`);
    const h0 = log.scrollHeight;
    const frag = document.createDocumentFragment();
    let d = '';
    for (const m of older.messages) {
      const day = m.created_at.slice(0, 10);
      if (day !== d) frag.append(h('div', { class: 'day-sep small muted' }, fmtDate(day)));
      d = day;
      frag.append(msgEl(m));
    }
    if (older.messages.length) firstId = older.messages[0].id;
    log.prepend(frag);
    log.prepend(more);
    more.hidden = !older.has_more;
    log.scrollTop = log.scrollHeight - h0;
  }) }, 'さらに前を読み込む');
  log.append(more);

  const input = h('textarea', { class: 'chat-input', placeholder: 'メッセージを入力（Enter で送信、Shift+Enter で改行）。ファイルはドラッグ＆ドロップや貼り付けでも送れます', maxlength: 5000 });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  const uploading = h('div', { class: 'small muted uploading', hidden: true });
  // 選んだファイルを1つずつ送信する。入力中の文章は最初のファイルに添える
  const sendFiles = guard(async (files) => {
    files = [...files];
    if (!files.length) return;
    let body = input.value.trim();
    input.value = '';
    try {
      for (const [i, f] of files.entries()) {
        uploading.hidden = false;
        uploading.textContent = `送信中… ${f.name}（${i + 1}/${files.length}）`;
        const qs = new URLSearchParams({ name: f.name || `画像-${Date.now()}.png`, body });
        const res = await fetch(`/api/chat/rooms/${roomId}/files?${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': state.me.csrf },
          body: f,
          credentials: 'same-origin',
        });
        if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
        body = '';
      }
    } finally {
      uploading.hidden = true;
      fileInput.value = '';
      if (body) input.value = body;
      await poll();
    }
  });
  fileInput.addEventListener('change', () => sendFiles(fileInput.files));
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      sendFiles(files);
    }
  });
  const send = guard(async () => {
    if (!input.value.trim()) return;
    const body = input.value;
    input.value = '';
    try {
      await api('POST', `/api/chat/rooms/${roomId}/messages`, { body });
    } catch (e) {
      input.value = body;
      throw e;
    }
    await poll();
  });
  // 日本語入力の変換確定の Enter では送信しない
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  });
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const r = await api('GET', `/api/chat/rooms/${roomId}/messages?after=${lastId}`);
      if (r.messages.length) appendMessages(r.messages);
      // 他のトークの新着・未読も一覧に反映する
      await loadRooms();
    } catch {
      /* 一時的な通信エラーは次回に再試行 */
    } finally {
      polling = false;
    }
  };

  shell([
    h('h1', {}, 'チャット'),
    h('div', { class: 'chat' },
      roomList,
      h('div', { class: 'chat-main' },
        h('div', { class: 'chat-head row between' },
          h('div', {}, h('b', {}, room.name), room.is_direct ? null : h('span', { class: 'muted small' }, `　${room.members.map((m) => m.name).join('、')}`)),
          h('div', { class: 'row', style: 'flex-wrap:nowrap' },
            h('button', { class: 'small', title: 'このトークの通知', onclick: guard(async () => {
              const r = await api('PUT', `/api/chat/rooms/${roomId}/mute`, { muted: !room.muted });
              toast(r.muted ? 'このトークの通知をオフにしました' : 'このトークの通知をオンにしました');
              route();
            }) }, room.muted ? '🔕 通知オフ' : '🔔 通知オン'),
            room.is_direct
            ? null
            : [
                h('button', { class: 'small', onclick: () => chatRoomForm(room) }, '設定'),
                h('button', { class: 'small danger', onclick: guard(async () => {
                  if (!(await confirmDialog(`「${room.name}」から退出しますか？`, '退出', true))) return;
                  await api('POST', `/api/chat/rooms/${roomId}/leave`);
                  go('#/chat');
                }) }, '退出'),
              ],
          ),
        ),
        log,
        uploading,
        h('div', { class: 'chat-send' },
          h('button', { class: 'attach', title: 'ファイルを添付', 'aria-label': 'ファイルを添付', onclick: () => fileInput.click() }, '📎'),
          fileInput, input, h('button', { class: 'primary', onclick: send }, '送信')),
      ),
    ),
  ]);
  // トーク画面へのドラッグ＆ドロップで送信
  const main = log.parentElement;
  main.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      main.classList.add('dropping');
    }
  });
  main.addEventListener('dragleave', (e) => e.target === main && main.classList.remove('dropping'));
  main.addEventListener('drop', (e) => {
    e.preventDefault();
    main.classList.remove('dropping');
    sendFiles(e.dataTransfer.files);
  });
  appendMessages(first.messages);
  log.scrollTop = log.scrollHeight;
  if (!room.muted) offerPush(main);
  input.focus();
  await loadRooms();
  refreshCounts();
  state.chatTimer = setInterval(poll, 4000);
}

// ================= 日程調整 =================
const POLL_STATUS = { open: ['回答受付中', 'pending'], decided: ['決定済み', 'approved'], closed: ['中止', 'withdrawn'] };
const ANS = { yes: '○', maybe: '△', no: '×' };

async function pagePolls() {
  const polls = await api('GET', '/api/polls');
  shell([
    h('div', { class: 'row between' }, h('h1', {}, '日程調整'), h('button', { class: 'primary', onclick: () => go('#/poll/new') }, '＋ 日程調整を作る')),
    h('p', { class: 'muted small' }, '候補日時を出して参加者に ○△× で回答してもらい、決まった日時をそのままスケジュールに登録できます。'),
    polls.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', {}, h('tr', {}, ['件名', '主催者', '状況', '回答', '日時'].map((t) => h('th', {}, t)))),
          h('tbody', {}, polls.map((p) =>
            h('tr', { class: 'clickable', onclick: () => go(`#/poll/${p.id}`) },
              h('td', { class: p.status === 'open' && p.my_answered === false && p.organizer_id !== state.me.id ? 'unread' : '' },
                p.status === 'open' && p.my_answered === false && p.organizer_id !== state.me.id ? h('span', { class: 'dot' }) : null, p.title),
              h('td', {}, p.organizer_name || '—'),
              h('td', {}, h('span', { class: `status ${POLL_STATUS[p.status][1]}` }, POLL_STATUS[p.status][0])),
              h('td', {}, `${p.answered_count}/${p.member_count}名`),
              h('td', { class: 'small' }, p.decided_at ? `決定: ${fmtDateTime(p.decided_at)}` : p.first_slot ? `${fmtDateTime(p.first_slot)}〜` : '—'),
            ),
          )),
        ))
      : h('div', { class: 'card empty' }, '日程調整はありません'),
  ]);
}

async function pagePollForm() {
  const err = h('div');
  const title = h('input', { type: 'text', maxlength: 100 });
  const location_ = h('input', { type: 'text', maxlength: 100 });
  const memo = h('textarea', { maxlength: 5000, style: 'min-height:80px' });
  const picker = userPicker([state.me.id]);
  const slotsBox = h('div');
  const tomorrow = addDays(today(), 1);
  const slots = [{ date: tomorrow, start: '10:00', end: '11:00' }];
  const renderSlots = () =>
    slotsBox.replaceChildren(
      ...slots.map((s, i) =>
        h('div', { class: 'dt', style: 'margin-bottom:6px' },
          h('span', { class: 'muted small', style: 'width:48px' }, `候補${i + 1}`),
          h('input', { type: 'date', value: s.date, onchange: (e) => (s.date = e.target.value) }),
          h('input', { type: 'time', value: s.start, step: 300, onchange: (e) => (s.start = e.target.value) }),
          '〜',
          h('input', { type: 'time', value: s.end, step: 300, onchange: (e) => (s.end = e.target.value) }),
          slots.length > 1 ? h('button', { type: 'button', class: 'small', onclick: () => (slots.splice(i, 1), renderSlots()) }, '削除') : null,
        ),
      ),
      slots.length < 30
        ? h('div', { class: 'row' },
            h('button', { type: 'button', class: 'small', onclick: () => {
              const last = slots[slots.length - 1];
              slots.push({ ...last, date: addDays(last.date, 1) });
              renderSlots();
            } }, '＋ 翌日の同じ時間を追加'),
            h('button', { type: 'button', class: 'small', onclick: () => {
              const last = slots[slots.length - 1];
              slots.push({ ...last });
              renderSlots();
            } }, '＋ 候補を追加'),
          )
        : null,
    );
  renderSlots();
  const submit = guard(async () => {
    err.replaceChildren();
    try {
      const r = await api('POST', '/api/polls', {
        title: title.value,
        location: location_.value,
        memo: memo.value,
        member_ids: picker.value(),
        slots: slots.map((s) => ({ start_at: `${s.date} ${s.start}`, end_at: `${s.date} ${s.end}` })),
      });
      toast('日程調整を作成しました');
      go(`#/poll/${r.id}`);
    } catch (e) {
      err.replaceChildren(h('div', { class: 'alert error' }, e.message));
      window.scrollTo(0, 0);
    }
  });
  shell([
    h('h1', {}, '日程調整を作る'),
    h('div', { class: 'card', style: 'max-width:820px' },
      err,
      field('件名', title, true),
      h('div', { class: 'field' }, h('b', { class: 'small' }, '候補日時'), h('div', { style: 'margin-top:6px' }, slotsBox)),
      h('div', { class: 'field', style: 'margin-top:12px' }, h('b', { class: 'small' }, '参加者（回答してもらう人）'), picker.el),
      h('div', { style: 'margin-top:12px' }, field('場所', location_)),
      field('メモ', memo),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { onclick: () => history.back() }, 'キャンセル'), h('button', { class: 'primary', onclick: submit }, '作成する')),
    ),
  ]);
}

async function pagePollDetail(id) {
  const p = await api('GET', `/api/polls/${id}`);
  const key = (s, u) => `${s}:${u}`;
  const mine = {};
  for (const s of p.slots) mine[s.id] = p.answers[key(s.id, state.me.id)] || '';
  const canAnswer = p.is_member && p.status === 'open';
  const tally = (s) => {
    const c = { yes: 0, maybe: 0, no: 0 };
    for (const m of p.members) {
      const a = p.answers[key(s.id, m.id)];
      if (a) c[a]++;
    }
    return c;
  };
  const best = Math.max(0, ...p.slots.map((s) => tally(s).yes));
  const myComment = h('input', { type: 'text', maxlength: 500, placeholder: 'コメント（任意）', value: p.members.find((m) => m.id === state.me.id)?.comment || '', style: 'flex:1;min-width:200px' });
  const ansButtons = (s) =>
    h('div', { class: 'ans-buttons' },
      Object.entries(ANS).map(([v, label]) =>
        h('button', { type: 'button', class: `ans ${v}${mine[s.id] === v ? ' on' : ''}`, onclick: (e) => {
          mine[s.id] = v;
          e.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
        } }, label),
      ),
    );
  const decide = (s) => {
    const facSel = new Set();
    const close = openModal('日時の決定',
      h('div', {},
        h('p', {}, `「${p.title}」を ${fmtDate(s.start_at.slice(0, 10))} ${s.start_at.slice(11)}〜${s.end_at.slice(11)} に決定し、参加者全員（${p.members.length}名）のスケジュールに登録します。`),
        state.facilities.length
          ? h('div', { class: 'field' }, h('b', { class: 'small' }, '施設も予約する場合は選択'),
              h('div', { class: 'picker' }, state.facilities.map((f) => h('label', {}, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? facSel.add(f.id) : facSel.delete(f.id)) }), f.name))))
          : null,
      ),
      [
        h('button', { onclick: () => close() }, 'キャンセル'),
        h('button', { class: 'primary', onclick: guard(async () => {
          await api('POST', `/api/polls/${id}/decide`, { slot_id: s.id, facility_ids: [...facSel] });
          close();
          toast('決定し、スケジュールに登録しました');
          route();
        }) }, '決定する'),
      ],
    );
  };
  const status = POLL_STATUS[p.status];
  const decidedSlot = p.slots.find((s) => s.id === p.decided_slot_id);
  shell([
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('a', { href: '#/poll' }, '← 一覧へ戻る')),
    h('div', { class: 'row', style: 'margin-bottom:8px' }, h('h1', { style: 'margin:0' }, p.title), h('span', { class: `status ${status[1]}` }, status[0])),
    h('p', { class: 'muted small' }, `主催: ${p.organizer_name || '—'}${p.location ? `　場所: ${p.location}` : ''}`),
    p.memo ? h('div', { class: 'card pre' }, p.memo) : null,
    decidedSlot
      ? h('div', { class: 'alert ok' }, `${fmtDate(decidedSlot.start_at.slice(0, 10))} ${decidedSlot.start_at.slice(11)}〜${decidedSlot.end_at.slice(11)} に決定しました。`,
          p.event_id ? h('button', { class: 'link', onclick: () => openEventDetail(p.event_id) }, '　登録された予定を見る') : null)
      : null,
    h('div', { class: 'table-wrap' },
      h('table', { class: 'list poll-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, '候補日時'),
          h('th', {}, '○ / △ / ×'),
          canAnswer ? h('th', {}, 'あなたの回答') : null,
          p.members.map((m) => h('th', { class: 'center' }, m.name)),
          p.is_organizer && p.status === 'open' ? h('th', {}, '') : null,
        )),
        h('tbody', {}, p.slots.map((s) => {
          const t = tally(s);
          return h('tr', { class: s.id === p.decided_slot_id ? 'decided' : t.yes === best && best > 0 && p.status === 'open' ? 'best' : '' },
            h('td', { style: 'white-space:nowrap' }, `${fmtDate(s.start_at.slice(0, 10))} ${s.start_at.slice(11)}〜${s.end_at.slice(11)}`),
            h('td', { style: 'white-space:nowrap' }, `${t.yes} / ${t.maybe} / ${t.no}`),
            canAnswer ? h('td', {}, ansButtons(s)) : null,
            p.members.map((m) => {
              const a = p.answers[key(s.id, m.id)];
              return h('td', { class: `center ans-cell ${a || ''}` },
                a ? ANS[a] : h('span', { class: 'muted' }, '—'),
                p.busy[key(s.id, m.id)] ? h('div', { class: 'busy small' }, '予定あり') : null,
              );
            }),
            p.is_organizer && p.status === 'open' ? h('td', {}, h('button', { class: 'small primary', onclick: () => decide(s) }, 'この日時に決定')) : null,
          );
        })),
        h('tfoot', {}, h('tr', {},
          h('td', { colspan: canAnswer ? 3 : 2, class: 'muted small' }, 'コメント'),
          p.members.map((m) => h('td', { class: 'small' }, m.answered_at ? m.comment || '' : h('span', { class: 'muted' }, '未回答'))),
          p.is_organizer && p.status === 'open' ? h('td', {}) : null,
        )),
      ),
    ),
    h('p', { class: 'muted small', style: 'margin-top:6px' }, '「予定あり」はその時間に既存の予定が入っていることを示します（内容は表示されません）。'),
    canAnswer
      ? h('div', { class: 'card row', style: 'margin-top:12px' },
          myComment,
          h('button', { class: 'primary', onclick: guard(async () => {
            const answers = Object.fromEntries(Object.entries(mine).filter(([, v]) => v));
            if (Object.keys(answers).length < p.slots.length) {
              if (!(await confirmDialog('未回答の候補があります。このまま送信しますか？', '送信'))) return;
            }
            await api('PUT', `/api/polls/${id}/answer`, { answers, comment: myComment.value });
            toast('回答しました');
            refreshCounts();
            route();
          }) }, '回答を送信'),
        )
      : null,
    p.is_organizer
      ? h('div', { class: 'row', style: 'margin-top:12px' },
          p.status === 'open' ? h('button', { onclick: guard(async () => {
            if (!(await confirmDialog('この日程調整を中止しますか？', '中止する', true))) return;
            await api('POST', `/api/polls/${id}/close`);
            route();
          }) }, '中止する') : null,
          h('button', { class: 'danger', onclick: guard(async () => {
            if (!(await confirmDialog('この日程調整を削除しますか？（登録済みの予定は残ります）', '削除', true))) return;
            await api('DELETE', `/api/polls/${id}`);
            go('#/poll');
          }) }, '削除'),
        )
      : null,
  ]);
}

// ================= テンプレート集 =================
const FILE_KIND = {
  xlsx: 'Excel', xlsm: 'Excel', xlsb: 'Excel', xls: 'Excel', xltx: 'Excel', xltm: 'Excel', csv: 'CSV',
  docx: 'Word', docm: 'Word', doc: 'Word', dotx: 'Word', pptx: 'PowerPoint', pptm: 'PowerPoint', ppt: 'PowerPoint',
  pdf: 'PDF', zip: 'ZIP', txt: 'テキスト', md: 'テキスト', json: 'JSON', py: 'Python', gs: 'GAS', bas: 'VBA', cls: 'VBA', frm: 'VBA', sql: 'SQL',
};
const fileBadge = (e) => (e ? h('span', { class: `fbadge f-${(FILE_KIND[e] || 'other').toLowerCase()}` }, FILE_KIND[e] || e.toUpperCase()) : null);
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const MACRO_NOTE = 'マクロ・プログラムを含む形式です。社内で作成されたものであることを確認してから有効化してください。';

async function uploadTemplateFile(id, file, note) {
  const qs = new URLSearchParams({ name: file.name, note: note || '' });
  const res = await fetch(`/api/templates/${id}/files?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': state.me.csrf },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

async function pageTemplates() {
  const q = query();
  const word = q.get('q') || '';
  const cat = q.get('category') || '';
  const params = new URLSearchParams();
  if (word) params.set('q', word);
  if (cat) params.set('category', cat);
  const list = await api('GET', `/api/templates?${params}`);
  const search = h('input', { type: 'search', value: word, placeholder: '名称・説明で検索', style: 'min-width:220px' });
  const apply = (e) => {
    e?.preventDefault();
    const p = {};
    if (search.value.trim()) p.q = search.value.trim();
    if (cat) p.category = cat;
    go('#/templates', p);
  };
  const catLink = (c, label) => h('a', { href: `#/templates${c ? `?category=${encodeURIComponent(c)}` : ''}`, class: cat === c ? 'active' : '' }, label);
  shell([
    h('div', { class: 'row between' }, h('h1', {}, 'テンプレート集'), h('button', { class: 'primary', onclick: () => go('#/templates/new') }, '＋ テンプレートを登録')),
    h('p', { class: 'muted small' }, '社内で作成した収支シミュレーション、ローン計算、業務自動化のマクロ・スクリプトなどを共有する場所です。更新すると版が上がり、過去の版も残ります。'),
    h('div', { class: 'tabs' }, catLink('', 'すべて'), state.templateCategories.map((c) => catLink(c, c))),
    h('form', { class: 'row', style: 'margin-bottom:16px', onsubmit: apply }, search, h('button', { type: 'submit' }, '検索')),
    list.length
      ? h('div', { class: 'tpl-grid' }, list.map((t) =>
          h('a', { class: 'card tpl-card', href: `#/templates/${t.id}` },
            h('div', { class: 'row' }, fileBadge(t.ext), h('span', { class: 'muted small' }, t.category)),
            h('h2', {}, t.title),
            h('p', { class: 'small excerpt' }, t.excerpt || h('span', { class: 'muted' }, '説明なし')),
            h('div', { class: 'small muted' }, `${t.owner_name || '—'}・v${t.version ?? '-'}・更新 ${t.updated_at.slice(0, 10)}・DL ${t.downloads}回`),
          ),
        ))
      : h('div', { class: 'card empty' }, word || cat ? '該当するテンプレートはありません' : 'まだ登録がありません。最初のテンプレートを登録してください'),
  ]);
}

async function pageTemplateDetail(id) {
  const t = await api('GET', `/api/templates/${id}`);
  const latest = t.files[0];
  const newFile = h('input', { type: 'file' });
  const note = h('input', { type: 'text', placeholder: '変更内容（例: 金利入力欄を追加）', maxlength: 500, style: 'flex:1;min-width:220px' });
  shell([
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('a', { href: '#/templates' }, '← 一覧へ戻る')),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, fileBadge(latest?.ext), h('a', { class: 'small', href: `#/templates?category=${encodeURIComponent(t.category)}` }, t.category)),
      h('h1', { style: 'margin-top:8px' }, t.title),
      h('p', { class: 'muted small' }, `登録: ${t.owner_name || '—'}　更新: ${t.updated_at.slice(0, 16)}　ダウンロード ${t.downloads}回`),
      latest
        ? h('div', { class: 'row', style: 'margin:12px 0' },
            h('a', { class: 'btn primary-btn', href: `/api/template-files/${latest.id}/download`, download: latest.original_name }, `⬇ ダウンロード（v${latest.version}・${fmtSize(latest.size)}）`),
            h('span', { class: 'small muted' }, latest.original_name),
          )
        : h('div', { class: 'alert error' }, 'ファイルがまだ登録されていません'),
      latest?.has_macro ? h('div', { class: 'alert info small' }, MACRO_NOTE) : null,
      t.description ? [h('h3', { style: 'margin-top:16px' }, '説明'), h('div', { class: 'pre' }, t.description)] : null,
      t.usage ? [h('h3', { style: 'margin-top:16px' }, '使い方・注意事項'), h('div', { class: 'pre' }, t.usage)] : null,
      t.can_edit
        ? h('div', { class: 'row', style: 'margin-top:16px' },
            h('button', { onclick: () => go(`#/templates/${id}/edit`) }, '説明を編集'),
            h('button', { class: 'danger', onclick: guard(async () => {
              if (!(await confirmDialog(`「${t.title}」を削除しますか？\n過去の版を含むすべてのファイルが削除されます。`, '削除', true))) return;
              await api('DELETE', `/api/templates/${id}`);
              toast('削除しました');
              go('#/templates');
            }) }, '削除'),
          )
        : null,
    ),
    t.can_edit
      ? h('div', { class: 'card' },
          h('h2', {}, '新しい版をアップロード'),
          h('div', { class: 'row' }, newFile, note, h('button', { class: 'primary', onclick: guard(async (e) => {
            const f = newFile.files[0];
            if (!f) return toast('ファイルを選択してください', 'error');
            e.target.disabled = true;
            try {
              const r = await uploadTemplateFile(id, f, note.value);
              toast(`v${r.version} をアップロードしました`);
              route();
            } finally {
              e.target.disabled = false;
            }
          }) }, 'アップロード')),
        )
      : null,
    h('div', { class: 'card' },
      h('h2', {}, '版の履歴'),
      t.files.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
            h('thead', {}, h('tr', {}, ['版', 'ファイル', 'サイズ', '変更内容', '登録', ''].map((x) => h('th', {}, x)))),
            h('tbody', {}, t.files.map((f, i) =>
              h('tr', {},
                h('td', {}, `v${f.version}`, i === 0 ? h('span', { class: 'status approved', style: 'margin-left:6px' }, '最新') : null),
                h('td', {}, h('a', { href: `/api/template-files/${f.id}/download`, download: f.original_name }, f.original_name)),
                h('td', { class: 'small' }, fmtSize(f.size)),
                h('td', { class: 'small pre' }, f.note || '—'),
                h('td', { class: 'small muted', style: 'white-space:nowrap' }, `${f.uploaded_by_name || '—'} ${f.uploaded_at.slice(0, 16)}`),
                h('td', {}, t.can_edit && i > 0 ? h('button', { class: 'small danger', onclick: guard(async () => {
                  if (!(await confirmDialog(`v${f.version} のファイルを削除しますか？`, '削除', true))) return;
                  await api('DELETE', `/api/template-files/${f.id}`);
                  route();
                }) }, '削除') : null),
              ),
            )),
          ))
        : h('div', { class: 'empty' }, 'ファイルはまだありません'),
    ),
  ]);
}

async function pageTemplateForm(id) {
  const t = id ? await api('GET', `/api/templates/${id}`) : null;
  const err = h('div');
  const title = h('input', { type: 'text', value: t?.title || '', maxlength: 100, placeholder: '例: 一棟収益物件 収支シミュレーション' });
  const category = h('select', {}, h('option', { value: '' }, '選択してください'), state.templateCategories.map((c) => h('option', { value: c, selected: t?.category === c }, c)));
  const description = h('textarea', { maxlength: 5000, style: 'min-height:100px', placeholder: '何ができるか、どんな場面で使うか' }, t?.description || '');
  const usage = h('textarea', { maxlength: 10000, style: 'min-height:140px', placeholder: '入力する項目、前提条件、注意点など' }, t?.usage || '');
  const file = h('input', { type: 'file' });
  const submit = guard(async (e) => {
    err.replaceChildren();
    const data = { title: title.value, category: category.value, description: description.value, usage: usage.value };
    if (!t && !file.files[0]) return err.replaceChildren(h('div', { class: 'alert error' }, 'ファイルを選択してください'));
    e.target.disabled = true;
    try {
      if (t) {
        await api('PUT', `/api/templates/${id}`, data);
        toast('更新しました');
        return go(`#/templates/${id}`);
      }
      const r = await api('POST', '/api/templates', data);
      try {
        await uploadTemplateFile(r.id, file.files[0], '初版');
      } catch (upErr) {
        // ファイルが受け付けられなければ、作りかけの登録は取り消す
        await api('DELETE', `/api/templates/${r.id}`).catch(() => {});
        throw upErr;
      }
      toast('登録しました');
      go(`#/templates/${r.id}`);
    } catch (ex) {
      err.replaceChildren(h('div', { class: 'alert error' }, ex.message));
    } finally {
      e.target.disabled = false;
    }
  });
  shell([
    h('h1', {}, t ? 'テンプレートの編集' : 'テンプレートの登録'),
    h('div', { class: 'card', style: 'max-width:820px' },
      err,
      field('名称', title, true),
      field('分類', category, true),
      t ? null : field('ファイル', file, true),
      t ? null : h('p', { class: 'muted small' }, '対応形式: Excel・Word・PowerPoint・PDF・CSV・ZIP・テキスト・Python・GAS・VBA など（実行ファイルは不可）。上限 50MB。'),
      field('説明', description),
      field('使い方・注意事項', usage),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { onclick: () => history.back() }, 'キャンセル'), h('button', { class: 'primary', onclick: submit }, t ? '更新する' : '登録する')),
    ),
  ]);
}

// ================= プッシュ通知 =================
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function pushSubscribe() {
  const { publicKey } = await api('GET', '/api/push/key');
  if (!publicKey) throw new Error('通知はサーバー側で無効になっています');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('通知が許可されませんでした。ブラウザの設定でこのサイトの通知を許可してください');
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  await api('POST', '/api/push/subscribe', sub.toJSON());
}

async function pushUnsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

function pushHelp() {
  if (!window.isSecureContext) return 'HTTPS で接続している場合のみ通知を利用できます（システム管理者にご確認ください）。';
  if (isIos() && !isStandalone()) return 'iPhone・iPad では、Safari の共有ボタン →「ホーム画面に追加」でアプリとして追加し、そこから開くと通知を受け取れます（iOS 16.4 以降）。';
  if (!pushSupported()) return 'このブラウザは通知に対応していません。Chrome・Edge・Safari の最新版をお使いください。';
  return '';
}

async function pushCard() {
  const help = pushHelp();
  const sub = help ? null : await currentSubscription().catch(() => null);
  const status = h('p', {}, help ? help : sub ? '✅ この端末で通知を受け取ります。' : 'この端末では通知を受け取っていません。');
  return h('div', { class: 'card', style: 'max-width:480px' },
    h('h2', {}, '通知'),
    h('p', { class: 'small muted' }, 'チャットの新着メッセージを、ブラウザやアプリを閉じていてもこの端末に通知します。端末（PC・スマホ）ごとに設定してください。トークごとの通知オン/オフはチャット画面の 🔔 から切り替えられます。'),
    status,
    help
      ? null
      : h('div', { class: 'row' },
          sub
            ? [
                h('button', { onclick: guard(async () => (await api('POST', '/api/push/test'), toast('テスト通知を送りました'))) }, 'テスト通知を送る'),
                h('button', { class: 'danger', onclick: guard(async () => (await pushUnsubscribe(), toast('この端末の通知を停止しました'), route())) }, '通知を停止'),
              ]
            : h('button', { class: 'primary', onclick: guard(async () => (await pushSubscribe(), toast('通知をオンにしました'), route())) }, 'この端末で通知を受け取る'),
        ),
  );
}

// チャット画面で、まだ通知を設定していない端末に案内を出す
async function offerPush(container) {
  try {
    if (pushHelp() || (await currentSubscription()) || Notification.permission === 'denied') return;
    if (localStorage.getItem('gw_push_dismissed')) return;
  } catch {
    return;
  }
  const bar = h('div', { class: 'push-offer small' },
    '🔔 新着メッセージを通知で受け取れます。',
    h('button', { class: 'small primary', onclick: guard(async () => (await pushSubscribe(), bar.remove(), toast('通知をオンにしました'))) }, '通知をオンにする'),
    h('button', { class: 'small link', onclick: () => {
      try { localStorage.setItem('gw_push_dismissed', '1'); } catch { /* 保存できなくても閉じる */ }
      bar.remove();
    } }, '今はしない'),
  );
  container.insertBefore(bar, container.children[1] || null);
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
    await pushCard(),
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
  clearInterval(state.chatTimer);
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
      case 'blog':
        if (parts[1] === 'new') return await pageBlogForm();
        if (parts[1] && parts[2] === 'edit') return await pageBlogForm(parts[1]);
        if (parts[1]) return await pageBlogDetail(parts[1]);
        return await pageBlog();
      case 'chat': return await pageChat(parts[1]);
      case 'templates':
        if (parts[1] === 'new') return await pageTemplateForm();
        if (parts[1] && parts[2] === 'edit') return await pageTemplateForm(parts[1]);
        if (parts[1]) return await pageTemplateDetail(parts[1]);
        return await pageTemplates();
      case 'poll':
        if (parts[1] === 'new') return await pagePollForm();
        if (parts[1]) return await pagePollDetail(parts[1]);
        return await pagePolls();
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
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
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
