// tools/measureSkillGap.mjs
//
// HEIBEI のランク閾値を実測で見直すための計測スクリプト。
// src/data/market.json 全件（出題対象の絞り込み後）に対して、
// 「相場を知っている打ち手（informed）」と「何も知らない打ち手（naive）」の
// 2つの回答戦略をシミュレーションし、平均誤差率・平均得点・8問換算点・
// 新ランク閾値でのランクを出す。
//
// 実行:
//   node tools/measureSkillGap.mjs
//   （npm run measure でも同じ）
//
// 依存ゼロ・ビルド不要の素の Node ES module。TypeScript の src/quiz/score.ts
// は import せず、採点ロジック（pointsFor 相当）をここに複製している。
//   ★ src/quiz/score.ts の pointsFor を変更したら、このスクリプトの
//     pointsFor() も同じ内容に手動で合わせること（自動では同期されない）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKET_PATH = join(__dirname, '..', 'src', 'data', 'market.json');

// --- 出題条件（src/constants.ts と同じ値。単位: 円/㎡・件） ---
// ★ src/constants.ts の MIN_SAMPLES / ELIGIBLE_MIN / ELIGIBLE_MAX と
//   必ず同じ値に保つこと（自動では同期されない）。
const MIN_SAMPLES = 8;
const ELIGIBLE_MIN = 200_000;
const ELIGIBLE_MAX = 3_500_000;

// --- 採点ロジック（src/quiz/score.ts の pointsFor の複製） ---
function pointsFor(e) {
  if (e <= 0.02) return 100;
  if (e >= 0.3) return 0;
  return Math.round((100 * (0.3 - e)) / 0.28);
}

function errorRateOf(guess, truth) {
  return Math.abs(guess - truth) / truth;
}

// --- 新ランク閾値（src/quiz/score.ts の gradeFor の複製） ---
function gradeFor(meanErrorRate) {
  if (meanErrorRate <= 0.1) return 'S';
  if (meanErrorRate <= 0.14) return 'A';
  if (meanErrorRate <= 0.18) return 'B';
  if (meanErrorRate <= 0.24) return 'C';
  return 'D';
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// 線形補間による百分位数（numpy のデフォルトと同じ方式）。
function percentile(nums, p) {
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function mean(nums) {
  return nums.reduce((s, x) => s + x, 0) / nums.length;
}

function formatPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

// --- データ読み込み ---
const raw = readFileSync(MARKET_PATH, 'utf8');
const data = JSON.parse(raw);

// --- 出題対象の絞り込み（ゲーム本体の eligibleGroups と同じ条件） ---
const eligible = data.groups.filter(
  (g) => g.n >= MIN_SAMPLES && g.median >= ELIGIBLE_MIN && g.median <= ELIGIBLE_MAX,
);

if (eligible.length === 0) {
  console.error('出題条件を満たす群がありません。market.json を確認してください。');
  process.exit(1);
}

// --- 全体中央値（「何も知らない」打ち手が連打する値） ---
const globalMedian = median(eligible.map((g) => g.median));

// --- 「相場を知っている」打ち手の推定値: 同一 pref+city+yearBand・別 district の
//     群の中央値の中央値（ピアがいなければ全体中央値にフォールバック） ---
const bucketKey = (g) => `${g.pref}|${g.city}|${g.yearBand}`;
const buckets = new Map();
for (const g of eligible) {
  const key = bucketKey(g);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(g);
}

let fallbackCount = 0;

function informedGuessFor(g) {
  const peers = buckets.get(bucketKey(g)).filter((p) => p.district !== g.district);
  if (peers.length === 0) {
    fallbackCount++;
    return globalMedian;
  }
  return median(peers.map((p) => p.median));
}

// --- 各群を1問として、2つの打ち手をシミュレーション ---
const informedErrors = [];
const informedPoints = [];
const naiveErrors = [];
const naivePoints = [];

for (const g of eligible) {
  const truth = g.median;

  const informedGuess = informedGuessFor(g);
  const eInformed = errorRateOf(informedGuess, truth);
  informedErrors.push(eInformed);
  informedPoints.push(pointsFor(eInformed));

  const eNaive = errorRateOf(globalMedian, truth);
  naiveErrors.push(eNaive);
  naivePoints.push(pointsFor(eNaive));
}

function report(label, errors, points) {
  const meanError = mean(errors);
  const meanPoint = mean(points);
  const eightQ = Math.round(meanPoint * 8);
  const grade = gradeFor(meanError);
  console.log(`【${label}】`);
  console.log(`  平均誤差率: ${formatPct(meanError)}`);
  console.log(`  平均得点/問: ${meanPoint.toFixed(1)}`);
  console.log(`  8問換算: ${eightQ}/800`);
  console.log(`  新ランク閾値でのランク: ${grade}`);
  return { meanError, meanPoint, eightQ, grade };
}

console.log(`対象群数（出題条件を満たす群の全数）: ${eligible.length}`);
console.log(`全体中央値（globalMedian）: ${Math.round(globalMedian)} 円/㎡`);
console.log('');

report('相場を知っている打ち手（informed）', informedErrors, informedPoints);
console.log('');
report('何も知らない打ち手（naive・全体中央値を連打）', naiveErrors, naivePoints);
console.log('');

console.log('【informed の誤差率分布】');
console.log(`  25%tile: ${formatPct(percentile(informedErrors, 25))}`);
console.log(`  50%tile: ${formatPct(percentile(informedErrors, 50))}`);
console.log(`  75%tile: ${formatPct(percentile(informedErrors, 75))}`);
console.log(`  90%tile: ${formatPct(percentile(informedErrors, 90))}`);
const within5pct = informedErrors.filter((e) => e <= 0.05).length / informedErrors.length;
console.log(`  誤差5%以内の割合: ${formatPct(within5pct)}`);
console.log('');

console.log(
  `ピア（同一市区町村・築年帯で他の町丁）が0件で全体中央値にフォールバックした群: ${fallbackCount} / ${eligible.length}`,
);
