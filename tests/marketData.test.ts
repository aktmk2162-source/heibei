import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { market } from '../src/data/loadMarket';
import { eligibleGroups } from '../src/quiz/select';
import {
  ELIGIBLE_MAX,
  ELIGIBLE_MIN,
  MIN_SAMPLES,
  QUESTION_COUNT,
  SLIDER_MAX,
  SLIDER_MIN,
} from '../src/constants';

describe('同梱データの健全性', () => {
  it('market.json が BOM なしの純粋な JSON として parse できる', () => {
    const path = fileURLToPath(new URL('../src/data/market.json', import.meta.url));
    const text = readFileSync(path, 'utf8');
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('対象年と取得日が入っている', () => {
    expect(market.sourceYear).toBeGreaterThanOrEqual(2021);
    expect(market.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('出題可能な群が十分にある', () => {
    expect(eligibleGroups(market).length).toBeGreaterThanOrEqual(QUESTION_COUNT * 10);
  });

  it('全群が n >= 8 である', () => {
    for (const g of market.groups) expect(g.n).toBeGreaterThanOrEqual(MIN_SAMPLES);
  });

  it('全群で q1 <= median <= q3 が成り立つ', () => {
    for (const g of market.groups) {
      expect(g.q1).toBeLessThanOrEqual(g.median);
      expect(g.median).toBeLessThanOrEqual(g.q3);
    }
  });

  it('全群の中央値が出題範囲に収まる', () => {
    for (const g of market.groups) {
      expect(g.median).toBeGreaterThanOrEqual(ELIGIBLE_MIN);
      expect(g.median).toBeLessThanOrEqual(ELIGIBLE_MAX);
    }
  });

  it('全群の中央値がスライダー範囲の内側にある', () => {
    for (const g of market.groups) {
      expect(g.median).toBeGreaterThan(SLIDER_MIN);
      expect(g.median).toBeLessThan(SLIDER_MAX);
    }
  });

  it('専有面積の中央値が現実的な範囲にある', () => {
    for (const g of market.groups) {
      expect(g.areaMedian).toBeGreaterThanOrEqual(10);
      expect(g.areaMedian).toBeLessThanOrEqual(300);
    }
  });

  it('所在の文字列が空でない', () => {
    for (const g of market.groups) {
      expect(g.pref.length).toBeGreaterThan(0);
      expect(g.city.length).toBeGreaterThan(0);
      expect(g.district.length).toBeGreaterThan(0);
    }
  });
});
