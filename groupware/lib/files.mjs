// アップロードファイルの共通処理（テンプレート集・チャット添付）。
// 本体は filesDir に推測できない名前で保存し、DB にはメタ情報だけを持つ。
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from './http.mjs';

// 実行ファイル（.exe/.bat/.ps1/.vbs/.js 等）や HTML/SVG は受け付けない
export const DOCUMENT_EXT = [
  'xlsx', 'xlsm', 'xlsb', 'xls', 'xltx', 'xltm', 'csv',
  'docx', 'docm', 'doc', 'dotx', 'pptx', 'pptm', 'ppt', 'pdf',
  'zip', 'txt', 'md', 'json', 'py', 'gs', 'bas', 'cls', 'frm', 'sql',
];
// ブラウザ内でそのまま表示してよい画像（SVG は スクリプトを含められるため除外）
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
export const MACRO_EXT = new Set(['xlsm', 'xlsb', 'xltm', 'docm', 'pptm', 'bas', 'cls', 'frm', 'py', 'gs', 'zip']);

export const ext = (name) => (String(name).match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();

export function cleanFilename(raw, allowed) {
  const name = String(raw || '')
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  if (!name || name.length > 200) fail(400, 'ファイル名が正しくありません');
  if (!allowed.has(ext(name))) fail(400, `このファイル形式は登録できません。対応形式: ${[...allowed].join(', ')}`);
  return name;
}

export class FileStore {
  constructor(dir, maxBytes) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    if (dir) mkdirSync(dir, { recursive: true });
  }

  path(stored) {
    return join(this.dir, stored);
  }

  tooLarge() {
    fail(413, `ファイルは${Math.floor(this.maxBytes / 1024 / 1024)}MBまでです`);
  }

  // 本文をストリームで受け取り、サイズ上限を守りながら保存する
  async receive(req) {
    if (!this.dir) fail(500, 'ファイル保存先が設定されていません');
    if (Number(req.headers['content-length'] || 0) > this.maxBytes) this.tooLarge();
    const stored = `${Date.now()}-${randomBytes(12).toString('hex')}`;
    const tmp = join(this.dir, `${stored}.part`);
    const hash = createHash('sha256');
    let size = 0;
    const out = createWriteStream(tmp, { flags: 'wx' });
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > this.maxBytes) this.tooLarge();
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
      }
      await new Promise((ok, ng) => out.end((e) => (e ? ng(e) : ok())));
      if (!size) fail(400, '空のファイルは登録できません');
      await rename(tmp, join(this.dir, stored));
      return { stored, size, sha256: hash.digest('hex') };
    } catch (err) {
      out.destroy();
      await rm(tmp, { force: true });
      throw err;
    }
  }

  remove(stored) {
    return rm(join(this.dir, stored), { force: true });
  }
}
