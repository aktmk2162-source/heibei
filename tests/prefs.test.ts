import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type StorageLike } from '../src/storage/prefs';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
}

describe('prefs', () => {
  it('何も保存されていなければ既定値を返す', () => {
    expect(loadPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
  });

  it('保存した値を読み戻せる', () => {
    const s = memoryStorage();
    savePrefs({ muted: true, best: { dateKey: '2026-09-09', points: 700, meanErrorRate: 0.05 } }, s);
    const out = loadPrefs(s);
    expect(out.muted).toBe(true);
    expect(out.best?.points).toBe(700);
  });

  it('storage が例外を投げても落ちない', () => {
    const s = throwingStorage();
    expect(() => savePrefs({ muted: true, best: null }, s)).not.toThrow();
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });

  it('storage が無くても落ちない', () => {
    expect(() => savePrefs({ muted: true, best: null }, null)).not.toThrow();
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('壊れた JSON が入っていても既定値を返す', () => {
    const s = memoryStorage();
    s.setItem('heibei.prefs.v1', '{壊れている');
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });

  it('型の違う値が入っていても既定値を返す', () => {
    const s = memoryStorage();
    s.setItem('heibei.prefs.v1', '{"muted":"yes"}');
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
  });
});
