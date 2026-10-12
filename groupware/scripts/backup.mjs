// 稼働中でも安全に DB とテンプレートのファイルをバックアップする。
// 使い方: npm run backup  （保存先は BACKUP_DIR、既定は ./backups）
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbFile = process.env.DB_FILE || new URL('../data/groupware.db', import.meta.url).pathname;
const filesDir = process.env.FILES_DIR || join(dirname(dbFile), 'files');
const dir = process.env.BACKUP_DIR || new URL('../backups', import.meta.url).pathname;
const keep = Number(process.env.BACKUP_KEEP || 30);

mkdirSync(dir, { recursive: true });
// ファイル名はサーバーの現地時刻（TZ）で付ける
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
const out = join(dir, `groupware-${stamp}.db`);
const db = new DatabaseSync(dbFile, { readOnly: true });
db.prepare('VACUUM INTO ?').run(out);
db.close();
console.log(`データベースをバックアップしました: ${out}`);

// アップロードされたファイルは内容が変わらない（更新は別名で追加）ため、未コピーの分だけ追加する
if (existsSync(filesDir)) {
  const dest = join(dir, 'files');
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(filesDir)) {
    if (f.endsWith('.part') || existsSync(join(dest, f))) continue;
    copyFileSync(join(filesDir, f), join(dest, f));
    copied++;
  }
  console.log(`ファイルを ${copied} 件追加でバックアップしました: ${dest}`);
}

// 古い DB バックアップを削除（新しい順に keep 件を残す）
const files = readdirSync(dir).filter((f) => /^groupware-.*\.db$/.test(f)).sort().reverse();
for (const f of files.slice(keep)) rmSync(join(dir, f));
