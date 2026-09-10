import { describe, it, expect } from 'vitest';
import {
  errorRate,
  pointsFor,
  tileFor,
  gradeFor,
  makeAnswer,
  summarize,
} from '../src/quiz/score';

describe('errorRate', () => {
  it('正解ぴったりなら0', () => {
    expect(errorRate(1_000_000, 1_000_000)).toBe(0);
  });

  it('高すぎても安すぎても同じ誤差になる', () => {
    expect(errorRate(1_100_000, 1_000_000)).toBeCloseTo(0.1, 10);
    expect(errorRate(900_000, 1_000_000)).toBeCloseTo(0.1, 10);
  });

  it('時間切れ（null）は1', () => {
    expect(errorRate(null, 1_000_000)).toBe(1);
  });
});

describe('pointsFor', () => {
  it('誤差2%以内は満点', () => {
    expect(pointsFor(0)).toBe(100);
    expect(pointsFor(0.02)).toBe(100);
  });

  it('誤差30%以上は0点', () => {
    expect(pointsFor(0.3)).toBe(0);
    expect(pointsFor(0.5)).toBe(0);
    expect(pointsFor(1)).toBe(0);
  });

  it('中間は線形に減る', () => {
    expect(pointsFor(0.16)).toBe(50);
  });

  it('誤差に対して単調非増加である', () => {
    let prev = 101;
    for (let e = 0; e <= 1.0001; e += 0.005) {
      const p = pointsFor(e);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('tileFor', () => {
  it('境界値で色が変わる', () => {
    expect(tileFor(0.05)).toBe('🟩');
    expect(tileFor(0.0501)).toBe('🟨');
    expect(tileFor(0.12)).toBe('🟨');
    expect(tileFor(0.1201)).toBe('🟧');
    expect(tileFor(0.25)).toBe('🟧');
    expect(tileFor(0.2501)).toBe('🟥');
    expect(tileFor(1)).toBe('🟥');
  });
});

describe('gradeFor', () => {
  it('境界値でランクが変わる', () => {
    expect(gradeFor(0.1)).toBe('S');
    expect(gradeFor(0.1001)).toBe('A');
    expect(gradeFor(0.14)).toBe('A');
    expect(gradeFor(0.1401)).toBe('B');
    expect(gradeFor(0.18)).toBe('B');
    expect(gradeFor(0.1801)).toBe('C');
    expect(gradeFor(0.24)).toBe('C');
    expect(gradeFor(0.2401)).toBe('D');
  });
});

describe('makeAnswer', () => {
  it('時間切れは0点で赤になる', () => {
    const a = makeAnswer(null, 1_000_000);
    expect(a.guess).toBeNull();
    expect(a.points).toBe(0);
    expect(a.tile).toBe('🟥');
  });

  it('正解ぴったりは100点で緑になる', () => {
    const a = makeAnswer(1_000_000, 1_000_000);
    expect(a.points).toBe(100);
    expect(a.tile).toBe('🟩');
  });
});

describe('summarize', () => {
  it('合計点と平均誤差率とランクを出す', () => {
    const answers = Array.from({ length: 8 }, () => makeAnswer(1_000_000, 1_000_000));
    const r = summarize('2026-09-09', answers);
    expect(r.dateKey).toBe('2026-09-09');
    expect(r.totalPoints).toBe(800);
    expect(r.meanErrorRate).toBe(0);
    expect(r.grade).toBe('S');
    expect(r.answers).toHaveLength(8);
  });

  it('回答が0件でも落ちない', () => {
    const r = summarize('2026-09-09', []);
    expect(r.totalPoints).toBe(0);
    expect(r.meanErrorRate).toBe(1);
    expect(r.grade).toBe('D');
  });
});
