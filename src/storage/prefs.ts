export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BestRecord {
  dateKey: string;
  points: number;
  meanErrorRate: number;
}

export interface Prefs {
  muted: boolean;
  best: BestRecord | null;
}

const KEY = 'heibei.prefs.v1';

export const DEFAULT_PREFS: Prefs = { muted: false, best: null };

/** ブラウザの localStorage を取りに行く。使えない環境では null を返す。 */
function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function parsePrefs(raw: string): Prefs | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o['muted'] !== 'boolean') return null;
    const best = o['best'];
    if (best === null || best === undefined) return { muted: o['muted'], best: null };
    if (typeof best !== 'object') return null;
    const b = best as Record<string, unknown>;
    if (
      typeof b['dateKey'] !== 'string' ||
      typeof b['points'] !== 'number' ||
      typeof b['meanErrorRate'] !== 'number'
    ) {
      return null;
    }
    return {
      muted: o['muted'],
      best: { dateKey: b['dateKey'], points: b['points'], meanErrorRate: b['meanErrorRate'] },
    };
  } catch {
    return null;
  }
}

export function loadPrefs(storage: StorageLike | null = browserStorage()): Prefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return { ...DEFAULT_PREFS };
    return parsePrefs(raw) ?? { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // プライベートモード等では書き込めない。無視する。
  }
}
