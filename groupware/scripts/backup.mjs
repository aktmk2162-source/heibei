// 稼働中でも安全に DB をバックアップする（SQLite の VACUUM INTO を使用）。
// 使い方: npm run backup  （保存先は BACKUP_DIR、既定は ./backups）
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbFile = process.env.DB_FILE || new URL('../data/groupware.db', import.meta.url).pathname;
const dir = process.env.BACKUP_DIR || new URL('../backups', import.meta.url).pathname;
const keep = Number(process.env.BACKUP_KEEP || 30);

mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = join(dir, `groupware-${stamp}.db`);
const db = new DatabaseSync(dbFile, { readOnly: true });
db.prepare('VACUUM INTO ?').run(out);
db.close();
console.log(`バックアップを作成しました: ${out}`);

// 古いバックアップを削除（新しい順に keep 件を残す）
const files = readdirSync(dir).filter((f) => /^groupware-.*\.db$/.test(f)).sort().reverse();
for (const f of files.slice(keep)) rmSync(join(dir, f));
