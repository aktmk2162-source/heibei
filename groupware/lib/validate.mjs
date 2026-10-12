// 入力値チェックの共通処理。不正な値は 400 エラーにする。
import { fail } from './http.mjs';

export function str(v, name, { max = 200, required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') fail(400, `${name}の形式が正しくありません`);
  v = v.trim();
  if (required && !v) fail(400, `${name}を入力してください`);
  if (v.length > max) fail(400, `${name}は${max}文字以内にしてください`);
  return v;
}

export function int(v, name, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) fail(400, `${name}を入力してください`);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name}の値が正しくありません`);
  return n;
}

export function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function ids(v, name) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(400, `${name}の形式が正しくありません`);
  const out = [...new Set(v.map((x) => int(x, name, { required: true, min: 1 })))];
  if (out.length > 500) fail(400, `${name}が多すぎます`);
  return out;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

function validYmd(y, m, d) {
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  return dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d;
}

export function date(v, name, { required = false } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return null;
  const m = typeof v === 'string' && DATE_RE.exec(v);
  if (!m || !validYmd(m[1], m[2], m[3])) fail(400, `${name}は YYYY-MM-DD 形式で入力してください`);
  return v;
}

export function datetime(v, name) {
  if (typeof v === 'string') v = v.replace('T', ' ');
  const m = typeof v === 'string' && DATETIME_RE.exec(v);
  if (!m || !validYmd(m[1], m[2], m[3]) || +m[4] > 24 || +m[5] > 59 || (+m[4] === 24 && +m[5] !== 0)) {
    fail(400, `${name}は YYYY-MM-DD HH:MM 形式で入力してください`);
  }
  return v;
}

// 'YYYY-MM-DD' に日数を加算する（UTC で計算し、タイムゾーンの影響を受けない）。
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function addMonths(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  // 月末日がない月（例: 31日）は null を返し、その月はスキップする
  if (dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function weekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function localToday() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function localNow() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${localToday()} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

// RFC 4180 準拠の簡易 CSV パーサー（ダブルクォート・改行入りセルに対応）。
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
