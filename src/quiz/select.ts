import type { MarketData, MarketGroup } from '../types';
import { ELIGIBLE_MAX, ELIGIBLE_MIN, MIN_SAMPLES, QUESTION_COUNT } from '../constants';
import { createRng, hashDateKey, shuffle } from './rng';

/** 出題条件を満たす群だけを返す。 */
export function eligibleGroups(data: MarketData): MarketGroup[] {
  return data.groups.filter(
    (g) => g.n >= MIN_SAMPLES && g.median >= ELIGIBLE_MIN && g.median <= ELIGIBLE_MAX,
  );
}

const cityKeyOf = (g: MarketGroup): string => `${g.pref}|${g.city}`;
const districtKeyOf = (g: MarketGroup): string => `${g.pref}|${g.city}|${g.district}`;

/**
 * 帯の最低2問保証を試みる貪欲な1回分の試行回数の上限。
 *
 * どんな順序ヒューリスティックで帯を処理しても、「ある帯の候補が特定の
 * 市区町村に集中しており、その市区町村を他の帯とも取り合っている」場合には
 * 帯の最低2問を取り逃す組み合わせが存在しうる（小規模な割当問題）。
 * そこで単一の順序を過信せず、同じ乱数列から複数の貪欲な組み合わせを
 * 試し、その中で最良のものを採用する。
 */
const MAX_SELECTION_ATTEMPTS = 200;

interface Attempt {
  picked: MarketGroup[];
  bandTaken: number[];
}

/**
 * 日付キーから決定的に8問を選ぶ。
 *
 * 低・中・高の価格帯（中央値で3等分）を1回のシード済み乱数列から複数回
 * 貪欲に試行し（帯の処理順をシャッフルしてから各帯で最大2問、残りを
 * 全体プールから補充）、「3帯とも2問以上」かつ「合計8問」に達した時点、
 * もしくは試行上限に達した時点で、それまでの最良の組み合わせを採用する。
 * 同一市区町村は最大2問、同一町丁は1問まで。
 *
 * 帯の不足だけでは例外を投げない。候補の総数が8問に満たない場合のみ
 * 例外を投げる。
 */
export function selectQuestions(data: MarketData, dateKey: string): MarketGroup[] {
  const pool = eligibleGroups(data);
  const sorted = [...pool].sort((a, b) => a.median - b.median);
  const t1 = Math.floor(sorted.length / 3);
  const t2 = Math.floor((sorted.length * 2) / 3);
  const bands: MarketGroup[][] = [sorted.slice(0, t1), sorted.slice(t1, t2), sorted.slice(t2)];

  // 各群がどの帯に属するかを、価格でソートした配列を1度だけ歩いて決める
  // （データのみに依存する決定的な計算。日付キーや乱数には依存しない）。
  const bandOf = new Map<MarketGroup, number>();
  bands.forEach((band, i) => {
    for (const g of band) bandOf.set(g, i);
  });

  const rng = createRng(hashDateKey(dateKey));

  const runAttempt = (): Attempt => {
    const picked: MarketGroup[] = [];
    const cityCount = new Map<string, number>();
    const usedDistricts = new Set<string>();
    const bandTaken: number[] = [0, 0, 0];

    const canTake = (g: MarketGroup): boolean =>
      (cityCount.get(cityKeyOf(g)) ?? 0) < 2 && !usedDistricts.has(districtKeyOf(g));

    const take = (g: MarketGroup): void => {
      cityCount.set(cityKeyOf(g), (cityCount.get(cityKeyOf(g)) ?? 0) + 1);
      usedDistricts.add(districtKeyOf(g));
      picked.push(g);
      const band = bandOf.get(g);
      if (band !== undefined) bandTaken[band] = (bandTaken[band] ?? 0) + 1;
    };

    const bandOrder = shuffle([0, 1, 2], rng);
    for (const bi of bandOrder) {
      let taken = 0;
      const band = bands[bi];
      if (band === undefined) continue;
      for (const g of shuffle(band, rng)) {
        if (taken >= 2) break;
        if (canTake(g)) {
          take(g);
          taken++;
        }
      }
    }

    for (const g of shuffle(pool, rng)) {
      if (picked.length >= QUESTION_COUNT) break;
      if (canTake(g)) take(g);
    }

    return { picked, bandTaken };
  };

  const bandsReaching2 = (a: Attempt): number => a.bandTaken.filter((n) => n >= 2).length;
  // 8問の確保（hard requirement）を第一基準、帯の最低2問（soft requirement）を
  // 第二基準にする。件数が同じ場合にのみ帯のカバレッジで比較する。
  // これにより「3帯とも2問以上だが合計7問」の試行が「合計8問だが2帯のみ」の
  // 試行より優先されることはなくなり、8問に達した試行が存在する限り、
  // 帯の不足だけを理由に例外が投げられることはない。
  const isBetter = (candidate: Attempt, current: Attempt): boolean => {
    const cLen = candidate.picked.length;
    const uLen = current.picked.length;
    if (cLen !== uLen) return cLen > uLen;
    return bandsReaching2(candidate) > bandsReaching2(current);
  };

  let best = runAttempt();
  for (let i = 1; i < MAX_SELECTION_ATTEMPTS; i++) {
    if (best.picked.length >= QUESTION_COUNT && bandsReaching2(best) === 3) break;
    const candidate = runAttempt();
    if (isBetter(candidate, best)) best = candidate;
  }

  if (best.picked.length < QUESTION_COUNT) {
    throw new Error(
      `出題条件を満たす群が足りません（${best.picked.length}/${QUESTION_COUNT}）。market.json を確認してください。`,
    );
  }

  return shuffle(best.picked, rng);
}
