import type { MarketData, MarketGroup, YearBand } from '../../src/types';

const BANDS: readonly YearBand[] = [
  '~1980',
  '1981-1990',
  '1991-2000',
  '2001-2010',
  '2011-2020',
  '2021-',
];

/**
 * 合成の相場データ。
 * 30市区町村 × 4町丁 × 6築年帯 = 720群。㎡単価は 20万〜340万円/㎡ に散らす。
 */
export function makeFixture(): MarketData {
  const groups: MarketGroup[] = [];
  for (let c = 0; c < 30; c++) {
    for (let d = 0; d < 4; d++) {
      for (let b = 0; b < BANDS.length; b++) {
        const band = BANDS[b];
        if (band === undefined) continue;
        const median = 200_000 + ((c * 24 + d * 6 + b) % 120) * 11_000;
        groups.push({
          pref: '東京都',
          city: `第${c + 1}区`,
          district: `町${d + 1}`,
          yearBand: band,
          n: 8 + ((c + d + b) % 20),
          median,
          q1: Math.round(median * 0.85),
          q3: Math.round(median * 1.15),
          areaMedian: 40 + ((c + d) % 5) * 10,
          structure: 'ＲＣ',
          cityPlanning: '商業地域',
        });
      }
    }
  }
  return { sourceYear: 2024, fetchedAt: '2026-09-09', groups };
}

/** 出題条件を満たさない群を混ぜたデータ。 */
export function makeFixtureWithRejects(): MarketData {
  const base = makeFixture();
  const bad: MarketGroup[] = [
    { ...base.groups[0]!, city: '少数区', district: '町A', n: 7 },
    { ...base.groups[0]!, city: '安すぎ区', district: '町B', median: 56_000 },
    { ...base.groups[0]!, city: '高すぎ区', district: '町C', median: 3_600_000 },
  ];
  return { ...base, groups: [...base.groups, ...bad] };
}

function makeGroup(
  partial: Partial<MarketGroup> & { city: string; district: string; median: number },
): MarketGroup {
  return {
    pref: '東京都',
    yearBand: '2011-2020',
    n: 20,
    q1: Math.round(partial.median * 0.85),
    q3: Math.round(partial.median * 1.15),
    areaMedian: 50,
    structure: 'ＲＣ',
    cityPlanning: '商業地域',
    ...partial,
  };
}

/**
 * 低価格帯の出題候補を、あえて「2市区町村 × 各2町丁」だけに絞ったデータ。
 * さらに、そのうち1市区町村（低額A）を中価格帯の候補（低額A|町3）とも
 * 共有させている。
 *
 * 単に低価格帯を2市区町村・2町丁に絞るだけでは「同一市区町村は最大2問」の
 * 上限に絶対にぶつからない（低価格帯は日付ごとの選定で必ず一番手＝空の状態
 * から2問を選べるため）。上限が実際に効いてくるのは、複数の価格帯が同じ
 * 市区町村を取り合うときだけである。そこで、中価格帯側に「低額A|町3
 * （低価格帯と同じ市区町村・別の町丁）」と「中額B|町1（独立した1市区町村）」
 * の2枠しか候補を用意しない――中価格帯自身の達成可能な最大値も2に絞る。
 *
 * こうすると、低価格帯の選定が低額Aの2町丁を両方とも使い切った場合
 * （市区町村の2問上限を使い切る）、中価格帯は低額A|町3を使えなくなり、
 * 独立枠の中額B|町1だけでは1問しか確保できない。価格帯を「安い順」に
 * 機械的に処理する実装は、この取り合いを考慮せずに低価格帯を先に処理して
 * しまうため、日付によっては中価格帯が1問しか出ない。
 *
 * 高価格帯は12市区町村に分散させ、上限や町丁の重複とは無縁の「多数の
 * 独立した市区町村」を保っている。
 *
 * 各群の中央値・成約件数は出題条件（MIN_SAMPLES・ELIGIBLE_MIN/MAX）を
 * すべて満たす。低・中価格帯は「件数の水増し」のため同一市区町村・町丁の
 * 組み合わせを複数の築年帯で繰り返しているが、実際に区別されるのは
 * 市区町村・町丁の組み合わせだけである。
 */
export function makeFixtureWithScarceBand(): MarketData {
  const groups: MarketGroup[] = [];
  const yb: YearBand[] = ['~1980', '1981-1990', '1991-2000', '2001-2010', '2011-2020', '2021-'];

  // 低価格帯: 低額A・低額B の2市区町村 × 町1・町2 の2町丁 = 4通り。
  // 全体の下位1/3（tercile境界）をちょうど埋めるよう、各組み合わせを
  // 3つの築年帯で繰り返し、12件にする。
  let priceStep = 0;
  for (const city of ['低額A', '低額B']) {
    for (const district of ['町1', '町2']) {
      for (let k = 0; k < 3; k++) {
        groups.push(
          makeGroup({ city, district, median: 205_000 + priceStep * 100, yearBand: yb[k]! }),
        );
        priceStep++;
      }
    }
  }

  // 中価格帯: 低額A|町3（低価格帯と同じ市区町村・別の町丁）を11件（築年帯を
  // 繰り返して水増し）＋ 中額B|町1 を1件。市区町村としては低額Aと中額Bの
  // 2つしかなく、達成可能な最大値も2で頭打ちになる。
  for (let k = 0; k < 11; k++) {
    groups.push(
      makeGroup({ city: '低額A', district: '町3', median: 1_400_000, yearBand: yb[k % 6]! }),
    );
  }
  groups.push(makeGroup({ city: '中額B', district: '町1', median: 1_410_000 }));

  // 高価格帯: 12市区町村に分散（上限・重複の影響を受けない多数派）。
  for (let i = 0; i < 12; i++) {
    groups.push(
      makeGroup({ city: `高額${i}`, district: '町1', median: 2_800_000 + i * 1_000 }),
    );
  }

  return { sourceYear: 2024, fetchedAt: '2026-09-09', groups };
}

/**
 * 「取り合いになる市区町村」の再現データ。
 *
 * - 低価格帯: 3町丁 — 1つは共有市区町村 `C`、残り2つは独立した市区町村。
 * - 中価格帯: 5町丁 — すべて市区町村 `C` の中。
 * - 高価格帯: 12市区町村に分散（上限・重複の影響を受けない多数派）。
 *
 * 各帯12件ずつ・計36件にして、tercile境界（t1=len/3, t2=len*2/3）が
 * ちょうど帯の境界と一致するようにしている（このことはテスト側で
 * アサーションにより検証する）。
 *
 * 市区町村 `C` の枠は全体で2つしかない（同一市区町村は最大2問）。
 * 低価格帯が共有町丁（C|町C1）を選ぶと、Cの枠は残り1つになり、中価格帯は
 * 5町丁すべてがCの中にあるため1問しか確保できなくなる。低価格帯が
 * 共有町丁を避けて独立した2町丁だけで自分の2問を満たせば、Cの2枠が
 * まるごと中価格帯に残り、中価格帯も2問確保できる。安い順に固定処理する
 * 実装は、低価格帯が先に処理される際にこの選択の余地（共有町丁を取るか
 * 避けるか）を考慮しないため、日付によっては中価格帯が1問しか出ない。
 */
export function makeFixtureWithContendedCity(): MarketData {
  const groups: MarketGroup[] = [];
  const yb: YearBand[] = ['~1980', '1981-1990', '1991-2000', '2001-2010', '2011-2020', '2021-'];

  // 低価格帯: 12件を3町丁に配分（4件ずつ）。
  const lowDistricts: Array<{ city: string; district: string }> = [
    { city: 'C', district: '町C1' },
    { city: '低独立1', district: '町1' },
    { city: '低独立2', district: '町1' },
  ];
  let i = 0;
  for (const { city, district } of lowDistricts) {
    for (let k = 0; k < 4; k++) {
      groups.push(
        makeGroup({ city, district, median: 210_000 + i * 1_000, yearBand: yb[i % 6]! }),
      );
      i++;
    }
  }

  // 中価格帯: 12件を市区町村Cの5町丁に配分（3,3,2,2,2）。
  const midCounts = [3, 3, 2, 2, 2];
  i = 0;
  midCounts.forEach((count, idx) => {
    for (let k = 0; k < count; k++) {
      groups.push(
        makeGroup({
          city: 'C',
          district: `町M${idx + 1}`,
          median: 1_000_000 + i * 1_000,
          yearBand: yb[i % 6]!,
        }),
      );
      i++;
    }
  });

  // 高価格帯: 12市区町村 × 各1町丁（完全に独立、上限に無縁）。
  for (let k = 0; k < 12; k++) {
    groups.push(
      makeGroup({ city: `高独立${k}`, district: '町1', median: 2_500_000 + k * 1_000 }),
    );
  }

  return { sourceYear: 2024, fetchedAt: '2026-09-09', groups };
}
