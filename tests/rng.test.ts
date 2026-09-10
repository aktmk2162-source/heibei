import { describe, it, expect } from 'vitest';
import { hashDateKey, createRng, todayKey, shuffle } from '../src/quiz/rng';

describe('hashDateKey', () => {
  it('同じ日付キーなら同じ値になる', () => {
    expect(hashDateKey('2026-09-09')).toBe(hashDateKey('2026-09-09'));
  });

  it('違う日付キーなら違う値になる', () => {
    expect(hashDateKey('2026-09-09')).not.toBe(hashDateKey('2026-09-10'));
  });

  it('32bit 符号なし整数を返す', () => {
    const h = hashDateKey('2026-09-09');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe('createRng', () => {
  it('同じ種なら同じ列を返す', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('0以上1未満の値を返す', () => {
    const r = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('種が0でも停止しない', () => {
    const r = createRng(0);
    const values = new Set([r(), r(), r(), r(), r()]);
    expect(values.size).toBeGreaterThan(1);
  });
});

describe('todayKey', () => {
  it('Asia/Tokyo の YYYY-MM-DD を返す', () => {
    // 2026-09-09T15:30:00Z は日本時間で 2026-09-10 00:30
    expect(todayKey(new Date('2026-09-09T15:30:00Z'))).toBe('2026-09-10');
    // 2026-09-09T14:30:00Z は日本時間で 2026-09-09 23:30
    expect(todayKey(new Date('2026-09-09T14:30:00Z'))).toBe('2026-09-09');
  });
});

describe('shuffle', () => {
  it('元の配列を変更しない', () => {
    const src = [1, 2, 3, 4, 5];
    shuffle(src, createRng(7));
    expect(src).toEqual([1, 2, 3, 4, 5]);
  });

  it('要素の集合は変わらない', () => {
    const src = [1, 2, 3, 4, 5];
    const out = shuffle(src, createRng(7));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('同じ種なら同じ並びになる', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(shuffle(src, createRng(99))).toEqual(shuffle(src, createRng(99)));
  });
});
