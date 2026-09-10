import { describe, it, expect } from 'vitest';
import { eligibleGroups, selectQuestions } from '../src/quiz/select';
import {
  makeFixture,
  makeFixtureWithRejects,
  makeFixtureWithScarceBand,
  makeFixtureWithContendedCity,
} from './fixtures/market.fixture';
import { ELIGIBLE_MAX, ELIGIBLE_MIN, MIN_SAMPLES, QUESTION_COUNT } from '../src/constants';

describe('eligibleGroups', () => {
  it('件数が足りない群を除く', () => {
    const out = eligibleGroups(makeFixtureWithRejects());
    expect(out.every((g) => g.n >= MIN_SAMPLES)).toBe(true);
    expect(out.some((g) => g.city === '少数区')).toBe(false);
  });

  it('中央値が範囲外の群を除く', () => {
    const out = eligibleGroups(makeFixtureWithRejects());
    expect(out.every((g) => g.median >= ELIGIBLE_MIN && g.median <= ELIGIBLE_MAX)).toBe(true);
    expect(out.some((g) => g.city === '安すぎ区')).toBe(false);
    expect(out.some((g) => g.city === '高すぎ区')).toBe(false);
  });
});

describe('selectQuestions', () => {
  const data = makeFixture();

  it('8問を返す', () => {
    expect(selectQuestions(data, '2026-09-09')).toHaveLength(QUESTION_COUNT);
  });

  it('同じ日付なら同じ8問・同じ順序になる', () => {
    const a = selectQuestions(data, '2026-09-09');
    const b = selectQuestions(data, '2026-09-09');
    expect(a).toEqual(b);
  });

  it('違う日付なら違う出題になる', () => {
    const a = selectQuestions(data, '2026-09-09').map((g) => `${g.city}|${g.district}|${g.yearBand}`);
    const b = selectQuestions(data, '2026-09-10').map((g) => `${g.city}|${g.district}|${g.yearBand}`);
    expect(a).not.toEqual(b);
  });

  it('同一市区町村は最大2問である', () => {
    for (let d = 1; d <= 60; d++) {
      const key = `2026-09-${String(d % 30 + 1).padStart(2, '0')}`;
      const counts = new Map<string, number>();
      for (const g of selectQuestions(data, key)) {
        const k = `${g.pref}|${g.city}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      for (const c of counts.values()) expect(c).toBeLessThanOrEqual(2);
    }
  });

  it('同一町丁は重複しない', () => {
    const picked = selectQuestions(data, '2026-09-09');
    const keys = picked.map((g) => `${g.pref}|${g.city}|${g.district}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('低・中・高の各価格帯から最低2問ずつ出る', () => {
    const pool = eligibleGroups(data).slice().sort((a, b) => a.median - b.median);
    const t1 = pool[Math.floor(pool.length / 3)]!.median;
    const t2 = pool[Math.floor((pool.length * 2) / 3)]!.median;
    const picked = selectQuestions(data, '2026-09-09');
    const low = picked.filter((g) => g.median < t1).length;
    const mid = picked.filter((g) => g.median >= t1 && g.median < t2).length;
    const high = picked.filter((g) => g.median >= t2).length;
    expect(low).toBeGreaterThanOrEqual(2);
    expect(mid).toBeGreaterThanOrEqual(2);
    expect(high).toBeGreaterThanOrEqual(2);
  });

  it('候補が足りなければ例外を投げる', () => {
    const tiny = { ...makeFixture(), groups: makeFixture().groups.slice(0, 3) };
    expect(() => selectQuestions(tiny, '2026-09-09')).toThrow();
  });

  it('帯が市区町村の上限で偏っても、達成可能な限り各帯から最低2問出る（帯を跨いだ取り合いがあっても例外は投げない）', () => {
    const data = makeFixtureWithScarceBand();
    let checked = 0;
    for (let m = 1; m <= 12; m++) {
      for (const day of [1, 8, 15, 22]) {
        const key = `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const picked = selectQuestions(data, key);
        expect(picked).toHaveLength(QUESTION_COUNT);
        const low = picked.filter((g) => g.median < 1_000_000).length;
        const mid = picked.filter((g) => g.median >= 1_000_000 && g.median < 2_000_000).length;
        const high = picked.filter((g) => g.median >= 2_000_000).length;
        expect(low, `low on ${key}`).toBeGreaterThanOrEqual(2);
        expect(mid, `mid on ${key}`).toBeGreaterThanOrEqual(2);
        expect(high, `high on ${key}`).toBeGreaterThanOrEqual(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it('フィクスチャのtercile境界が意図した帯の形状（低3町丁・中5町丁は市区町村C内・高12市区町村）と一致する', () => {
    const data = makeFixtureWithContendedCity();
    const pool = eligibleGroups(data).slice().sort((a, b) => a.median - b.median);
    expect(pool).toHaveLength(36);

    const t1 = Math.floor(pool.length / 3);
    const t2 = Math.floor((pool.length * 2) / 3);
    const low = pool.slice(0, t1);
    const mid = pool.slice(t1, t2);
    const high = pool.slice(t2);

    expect(low).toHaveLength(12);
    expect(mid).toHaveLength(12);
    expect(high).toHaveLength(12);

    const lowDistrictKeys = new Set(low.map((g) => `${g.pref}|${g.city}|${g.district}`));
    expect(lowDistrictKeys.size).toBe(3);
    expect(low.some((g) => g.city === 'C')).toBe(true);
    expect(low.filter((g) => g.city === 'C').every((g) => g.district === '町C1')).toBe(true);
    expect(new Set(low.map((g) => g.city)).size).toBe(3);

    expect(mid.every((g) => g.city === 'C')).toBe(true);
    const midDistrictKeys = new Set(mid.map((g) => g.district));
    expect(midDistrictKeys.size).toBe(5);

    expect(new Set(high.map((g) => g.city)).size).toBe(12);
  });

  it('市区町村の取り合いがあっても、達成可能な限り各帯から最低2問出る（低価格帯が共有市区町村を独占して中価格帯を飢えさせない）', () => {
    const data = makeFixtureWithContendedCity();
    const failing: string[] = [];
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      const key = d.toISOString().slice(0, 10);
      const picked = selectQuestions(data, key);
      const low = picked.filter((g) => g.median < 1_000_000).length;
      const mid = picked.filter((g) => g.median >= 1_000_000 && g.median < 2_500_000).length;
      const high = picked.filter((g) => g.median >= 2_500_000).length;
      if (picked.length !== QUESTION_COUNT || low < 2 || mid < 2 || high < 2) {
        failing.push(`${key}: low=${low} mid=${mid} high=${high} total=${picked.length}`);
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(50);
    expect(failing).toEqual([]);
  });
});
