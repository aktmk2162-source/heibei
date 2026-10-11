import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { bootstrapAdmin, createApp } from '../lib/app.mjs';
import { openDb } from '../lib/db.mjs';

let server;
let base;
let db;

// Cookie と CSRF トークンを保持する簡易クライアント
class Client {
  cookie = '';
  csrf = '';

  async req(method, path, body) {
    const headers = { cookie: this.cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }

  async login(loginId, password) {
    const r = await this.req('POST', '/api/login', { login_id: loginId, password });
    if (r.status === 200) this.csrf = r.data.csrf;
    return r;
  }
}

const NEW_PW = 'Passw0rd-Strong';
let admin;
const ids = {};

async function activate(client, loginId, initial) {
  const r = await client.login(loginId, initial);
  assert.equal(r.status, 200);
  assert.equal(r.data.must_change_password, true);
  const blocked = await client.req('GET', '/api/users');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'must_change_password');
  assert.equal((await client.req('POST', '/api/me/password', { current: initial, next: NEW_PW })).status, 200);
  return client;
}

before(async () => {
  db = openDb(':memory:');
  const boot = bootstrapAdmin(db, { loginId: 'admin', password: 'Initial-Pass1' });
  assert.ok(boot);
  assert.equal(bootstrapAdmin(db), null, '2回目は作成しない');
  server = createServer(createApp(db, { log: { error: () => {} } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await activate(new Client(), 'admin', 'Initial-Pass1');
});

after(() => {
  server.close();
  db.close();
});

describe('認証', () => {
  test('未ログインでは API を利用できない', async () => {
    const r = await new Client().req('GET', '/api/users');
    assert.equal(r.status, 401);
  });

  test('パスワード違いは拒否し、試行を繰り返すと制限される', async () => {
    const c = new Client();
    for (let i = 0; i < 10; i++) assert.equal((await c.login('admin', 'wrong')).status, 401);
    assert.equal((await c.login('admin', 'wrong')).status, 429);
  });

  test('CSRF トークンがない更新操作は拒否する', async () => {
    const c = new Client();
    c.cookie = admin.cookie;
    const r = await c.req('POST', '/api/todos', { title: 'x' });
    assert.equal(r.status, 403);
  });

  test('弱いパスワードには変更できない', async () => {
    const r = await admin.req('POST', '/api/me/password', { current: NEW_PW, next: 'short1' });
    assert.equal(r.status, 400);
  });

  test('静的ファイルにセキュリティヘッダーが付く', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    for (const p of ['/../server.mjs', '/%2e%2e/server.mjs', '/..%2fserver.mjs']) {
      const r = await fetch(base + p);
      assert.doesNotMatch(await r.text(), /createServer/, `${p} でソースが漏れない`);
    }
  });
});

describe('マスタ管理', () => {
  test('部署・施設・ユーザーを登録できる', async () => {
    ids.sales = (await admin.req('POST', '/api/admin/departments', { name: '営業部', sort: 1 })).data.id;
    ids.roomA = (await admin.req('POST', '/api/admin/facilities', { name: '会議室A', capacity: 8 })).data.id;
    ids.roomB = (await admin.req('POST', '/api/admin/facilities', { name: '会議室B' })).data.id;
    const u = await admin.req('POST', '/api/admin/users', { login_id: 'yamada', name: '山田 太郎', department_id: ids.sales });
    assert.equal(u.status, 200);
    ids.yamada = u.data.id;
    ids.yamadaClient = await activate(new Client(), 'yamada', u.data.initial_password);
    const dup = await admin.req('POST', '/api/admin/users', { login_id: 'YAMADA', name: '重複' });
    assert.equal(dup.status, 409);
  });

  test('CSV でユーザーを一括登録できる（部署は自動作成）', async () => {
    const csv = 'ログインID,氏名,メール,部署,権限\r\nsato,佐藤 花子,sato@example.com,管理部,member\r\n"suzuki","鈴木, 一郎",,管理部,\r\nyamada,重複,,,\r\n';
    const r = await admin.req('POST', '/api/admin/users/import', { csv });
    assert.equal(r.status, 200);
    assert.equal(r.data.created.length, 2);
    assert.equal(r.data.skipped.length, 1);
    const users = (await admin.req('GET', '/api/users')).data;
    assert.ok(users.find((u) => u.name === '鈴木, 一郎' && u.department === '管理部'));
    ids.sato = users.find((u) => u.login_id === 'sato').id;
    ids.suzuki = users.find((u) => u.login_id === 'suzuki').id;
    ids.satoClient = await activate(new Client(), 'sato', r.data.created[0].initial_password);
  });

  test('一般ユーザーは管理 API を使えない', async () => {
    const r = await ids.yamadaClient.req('GET', '/api/admin/users');
    assert.equal(r.status, 403);
  });

  test('最後の管理者は降格できない', async () => {
    const me = (await admin.req('GET', '/api/me')).data;
    const r = await admin.req('PUT', `/api/admin/users/${me.id}`, { login_id: 'admin', name: '管理者', role: 'member' });
    assert.equal(r.status, 400);
  });

  test('無効化したユーザーはログインできない', async () => {
    const reset = await admin.req('POST', `/api/admin/users/${ids.suzuki}/reset-password`);
    await admin.req('PUT', `/api/admin/users/${ids.suzuki}`, { login_id: 'suzuki', name: '鈴木, 一郎', active: false });
    const r = await new Client().login('suzuki', reset.data.initial_password);
    assert.equal(r.status, 401);
  });
});

describe('スケジュール・施設予約', () => {
  test('予定を登録して週表示で取得できる', async () => {
    const r = await ids.yamadaClient.req('POST', '/api/events', {
      title: '商談',
      start_at: '2026-04-01 10:00',
      end_at: '2026-04-01 11:00',
      participant_ids: [ids.yamada, ids.sato],
      facility_ids: [ids.roomA],
    });
    assert.equal(r.status, 200);
    ids.event = r.data.id;
    const list = await ids.satoClient.req('GET', `/api/events?from=2026-03-30&to=2026-04-05&users=${ids.sato}`);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].title, '商談');
    assert.equal(list.data[0].can_edit, true);
  });

  test('同じ施設の時間重複は 409、隣接はOK', async () => {
    const overlap = await ids.satoClient.req('POST', '/api/events', {
      title: '別会議', start_at: '2026-04-01 10:30', end_at: '2026-04-01 12:00', participant_ids: [ids.sato], facility_ids: [ids.roomA],
    });
    assert.equal(overlap.status, 409);
    assert.match(overlap.data.error, /会議室A/);
    const adjacent = await ids.satoClient.req('POST', '/api/events', {
      title: '別会議', start_at: '2026-04-01 11:00', end_at: '2026-04-01 12:00', participant_ids: [ids.sato], facility_ids: [ids.roomA],
    });
    assert.equal(adjacent.status, 200);
  });

  test('終了が開始より前の予定は登録できない', async () => {
    const r = await admin.req('POST', '/api/events', { title: 'x', start_at: '2026-04-01 10:00', end_at: '2026-04-01 09:00', participant_ids: [ids.yamada] });
    assert.equal(r.status, 400);
  });

  test('非公開予定は参加者以外に「予定あり」と表示される', async () => {
    await ids.yamadaClient.req('POST', '/api/events', {
      title: '人事面談', start_at: '2026-04-02 15:00', end_at: '2026-04-02 16:00', participant_ids: [ids.yamada], visibility: 'private', memo: '秘密',
    });
    const seen = (await ids.satoClient.req('GET', `/api/events?from=2026-04-02&to=2026-04-02&users=${ids.yamada}`)).data;
    assert.equal(seen[0].title, '予定あり');
    assert.equal(seen[0].memo, '');
    assert.equal(seen[0].can_edit, false);
    const own = (await ids.yamadaClient.req('GET', `/api/events?from=2026-04-02&to=2026-04-02&users=${ids.yamada}`)).data;
    assert.equal(own[0].title, '人事面談');
    const del = await ids.satoClient.req('DELETE', `/api/events/${seen[0].id}`);
    assert.equal(del.status, 403);
  });

  test('繰り返し予定（平日）を登録し、この回以降を削除できる', async () => {
    const r = await ids.yamadaClient.req('POST', '/api/events', {
      title: '朝会', start_at: '2026-04-06 09:00', end_at: '2026-04-06 09:15', participant_ids: [ids.yamada],
      repeat: { freq: 'weekdays', until: '2026-04-17' },
    });
    assert.equal(r.data.ids.length, 10);
    const d = await ids.yamadaClient.req('DELETE', `/api/events/${r.data.ids[5]}?scope=following`);
    assert.equal(d.data.deleted, 5);
  });

  test('繰り返しで施設が重複する回があれば全体を登録しない', async () => {
    const r = await ids.satoClient.req('POST', '/api/events', {
      title: '週次', start_at: '2026-03-25 10:00', end_at: '2026-03-25 10:30', participant_ids: [ids.sato], facility_ids: [ids.roomA],
      repeat: { freq: 'weekly', until: '2026-04-08' },
    });
    assert.equal(r.status, 409);
    const list = (await ids.satoClient.req('GET', `/api/events?from=2026-03-25&to=2026-03-25&users=${ids.sato}`)).data;
    assert.equal(list.length, 0, 'ロールバックされている');
  });

  test('終日予定と編集', async () => {
    const r = await ids.satoClient.req('POST', '/api/events', {
      title: '研修', all_day: true, start_at: '2026-04-03', end_at: '2026-04-03', facility_ids: [ids.roomB], participant_ids: [],
    });
    assert.equal(r.status, 200);
    const ev = (await ids.satoClient.req('GET', `/api/events/${r.data.id}`)).data;
    assert.equal(ev.start_at, '2026-04-03 00:00');
    assert.equal(ev.end_at, '2026-04-03 24:00');
    const fac = (await ids.satoClient.req('GET', `/api/events?from=2026-04-03&to=2026-04-03&facilities=${ids.roomB}`)).data;
    assert.equal(fac.length, 1);
    const up = await ids.satoClient.req('PUT', `/api/events/${r.data.id}`, { ...ev, title: '研修（変更）', participant_ids: [ids.sato] });
    assert.equal(up.status, 200);
  });

  test('CSV で予定を取り込み・書き出しできる', async () => {
    const csv = '件名,開始日時,終了日時,終日,参加者,施設,場所,メモ,非公開\n移行予定,2026/5/1 9:00,2026/5/1 10:30,0,yamada;sato,会議室B,本社,"メモ,カンマ",0\n不正,2026/5/1 9:00,2026/5/1 10:30,0,unknown,,,,0\n';
    const r = await admin.req('POST', '/api/admin/events/import', { csv });
    assert.equal(r.data.imported, 1);
    assert.equal(r.data.skipped.length, 1);
    const ex = await admin.req('GET', '/api/admin/events/export?from=2026-05-01&to=2026-05-01');
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get('content-type'), /text\/csv/);
    assert.match(ex.data, /移行予定,2026-05-01 09:00,2026-05-01 10:30,0,yamada;sato,会議室B,本社,"メモ,カンマ",0/);
  });
});

describe('ワークフロー', () => {
  test('2段階承認で承認済みになる', async () => {
    const r = await ids.yamadaClient.req('POST', '/api/requests', {
      type: '稟議', title: 'PC購入', amount: 200000, body: 'ノートPC 1台', approver_ids: [ids.sato, (await admin.req('GET', '/api/me')).data.id],
    });
    assert.equal(r.status, 200);
    ids.req = r.data.id;
    const todo = (await ids.satoClient.req('GET', '/api/requests?box=todo')).data;
    assert.equal(todo.length, 1);
    assert.equal((await admin.req('GET', '/api/requests?box=todo')).data.length, 0, '2次承認者にはまだ回らない');
    const early = await admin.req('POST', `/api/requests/${ids.req}/act`, { action: 'approve' });
    assert.equal(early.status, 409);
    await ids.satoClient.req('POST', `/api/requests/${ids.req}/act`, { action: 'approve', comment: 'OK' });
    const done = await admin.req('POST', `/api/requests/${ids.req}/act`, { action: 'approve' });
    assert.equal(done.data.status, 'approved');
  });

  test('差し戻し → 修正して再申請 → 取り下げ', async () => {
    const r = await ids.yamadaClient.req('POST', '/api/requests', { type: '休暇申請', title: '有給', approver_ids: [ids.sato] });
    const noComment = await ids.satoClient.req('POST', `/api/requests/${r.data.id}/act`, { action: 'return' });
    assert.equal(noComment.status, 400);
    await ids.satoClient.req('POST', `/api/requests/${r.data.id}/act`, { action: 'return', comment: '日付を記入してください' });
    const detail = (await ids.yamadaClient.req('GET', `/api/requests/${r.data.id}`)).data;
    assert.equal(detail.status, 'returned');
    assert.equal(detail.can_resubmit, true);
    const re = await ids.yamadaClient.req('PUT', `/api/requests/${r.data.id}`, { type: '休暇申請', title: '有給 4/10', approver_ids: [ids.sato] });
    assert.equal(re.status, 200);
    assert.equal((await ids.satoClient.req('GET', '/api/requests?box=todo')).data.length, 1);
    assert.equal((await ids.yamadaClient.req('POST', `/api/requests/${r.data.id}/withdraw`)).status, 200);
    assert.equal((await ids.satoClient.req('GET', '/api/requests?box=todo')).data.length, 0);
  });

  test('関係者以外は申請を閲覧できず、自分を承認者にできない', async () => {
    const other = await activate(new Client(), 'suzuki2', (await admin.req('POST', '/api/admin/users', { login_id: 'suzuki2', name: '鈴木 次郎' })).data.initial_password);
    assert.equal((await other.req('GET', `/api/requests/${ids.req}`)).status, 403);
    const self = await ids.yamadaClient.req('POST', '/api/requests', { type: '稟議', title: 'x', approver_ids: [ids.yamada] });
    assert.equal(self.status, 400);
  });
});

describe('掲示板・ToDo・ホーム', () => {
  test('お知らせの既読管理', async () => {
    const p = await admin.req('POST', '/api/posts', { title: '全社連絡', body: '本文', pinned: true });
    const before = (await ids.yamadaClient.req('GET', '/api/posts')).data;
    assert.equal(before[0].is_read, false);
    assert.equal(before[0].pinned, true);
    const dash = (await ids.yamadaClient.req('GET', '/api/dashboard?today=2026-04-01')).data;
    assert.equal(dash.unread.length, 1);
    assert.equal(dash.events.length, 1);
    const detail = (await ids.yamadaClient.req('GET', `/api/posts/${p.data.id}`)).data;
    assert.equal(detail.readers.length, 2);
    assert.equal(detail.can_edit, false);
    assert.equal((await ids.yamadaClient.req('DELETE', `/api/posts/${p.data.id}`)).status, 403);
    const pinTry = await ids.yamadaClient.req('POST', '/api/posts', { title: '一般投稿', body: 'x', pinned: true });
    assert.equal((await ids.yamadaClient.req('GET', `/api/posts/${pinTry.data.id}`)).data.pinned, false);
  });

  test('ToDo は本人のものだけ操作できる', async () => {
    const t = await ids.yamadaClient.req('POST', '/api/todos', { title: '見積作成', due_date: '2026-04-10' });
    await ids.satoClient.req('PUT', `/api/todos/${t.data.id}`, { done: true });
    const mine = (await ids.yamadaClient.req('GET', '/api/todos')).data;
    assert.equal(mine[0].done, false);
    await ids.yamadaClient.req('PUT', `/api/todos/${t.data.id}`, { done: true });
    assert.equal((await ids.yamadaClient.req('GET', '/api/todos')).data[0].done, true);
    assert.equal((await ids.satoClient.req('GET', '/api/todos')).data.length, 0);
  });

  test('ログアウトするとセッションが無効になる', async () => {
    const c = new Client();
    await c.login('yamada', NEW_PW);
    await c.req('POST', '/api/logout');
    c.cookie = c.cookie || '';
    assert.equal((await c.req('GET', '/api/me')).status, 401);
  });
});
