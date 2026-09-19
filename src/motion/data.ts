import { createRng } from '../quiz/rng';
import { market } from '../data/loadMarket';
import { MIN_SAMPLES } from '../constants';
import type { MarketData, MarketGroup, YearBand } from '../types';

/** 築年帯の並び順（古い→新しい）。 */
export const BAND_ORDER: readonly YearBand[] = [
  '~1980',
  '1981-1990',
  '1991-2000',
  '2001-2010',
  '2011-2020',
  '2021-',
];

/** 区市町村ランキングに載せるのに必要な最小グループ数。少数サンプルの区を上位に出さないため。 */
const MIN_CITY_GROUPS = 10;

/** 注目シーンに使う (区市町村 × 築年帯) に必要な最小町丁数。 */
const MIN_FOCUS_DISTRICTS = 15;

/** ランキングに出す区市町村の数。 */
const CITY_RANK_COUNT = 10;

export interface Totals {
  sourceYear: number;
  /** 集計対象の成約件数 */
  deals: number;
  /** 町丁の数 */
  districts: number;
  /** 町丁 × 築年帯 のグループ数 */
  groups: number;
  /** 区市町村の数 */
  cities: number;
}

export interface BandStat {
  band: YearBand;
  groups: number;
  median: number;
}

/** 散布図の1点。1グループ＝1点。 */
export interface Dot {
  bandIndex: number;
  /** 列内の横ずらし -1..1。乱数だが種固定なので毎回同じ */
  jitter: number;
  median: number;
}

export interface CityStat {
  city: string;
  median: number;
  groups: number;
}

export interface DistrictStat {
  district: string;
  median: number;
  deals: number;
}

/** 築年帯を固定してなお残る、区内の町丁差。 */
export interface FocusStat {
  city: string;
  band: YearBand;
  /** 単価の高い順 */
  districts: DistrictStat[];
  /** この (区 × 築年帯) の中央値 */
  median: number;
  deals: number;
  ratio: number;
}

/** 夜景の灯りとして散らす1点。座標は画面比 0..1。 */
export interface FieldPoint {
  x: number;
  y: number;
  /** 奥行き 0..1。大きさ・明るさ・流れる速さに効く */
  depth: number;
  /** ゆらぎの位相をずらすための値 */
  phase: number;
  median: number;
}

export interface MotionData {
  totals: Totals;
  bands: BandStat[];
  dots: Dot[];
  cities: CityStat[];
  /** ランキング条件を満たす中で最も安い区市町村 */
  cityLow: CityStat;
  focus: FocusStat;
  /** 冒頭と末尾で散らす灯り。dots と同じ群から作る */
  field: FieldPoint[];
  /** 縦軸の上限（円/㎡） */
  priceMax: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid] ?? 0;
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = m.get(k);
    if (bucket) bucket.push(item);
    else m.set(k, [item]);
  }
  return m;
}

function buildBands(groups: readonly MarketGroup[]): BandStat[] {
  return BAND_ORDER.map((band) => {
    const inBand = groups.filter((g) => g.yearBand === band);
    return { band, groups: inBand.length, median: median(inBand.map((g) => g.median)) };
  });
}

function buildDots(groups: readonly MarketGroup[]): Dot[] {
  // 種を固定する。書き出しのたびに点が動くと、同じ映像が二度と作れない。
  const rng = createRng(0x48454942);
  return groups.map((g) => ({
    bandIndex: BAND_ORDER.indexOf(g.yearBand),
    jitter: rng() * 2 - 1,
    median: g.median,
  }));
}

/**
 * 灯りの散らばりを作る。
 * dots とは別の種を使うが、種は固定なので毎回同じ夜景になる。
 */
function buildField(groups: readonly MarketGroup[]): FieldPoint[] {
  const rng = createRng(0x59414b45);
  return groups.map((g) => ({
    x: rng(),
    y: rng(),
    depth: rng(),
    phase: rng() * Math.PI * 2,
    median: g.median,
  }));
}

function buildCities(groups: readonly MarketGroup[]): { top: CityStat[]; low: CityStat } {
  const stats: CityStat[] = [];
  for (const [city, rows] of groupBy(groups, (g) => g.city)) {
    if (rows.length < MIN_CITY_GROUPS) continue;
    stats.push({ city, median: median(rows.map((g) => g.median)), groups: rows.length });
  }
  stats.sort((a, b) => b.median - a.median);
  const low = stats[stats.length - 1];
  if (!low) throw new Error('motion: ランキング対象の区市町村がありません');
  return { top: stats.slice(0, CITY_RANK_COUNT), low };
}

/**
 * 築年帯を固定したうえで、町丁間の開きが最も大きい (区市町村 × 築年帯) を選ぶ。
 *
 * 築年帯をまたいで町丁を比べると、差の一部が「築年の違い」で説明できてしまう。
 * 築年を揃えてなお残る差だけを見せるために、ここで帯を固定している。
 */
function buildFocus(groups: readonly MarketGroup[]): FocusStat {
  let best: FocusStat | null = null;
  for (const [, rows] of groupBy(groups, (g) => `${g.city}|${g.yearBand}`)) {
    if (rows.length < MIN_FOCUS_DISTRICTS) continue;
    const sorted = [...rows].sort((a, b) => b.median - a.median);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    if (!hi || !lo || lo.median <= 0) continue;
    const ratio = hi.median / lo.median;
    if (best && ratio <= best.ratio) continue;
    best = {
      city: hi.city,
      band: hi.yearBand,
      districts: sorted.map((g) => ({ district: g.district, median: g.median, deals: g.n })),
      median: median(sorted.map((g) => g.median)),
      deals: sorted.reduce((sum, g) => sum + g.n, 0),
      ratio,
    };
  }
  if (!best) throw new Error('motion: 注目できる区市町村がありません');
  return best;
}

/**
 * market.json から映像用のデータを作る。
 * 成約件数が MIN_SAMPLES 未満のグループは、ゲーム本編と同じ理由（中央値が不安定）で外す。
 */
export function buildMotionData(source: MarketData = market): MotionData {
  const groups = source.groups.filter((g) => g.n >= MIN_SAMPLES);
  const districts = new Set(groups.map((g) => `${g.pref}/${g.city}/${g.district}`));
  const cities = buildCities(groups);
  const bands = buildBands(groups);
  return {
    totals: {
      sourceYear: source.sourceYear,
      deals: groups.reduce((sum, g) => sum + g.n, 0),
      districts: districts.size,
      groups: groups.length,
      cities: new Set(groups.map((g) => g.city)).size,
    },
    bands,
    dots: buildDots(groups),
    cities: cities.top,
    cityLow: cities.low,
    focus: buildFocus(groups),
    field: buildField(groups),
    priceMax: 3_500_000,
  };
}
