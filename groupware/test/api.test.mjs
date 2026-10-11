import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { bootstrapAdmin, createApp } from '../lib/app.mjs';
import { encryptPayload } from '../lib/push.mjs';
import { openDb } from '../lib/db.mjs';

let server;
let base;
let db;
let filesDir;
// プッシュサービスの代わりに送信内容を記録する
const pushed = [];
let pushStatus = 201;
const fakePush = async (url, init) => {
  pushed.push({ url, init });
  return new Response(null, { status: pushStatus });
};

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
  filesDir = mkdtempSync(join(tmpdir(), 'gw-files-'));
  server = createServer(createApp(db, { filesDir, maxUploadMb: 1, pushFetch: fakePush, log: { error: () => {} } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await activate(new Client(), 'admin', 'Initial-Pass1');
});

after(() => {
  server.close();
  db.close();
  rmSync(filesDir, { recursive: true, force: true });
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

describe('ToDo の依頼', () => {
  test('他の社員に依頼でき、依頼者・担当者だけが扱える', async () => {
    const t = await ids.yamadaClient.req('POST', '/api/todos', { title: '契約書チェック', assignee_id: ids.sato, due_date: '2026-04-20' });
    assert.equal(t.status, 200);
    const satoTodos = (await ids.satoClient.req('GET', '/api/todos')).data;
    assert.equal(satoTodos[0].requester_name, '山田 太郎');
    const requested = (await ids.yamadaClient.req('GET', '/api/todos?box=requested')).data;
    assert.equal(requested.length, 1);
    assert.equal(requested[0].assignee_name, '佐藤 花子');
    assert.equal((await ids.satoClient.req('PUT', `/api/todos/${t.data.id}`, { done: true })).status, 200);
    assert.equal((await ids.yamadaClient.req('GET', '/api/todos?box=requested')).data[0].done, true);
    assert.equal((await admin.req('PUT', `/api/todos/${t.data.id}`, { done: false })).status, 404, '無関係の人は操作できない');
  });
});

describe('ブログ', () => {
  test('投稿・検索・いいね・コメント', async () => {
    const b = await ids.yamadaClient.req('POST', '/api/blogs', { title: '渋谷エリアの最新動向', body: '駅前再開発で100%_成約が増加' });
    assert.equal(b.status, 200);
    assert.equal((await ids.satoClient.req('GET', '/api/blogs?q=再開発')).data.length, 1);
    assert.equal((await ids.satoClient.req('GET', '/api/blogs?q=100%_')).data.length, 1, 'LIKE の特殊文字をそのまま検索');
    assert.equal((await ids.satoClient.req('GET', '/api/blogs?q=50%')).data.length, 0);
    assert.equal((await ids.satoClient.req('GET', `/api/blogs?author=${ids.sato}`)).data.length, 0);
    assert.equal((await ids.satoClient.req('POST', `/api/blogs/${b.data.id}/like`)).data.liked, true);
    const cm = await ids.satoClient.req('POST', `/api/blogs/${b.data.id}/comments`, { body: '参考になります' });
    const d = (await ids.satoClient.req('GET', `/api/blogs/${b.data.id}`)).data;
    assert.deepEqual(d.likers, ['佐藤 花子']);
    assert.equal(d.comments.length, 1);
    assert.equal(d.can_edit, false);
    assert.equal((await ids.satoClient.req('PUT', `/api/blogs/${b.data.id}`, { title: 'x', body: 'y' })).status, 403);
    assert.equal((await ids.yamadaClient.req('DELETE', `/api/blog-comments/${cm.data.id}`)).status, 403, '他人のコメントは消せない');
    assert.equal((await ids.satoClient.req('POST', `/api/blogs/${b.data.id}/like`)).data.liked, false, 'もう一度押すと取り消し');
  });
});

describe('チャット', () => {
  test('1対1トークは同じ相手なら同じルームになり、未読が数えられる', async () => {
    const r1 = await ids.yamadaClient.req('POST', '/api/chat/direct', { user_id: ids.sato });
    const r2 = await ids.satoClient.req('POST', '/api/chat/direct', { user_id: ids.yamada });
    assert.equal(r1.data.id, r2.data.id);
    await ids.yamadaClient.req('POST', `/api/chat/rooms/${r1.data.id}/messages`, { body: 'お疲れさまです' });
    await ids.yamadaClient.req('POST', `/api/chat/rooms/${r1.data.id}/messages`, { body: '明日の件です' });
    const rooms = (await ids.satoClient.req('GET', '/api/chat/rooms')).data;
    assert.equal(rooms[0].name, '山田 太郎');
    assert.equal(rooms[0].unread, 2);
    assert.equal((await ids.satoClient.req('GET', '/api/dashboard')).data.chat_unread, 2);
    const msgs = (await ids.satoClient.req('GET', `/api/chat/rooms/${r1.data.id}/messages`)).data.messages;
    assert.equal(msgs.length, 2);
    assert.equal((await ids.satoClient.req('GET', '/api/chat/rooms')).data[0].unread, 0, '読んだら既読');
    const after = (await ids.satoClient.req('GET', `/api/chat/rooms/${r1.data.id}/messages?after=${msgs[0].id}`)).data.messages;
    assert.equal(after.length, 1);
    assert.equal((await ids.yamadaClient.req('GET', '/api/chat/rooms')).data[0].unread, 0, '自分の発言は未読にならない');
  });

  test('メンバー以外はグループを読めない・退出すると見えない', async () => {
    const g = await ids.yamadaClient.req('POST', '/api/chat/rooms', { name: '営業部', member_ids: [ids.sato] });
    assert.equal((await admin.req('GET', `/api/chat/rooms/${g.data.id}/messages`)).status, 404);
    assert.equal((await admin.req('POST', `/api/chat/rooms/${g.data.id}/messages`, { body: 'x' })).status, 404);
    await ids.satoClient.req('POST', `/api/chat/rooms/${g.data.id}/leave`);
    assert.equal((await ids.satoClient.req('GET', `/api/chat/rooms/${g.data.id}`)).status, 404);
    const room = (await ids.yamadaClient.req('GET', `/api/chat/rooms/${g.data.id}`)).data;
    assert.equal(room.members.length, 1);
  });
});

describe('日程調整', () => {
  test('回答 → 決定でスケジュールに登録される', async () => {
    const meId = (await admin.req('GET', '/api/me')).data.id;
    const p = await ids.yamadaClient.req('POST', '/api/polls', {
      title: '物件オーナー打合せ',
      member_ids: [ids.sato, meId],
      slots: [
        { start_at: '2026-04-01 10:30', end_at: '2026-04-01 11:30' },
        { start_at: '2026-04-21 14:00', end_at: '2026-04-21 15:00' },
      ],
    });
    assert.equal(p.status, 200);
    assert.equal((await ids.satoClient.req('GET', '/api/dashboard')).data.polls_unanswered, 1);
    const d = (await ids.satoClient.req('GET', `/api/polls/${p.data.id}`)).data;
    const [s1, s2] = d.slots;
    assert.equal(d.busy[`${s1.id}:${ids.sato}`], true, '既存予定（商談）と重なる候補は予定ありと表示');
    assert.equal(d.busy[`${s2.id}:${ids.sato}`], undefined);
    const bad = await ids.satoClient.req('PUT', `/api/polls/${p.data.id}/answer`, { answers: { [s1.id]: 'ok' } });
    assert.equal(bad.status, 400);
    await ids.satoClient.req('PUT', `/api/polls/${p.data.id}/answer`, { answers: { [s1.id]: 'no', [s2.id]: 'yes' }, comment: '午後なら可' });
    assert.equal((await ids.satoClient.req('GET', '/api/dashboard')).data.polls_unanswered, 0);
    assert.equal((await ids.satoClient.req('POST', `/api/polls/${p.data.id}/decide`, { slot_id: s2.id })).status, 403, '主催者以外は決定できない');
    const dec = await ids.yamadaClient.req('POST', `/api/polls/${p.data.id}/decide`, { slot_id: s2.id, facility_ids: [ids.roomA] });
    assert.equal(dec.status, 200);
    const ev = (await admin.req('GET', `/api/events/${dec.data.event_id}`)).data;
    assert.equal(ev.start_at, '2026-04-21 14:00');
    assert.equal(ev.participant_ids.length, 3);
    assert.deepEqual(ev.facility_ids, [ids.roomA]);
    assert.equal((await ids.satoClient.req('PUT', `/api/polls/${p.data.id}/answer`, { answers: {} })).status, 409, '決定後は回答不可');
  });

  test('参加者以外は閲覧できない', async () => {
    const p = await ids.yamadaClient.req('POST', '/api/polls', {
      title: '面談', member_ids: [ids.sato], slots: [{ start_at: '2026-05-01 10:00', end_at: '2026-05-01 11:00' }],
    });
    const other = new Client();
    await other.login('suzuki2', NEW_PW);
    assert.equal((await other.req('GET', `/api/polls/${p.data.id}`)).status, 404);
    assert.equal((await other.req('GET', '/api/polls')).data.length, 0);
  });
});

describe('既存データベースの移行', () => {
  test('古い todos テーブルに列を追加する', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'gw-'));
    const file = join(dir, 'old.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, login_id TEXT, name TEXT, password_hash TEXT);
      CREATE TABLE todos (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT);
      INSERT INTO users VALUES (1, 'a', 'A', 'x'); INSERT INTO todos (user_id, title) VALUES (1, '古いToDo');`);
    old.close();
    const db2 = openDb(file);
    const row = db2.prepare('SELECT * FROM todos').get();
    assert.equal(row.created_by, 1);
    assert.equal(row.memo, '');
    db2.close();
    rmSync(dir, { recursive: true });
  });
});

describe('テンプレート集', () => {
  const upload = (client, id, name, body, note = '') =>
    fetch(`${base}/api/templates/${id}/files?${new URLSearchParams({ name, note })}`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'x-csrf-token': client.csrf, 'content-type': 'application/octet-stream' },
      body,
    });

  test('登録・版の追加・ダウンロード', async () => {
    const t = await ids.yamadaClient.req('POST', '/api/templates', {
      title: '一棟収益 収支シミュレーション', category: '収支・投資シミュレーション', description: '表面・実質利回りとCFを計算', usage: '黄色のセルに入力',
    });
    assert.equal(t.status, 200);
    ids.tpl = t.data.id;
    const v1 = await upload(ids.yamadaClient, ids.tpl, '収支シミュレーション.xlsx', 'version-1');
    assert.equal(v1.status, 200);
    const v2 = await upload(ids.yamadaClient, ids.tpl, '収支シミュレーション.xlsm', 'version-2-macro', '金利入力を追加');
    assert.equal((await v2.json()).version, 2);
    const d = (await ids.satoClient.req('GET', `/api/templates/${ids.tpl}`)).data;
    assert.equal(d.files.length, 2);
    assert.equal(d.files[0].version, 2);
    assert.equal(d.files[0].has_macro, true);
    assert.equal(d.files[0].stored_name, undefined, '保存名は返さない');
    assert.equal(d.can_edit, false);
    const dl = await fetch(`${base}/api/template-files/${d.files[0].id}/download`, { headers: { cookie: ids.satoClient.cookie } });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
    assert.match(dl.headers.get('content-disposition'), /^attachment; .*filename\*=UTF-8''%E5%8F%8E/);
    assert.equal(await dl.text(), 'version-2-macro');
    const list = (await ids.satoClient.req('GET', '/api/templates?category=' + encodeURIComponent('収支・投資シミュレーション'))).data;
    assert.equal(list[0].downloads, 1);
    assert.equal(list[0].version, 2);
    assert.equal((await ids.satoClient.req('GET', '/api/templates?q=利回り')).data.length, 1);
    assert.equal((await ids.satoClient.req('GET', '/api/templates?category=' + encodeURIComponent('その他'))).data.length, 0);
  });

  test('未ログイン・権限なし・危険な形式・サイズ超過は拒否', async () => {
    const d = (await ids.satoClient.req('GET', `/api/templates/${ids.tpl}`)).data;
    assert.equal((await fetch(`${base}/api/template-files/${d.files[0].id}/download`)).status, 401);
    assert.equal((await upload(ids.satoClient, ids.tpl, 'x.xlsx', 'x')).status, 403, '登録者以外は更新できない');
    assert.equal((await upload(ids.yamadaClient, ids.tpl, 'evil.exe', 'x')).status, 400);
    assert.equal((await upload(ids.yamadaClient, ids.tpl, 'evil.html', 'x')).status, 400);
    assert.equal((await upload(ids.yamadaClient, ids.tpl, '../../etc/x.xlsx', 'x')).status, 200, 'パス区切りは無害化される');
    const big = await upload(ids.yamadaClient, ids.tpl, 'big.xlsx', Buffer.alloc(1024 * 1024 + 10));
    assert.equal(big.status, 413);
    const noCsrf = await fetch(`${base}/api/templates/${ids.tpl}/files?name=a.xlsx`, { method: 'POST', headers: { cookie: ids.yamadaClient.cookie }, body: 'x' });
    assert.equal(noCsrf.status, 403);
    assert.equal(readdirSync(filesDir).filter((f) => f.endsWith('.part')).length, 0, '一時ファイルが残らない');
    const files = (await ids.yamadaClient.req('GET', `/api/templates/${ids.tpl}`)).data.files;
    assert.equal(files[0].original_name, '.._.._etc_x.xlsx');
  });

  test('古い版の削除とテンプレート削除でファイルも消える', async () => {
    const files = (await ids.yamadaClient.req('GET', `/api/templates/${ids.tpl}`)).data.files;
    assert.equal((await ids.yamadaClient.req('DELETE', `/api/template-files/${files[0].id}`)).status, 400, '最新版は消せない');
    assert.equal((await ids.yamadaClient.req('DELETE', `/api/template-files/${files[2].id}`)).status, 200);
    assert.equal(readdirSync(filesDir).length, 2);
    assert.equal((await ids.satoClient.req('DELETE', `/api/templates/${ids.tpl}`)).status, 403);
    assert.equal((await admin.req('DELETE', `/api/templates/${ids.tpl}`)).status, 200, '管理者は削除できる');
    assert.equal(readdirSync(filesDir).length, 0);
  });
});

describe('チャットの添付と通知', () => {
  test('暗号化が RFC 8291 付録 A の検証用ベクタと一致する', () => {
    const b = (s) => Buffer.from(s, 'base64url');
    const out = encryptPayload(
      b('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      { asPrivate: b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: b('DGv6ra1nlYgDCS1FRnbzlw') },
    );
    assert.equal(
      out.toString('base64url'),
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const authSecret = randomBytes(16);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/test-device-sato';

  // ブラウザ側の復号（RFC 8291）を再現して、暗号化が正しいことを確かめる
  function decrypt(body) {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const ct = body.subarray(21 + idlen);
    const hm = (k, d) => createHmac('sha256', k).update(d).digest();
    const shared = ua.computeSecret(asPublic);
    const ikm = hm(hm(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
    const prk = hm(salt, ikm);
    const cek = hm(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
    const nonce = hm(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2);
    return JSON.parse(plain.subarray(0, -1).toString());
  }

  const waitPush = async (n) => {
    for (let i = 0; i < 50 && pushed.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  };

  test('通知の登録は既知のプッシュサービスのみ', async () => {
    const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
    assert.equal((await ids.satoClient.req('POST', '/api/push/subscribe', { endpoint: 'https://intranet.local/hook', keys })).status, 400);
    assert.equal((await ids.satoClient.req('POST', '/api/push/subscribe', { endpoint: 'http://fcm.googleapis.com/x', keys })).status, 400);
    assert.equal((await ids.satoClient.req('POST', '/api/push/subscribe', { endpoint, keys: { ...keys, auth: 'short' } })).status, 400);
    assert.equal((await ids.satoClient.req('POST', '/api/push/subscribe', { endpoint, keys })).status, 200);
    assert.match((await ids.satoClient.req('GET', '/api/push/key')).data.publicKey, /^[A-Za-z0-9_-]{87}$/);
  });

  test('メッセージ送信で相手に暗号化された通知が届く・ミュート中は届かない', async () => {
    pushed.length = 0;
    const room = (await ids.yamadaClient.req('POST', '/api/chat/direct', { user_id: ids.sato })).data.id;
    await ids.yamadaClient.req('POST', `/api/chat/rooms/${room}/messages`, { body: '物件資料を送ります' });
    await waitPush(1);
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].url, endpoint);
    const h = pushed[0].init.headers;
    assert.equal(h['Content-Encoding'], 'aes128gcm');
    assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
    const claims = JSON.parse(Buffer.from(h.Authorization.split(' ')[1].slice(2).split('.')[1], 'base64url'));
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    const msg = decrypt(pushed[0].init.body);
    assert.deepEqual(msg, { title: '山田 太郎', body: '物件資料を送ります', url: `/#/chat/${room}`, tag: `chat-${room}` });

    await ids.satoClient.req('PUT', `/api/chat/rooms/${room}/mute`, { muted: true });
    assert.equal((await ids.satoClient.req('GET', `/api/chat/rooms/${room}`)).data.muted, true);
    await ids.yamadaClient.req('POST', `/api/chat/rooms/${room}/messages`, { body: 'もう一件' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(pushed.length, 1, 'ミュート中は送らない');
    await ids.satoClient.req('PUT', `/api/chat/rooms/${room}/mute`, { muted: false });
  });

  test('失効した端末（410）は購読を削除する', async () => {
    pushed.length = 0;
    pushStatus = 410;
    const room = (await ids.yamadaClient.req('POST', '/api/chat/direct', { user_id: ids.sato })).data.id;
    await ids.yamadaClient.req('POST', `/api/chat/rooms/${room}/messages`, { body: 'x' });
    await waitPush(1);
    await new Promise((r) => setTimeout(r, 50));
    pushStatus = 201;
    assert.equal((await ids.satoClient.req('GET', '/api/push/devices')).data.length, 0);
  });

  test('画像・資料を添付でき、メンバー以外は取得できない', async () => {
    const room = (await ids.yamadaClient.req('POST', '/api/chat/direct', { user_id: ids.sato })).data.id;
    const send = (name, body, text = '') =>
      fetch(`${base}/api/chat/rooms/${room}/files?${new URLSearchParams({ name, body: text })}`, {
        method: 'POST',
        headers: { cookie: ids.yamadaClient.cookie, 'x-csrf-token': ids.yamadaClient.csrf, 'content-type': 'application/octet-stream' },
        body,
      });
    assert.equal((await send('外観.jpg', 'JPEGDATA', '現地の写真です')).status, 200);
    assert.equal((await send('重要事項説明書.pdf', 'PDFDATA')).status, 200);
    assert.equal((await send('page.html', '<script>')).status, 400, 'HTML は添付不可');
    assert.equal((await send('logo.svg', '<svg>')).status, 400, 'SVG は添付不可');
    const msgs = (await ids.satoClient.req('GET', `/api/chat/rooms/${room}/messages`)).data.messages;
    const [img, pdf] = msgs.slice(-2);
    assert.deepEqual(img.file, { id: img.file.id, name: '外観.jpg', size: 8, is_image: true });
    assert.equal(img.body, '現地の写真です');
    assert.equal(pdf.file.is_image, false);
    const rooms = (await ids.satoClient.req('GET', '/api/chat/rooms')).data;
    assert.equal(rooms.find((r) => r.id === room).last_body, '📎 重要事項説明書.pdf');

    const imgRes = await fetch(`${base}/api/chat/files/${img.file.id}`, { headers: { cookie: ids.satoClient.cookie } });
    assert.equal(imgRes.headers.get('content-type'), 'image/jpeg');
    assert.match(imgRes.headers.get('content-disposition'), /^inline/);
    assert.match(imgRes.headers.get('content-security-policy'), /sandbox/);
    const pdfRes = await fetch(`${base}/api/chat/files/${pdf.file.id}`, { headers: { cookie: ids.satoClient.cookie } });
    assert.equal(pdfRes.headers.get('content-type'), 'application/octet-stream');
    assert.match(pdfRes.headers.get('content-disposition'), /^attachment/);
    assert.equal(await pdfRes.text(), 'PDFDATA');
    assert.equal((await fetch(`${base}/api/chat/files/${pdf.file.id}`, { headers: { cookie: admin.cookie } })).status, 404, 'メンバー以外は取得不可');

    const before = readdirSync(filesDir).length;
    assert.equal((await ids.yamadaClient.req('DELETE', `/api/chat/messages/${pdf.id}`)).status, 200);
    assert.equal(readdirSync(filesDir).length, before - 1, 'メッセージ削除でファイルも削除');
  });
});
