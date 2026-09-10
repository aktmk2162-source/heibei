import type { MarketData, MarketGroup, YearBand } from '../types';
import raw from './market.json';

const YEAR_BANDS: readonly YearBand[] = [
  '~1980',
  '1981-1990',
  '1991-2000',
  '2001-2010',
  '2011-2020',
  '2021-',
];

function requireString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`market.json: ${key} が文字列ではありません`);
  }
  return v;
}

function requireNumber(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`market.json: ${key} が数値ではありません`);
  }
  return v;
}

function toGroup(input: unknown): MarketGroup {
  if (typeof input !== 'object' || input === null) {
    throw new Error('market.json: groups の要素がオブジェクトではありません');
  }
  const o = input as Record<string, unknown>;
  const band = o['yearBand'];
  if (typeof band !== 'string' || !YEAR_BANDS.includes(band as YearBand)) {
    throw new Error(`market.json: yearBand が想定外です（${String(band)}）`);
  }
  return {
    pref: requireString(o, 'pref'),
    city: requireString(o, 'city'),
    district: requireString(o, 'district'),
    yearBand: band as YearBand,
    n: requireNumber(o, 'n'),
    median: requireNumber(o, 'median'),
    q1: requireNumber(o, 'q1'),
    q3: requireNumber(o, 'q3'),
    areaMedian: requireNumber(o, 'areaMedian'),
    structure: requireString(o, 'structure'),
    cityPlanning: requireString(o, 'cityPlanning'),
  };
}

/** market.json の形を検証する。壊れていれば例外を投げる。 */
export function validateMarket(input: unknown): MarketData {
  if (typeof input !== 'object' || input === null) {
    throw new Error('market.json: 中身がオブジェクトではありません');
  }
  const o = input as Record<string, unknown>;
  const sourceYear = requireNumber(o, 'sourceYear');
  const fetchedAt = requireString(o, 'fetchedAt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) {
    throw new Error('market.json: fetchedAt は YYYY-MM-DD 形式にしてください');
  }
  const groups = o['groups'];
  if (!Array.isArray(groups)) {
    throw new Error('market.json: groups が配列ではありません');
  }
  return { sourceYear, fetchedAt, groups: groups.map(toGroup) };
}

export const market: MarketData = validateMarket(raw);
