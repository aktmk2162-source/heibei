/**
 * モーショングラフィックス用の時間・補間ヘルパー。
 *
 * 映像は「経過時刻」ではなく「フレーム番号」だけから決まるようにしてある。
 * 同じフレーム番号からは必ず同じ絵が出るので、ブラウザ再生と
 * ヘッドレス書き出し（tools/renderMotion.mjs）が完全に一致する。
 */

/** 0..1 に丸める。 */
export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** a から b へ t（0..1）で線形補間する。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 終わりに向かって減速する。要素の登場に使う。 */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** 強く減速する。数字のカウントアップに使う。 */
export function easeOutExpo(t: number): number {
  const c = clamp01(t);
  return c >= 1 ? 1 : 1 - Math.pow(2, -10 * c);
}

/** 前後が滑らかになる。位置の移動に使う。 */
export function easeInOutCubic(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * 秒で書いた区間に対する進捗（0..1）を返す。
 * durSec が 0 以下なら、startSec を過ぎているかどうかの 0/1 を返す。
 */
export function progress(timeSec: number, startSec: number, durSec: number): number {
  if (durSec <= 0) return timeSec >= startSec ? 1 : 0;
  return clamp01((timeSec - startSec) / durSec);
}

/**
 * 「入って、保って、出る」の不透明度（0..1）を返す。
 * fadeSec は入りと出のそれぞれにかかる秒数。
 */
export function fadeInOut(
  timeSec: number,
  startSec: number,
  durSec: number,
  fadeSec: number,
): number {
  if (timeSec <= startSec || timeSec >= startSec + durSec) return 0;
  const inAlpha = progress(timeSec, startSec, fadeSec);
  const outAlpha = 1 - progress(timeSec, startSec + durSec - fadeSec, fadeSec);
  return Math.min(inAlpha, outAlpha);
}

/**
 * 要素を順番に遅らせて出すときの、i 番目の進捗（0..1）。
 * 全体が startSec から stepSec 刻みで始まり、各要素は durSec かけて出る。
 */
export function staggered(
  timeSec: number,
  index: number,
  startSec: number,
  stepSec: number,
  durSec: number,
): number {
  return progress(timeSec, startSec + index * stepSec, durSec);
}
