export type YearBand =
  | '~1980'
  | '1981-1990'
  | '1991-2000'
  | '2001-2010'
  | '2011-2020'
  | '2021-';

/** 市区町村 × 町丁 × 築年帯 の集計値。個別の取引は含まない。 */
export interface MarketGroup {
  pref: string;
  city: string;
  district: string;
  yearBand: YearBand;
  /** 成約件数 */
  n: number;
  /** ㎡単価の中央値（円/㎡） */
  median: number;
  /** ㎡単価の第1四分位（円/㎡） */
  q1: number;
  /** ㎡単価の第3四分位（円/㎡） */
  q3: number;
  /** 専有面積の中央値（㎡） */
  areaMedian: number;
  /** 構造（最頻値） */
  structure: string;
  /** 用途地域（最頻値） */
  cityPlanning: string;
}

export interface MarketData {
  /** 対象暦年 */
  sourceYear: number;
  /** 取得日 'YYYY-MM-DD' */
  fetchedAt: string;
  groups: MarketGroup[];
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export type Tile = '🟩' | '🟨' | '🟧' | '🟥';

export interface Answer {
  /** 回答した㎡単価（円/㎡）。時間切れは null */
  guess: number | null;
  /** 誤差率 0..1（時間切れは 1） */
  errorRate: number;
  /** 0..100 */
  points: number;
  tile: Tile;
}

export interface GameResult {
  dateKey: string;
  answers: Answer[];
  totalPoints: number;
  meanErrorRate: number;
  grade: Grade;
}
