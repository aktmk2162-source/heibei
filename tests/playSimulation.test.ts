import { describe, it, expect } from 'vitest';
import { market } from '../src/data/loadMarket';
import { eligibleGroups, selectQuestions } from '../src/quiz/select';
import { makeAnswer, summarize } from '../src/quiz/score';
import { QUESTION_COUNT } from '../src/constants';
import type { MarketGroup } from '../src/types';

function dateKeysForYear(startIso: string, days: number): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe('365日走査', () => {
  const keys = dateKeysForYear('2026-09-09', 365);

  it('どの日でも8問が成立する', () => {
    // 失敗した日付が分かるように、落ちた日を集めてから一度に検証します。
    const shortfalls: string[] = [];
    for (const key of keys) {
      const n = selectQuestions(market, key).length;
      if (n !== QUESTION_COUNT) shortfalls.push(`${key}: ${n}問`);
    }
    expect(shortfalls).toEqual([]);
  });

  it('どの日でも同一市区町村が3問以上出ない', () => {
    // 失敗した日付が分かるように、落ちた日を集めてから一度に検証します。
    const shortfalls: string[] = [];
    for (const key of keys) {
      const counts = new Map<string, number>();
      for (const g of selectQuestions(market, key)) {
        const k = `${g.pref}|${g.city}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const over = [...counts.entries()].filter(([, c]) => c > 2);
      if (over.length > 0) {
        shortfalls.push(`${key}: ${over.map(([k, c]) => `${k}=${c}`).join(',')}`);
      }
    }
    expect(shortfalls).toEqual([]);
  });

  it('どの日でも低・中・高の各価格帯から2問以上出る', () => {
    const pool = eligibleGroups(market)
      .slice()
      .sort((a, b) => a.median - b.median);
    const t1 = pool[Math.floor(pool.length / 3)]!.median;
    const t2 = pool[Math.floor((pool.length * 2) / 3)]!.median;
    // 失敗した日付が分かるように、落ちた日を集めてから一度に検証します。
    const shortfalls: string[] = [];
    for (const key of keys) {
      const picked = selectQuestions(market, key);
      const low = picked.filter((g) => g.median < t1).length;
      const mid = picked.filter((g) => g.median >= t1 && g.median < t2).length;
      const high = picked.filter((g) => g.median >= t2).length;
      if (low < 2 || mid < 2 || high < 2) {
        shortfalls.push(`${key}: 低${low} 中${mid} 高${high}`);
      }
    }
    expect(shortfalls).toEqual([]);
  });

  it('365日で十分に出題が散る', () => {
    const seen = new Set<string>();
    for (const key of keys) {
      for (const g of selectQuestions(market, key)) {
        seen.add(`${g.pref}|${g.city}|${g.district}|${g.yearBand}`);
      }
    }
    // 同じ問題ばかり出ていないこと
    expect(seen.size).toBeGreaterThan(200);
  });
});

describe('腕の差がスコアに出る', () => {
  const keys = dateKeysForYear('2026-09-09', 30);

  const pool = eligibleGroups(market);

  const medianOf = (values: readonly number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };

  /** 情報を持たない打ち手：相場を読まず、常に全体の中央値を入れる。 */
  const globalMedian: number = medianOf(pool.map((g) => g.median));

  /**
   * 情報を持つ打ち手：その町丁の相場は知らないが、市区町村と築年帯の相場は知っている。
   * 出題された群と「同じ市区町村・同じ築年帯」に属する他の町丁の中央値を答える。
   * 当該町丁自身は除くので、正解は一切渡りません。
   * 市区町村レベルの情報に価値がなければ、globalMedian と同点になります。
   */
  function informed(q: MarketGroup): number {
    const peers = pool.filter(
      (g) =>
        g.pref === q.pref &&
        g.city === q.city &&
        g.yearBand === q.yearBand &&
        g.district !== q.district,
    );
    if (peers.length === 0) return globalMedian;
    return medianOf(peers.map((g) => g.median));
  }

  function meanPoints(strategy: (q: MarketGroup) => number): number {
    let total = 0;
    for (const key of keys) {
      const qs = selectQuestions(market, key);
      const answers = qs.map((q) => makeAnswer(strategy(q), q.median));
      total += summarize(key, answers).totalPoints;
    }
    return total / keys.length;
  }

  it('市区町村と築年帯を知っている方が、知らないより高い点を取る', () => {
    // ゲームの前提そのものの検証です。方向だけを固定し、倍率は事前に決めません。
    expect(meanPoints(informed)).toBeGreaterThan(meanPoints(() => globalMedian));
  });

  it('情報を持たない打ち手でも0点にはならない（理不尽ではない）', () => {
    expect(meanPoints(() => globalMedian)).toBeGreaterThan(0);
  });
});
