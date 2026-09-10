import { describe, it, expect } from 'vitest';
import { validateMarket } from '../src/data/loadMarket';
import { makeFixture } from './fixtures/market.fixture';

describe('validateMarket', () => {
  it('正しいデータをそのまま返す', () => {
    const data = makeFixture();
    expect(validateMarket(data).groups).toHaveLength(data.groups.length);
  });

  it('sourceYear が無ければ例外を投げる', () => {
    expect(() => validateMarket({ fetchedAt: '2026-09-09', groups: [] })).toThrow();
  });

  it('fetchedAt の形式が違えば例外を投げる', () => {
    expect(() => validateMarket({ sourceYear: 2024, fetchedAt: '2026/09/09', groups: [] })).toThrow();
  });

  it('groups が配列でなければ例外を投げる', () => {
    expect(() => validateMarket({ sourceYear: 2024, fetchedAt: '2026-09-09', groups: {} })).toThrow();
  });

  it('築年帯が想定外なら例外を投げる', () => {
    const data = makeFixture();
    const broken = { ...data, groups: [{ ...data.groups[0]!, yearBand: '2030-' }] };
    expect(() => validateMarket(broken)).toThrow();
  });

  it('必須の数値が欠けていれば例外を投げる', () => {
    const data = makeFixture();
    const g = { ...data.groups[0]! } as Record<string, unknown>;
    delete g['median'];
    expect(() => validateMarket({ ...data, groups: [g] })).toThrow();
  });
});
