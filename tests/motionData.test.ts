import { describe, it, expect } from 'vitest';
import { BAND_ORDER, buildMotionData } from '../src/motion/data';
import { formatInt, formatMan } from '../src/motion/render';
import { MIN_SAMPLES } from '../src/constants';

const data = buildMotionData();

describe('集計の前提', () => {
  it('件数の少ない群は使わない', () => {
    expect(data.focus.districts.every((d) => d.deals >= MIN_SAMPLES)).toBe(true);
  });

  it('合計が正の値になる', () => {
    expect(data.totals.deals).toBeGreaterThan(0);
    expect(data.totals.districts).toBeGreaterThan(0);
    expect(data.totals.groups).toBeGreaterThan(0);
    expect(data.totals.cities).toBeGreaterThan(0);
  });

  it('グループ数と点の数が一致する', () => {
    expect(data.dots.length).toBe(data.totals.groups);
  });
});

describe('築年帯', () => {
  it('古い順に並ぶ', () => {
    expect(data.bands.map((b) => b.band)).toEqual([...BAND_ORDER]);
  });

  it('どの帯にも中央値がある', () => {
    expect(data.bands.every((b) => b.median > 0 && b.groups > 0)).toBe(true);
  });

  it('帯ごとのグループ数の合計が全体と一致する', () => {
    const sum = data.bands.reduce((acc, b) => acc + b.groups, 0);
    expect(sum).toBe(data.totals.groups);
  });
});

describe('散布の点', () => {
  it('築年帯の範囲に収まる', () => {
    expect(data.dots.every((d) => d.bandIndex >= 0 && d.bandIndex < BAND_ORDER.length)).toBe(true);
  });

  it('横ずらしは -1..1 に収まる', () => {
    expect(data.dots.every((d) => d.jitter >= -1 && d.jitter < 1)).toBe(true);
  });

  it('作り直しても同じ絵になる（種が固定されている）', () => {
    const again = buildMotionData();
    expect(again.dots).toEqual(data.dots);
  });
});

describe('区市町村ランキング', () => {
  it('高い順に並ぶ', () => {
    const medians = data.cities.map((c) => c.median);
    expect([...medians].sort((a, b) => b - a)).toEqual(medians);
  });

  it('サンプルの薄い区市町村を載せない', () => {
    expect(data.cities.every((c) => c.groups >= 10)).toBe(true);
    expect(data.cityLow.groups).toBeGreaterThanOrEqual(10);
  });

  it('最安の区市町村は上位陣より安い', () => {
    const lowest = data.cities[data.cities.length - 1];
    if (!lowest) throw new Error('ランキングが空です');
    expect(data.cityLow.median).toBeLessThanOrEqual(lowest.median);
  });
});

describe('注目シーン（築年帯を揃えた町丁差）', () => {
  it('町丁がひとつの築年帯に揃っている', () => {
    // ここが揃っていないと「同じ築年でも差がある」と言えなくなる。
    const source = buildMotionData();
    expect(source.focus.band).toBe(data.focus.band);
    expect(BAND_ORDER).toContain(data.focus.band);
  });

  it('高い順に並ぶ', () => {
    const medians = data.focus.districts.map((d) => d.median);
    expect([...medians].sort((a, b) => b - a)).toEqual(medians);
  });

  it('比較に足る数の町丁がある', () => {
    expect(data.focus.districts.length).toBeGreaterThanOrEqual(15);
  });

  it('倍率が最高と最低の比になっている', () => {
    const list = data.focus.districts;
    const hi = list[0];
    const lo = list[list.length - 1];
    if (!hi || !lo) throw new Error('町丁がありません');
    expect(data.focus.ratio).toBeCloseTo(hi.median / lo.median, 10);
    expect(data.focus.ratio).toBeGreaterThan(1);
  });

  it('中央値が最高と最低の間にある', () => {
    const list = data.focus.districts;
    const hi = list[0];
    const lo = list[list.length - 1];
    if (!hi || !lo) throw new Error('町丁がありません');
    expect(data.focus.median).toBeLessThanOrEqual(hi.median);
    expect(data.focus.median).toBeGreaterThanOrEqual(lo.median);
  });

  it('成約件数の合計が町丁ごとの合計と一致する', () => {
    const sum = data.focus.districts.reduce((acc, d) => acc + d.deals, 0);
    expect(data.focus.deals).toBe(sum);
  });
});

describe('数値の書式', () => {
  it('3桁区切りを入れる', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1,000');
    expect(formatInt(15599)).toBe('15,599');
    expect(formatInt(1234567)).toBe('1,234,567');
  });

  it('端数を丸めてから区切る', () => {
    expect(formatInt(1999.6)).toBe('2,000');
  });

  it('円を万に直す', () => {
    expect(formatMan(1_845_238)).toBe('184.5');
    expect(formatMan(1_000_000, 0)).toBe('100');
  });
});
