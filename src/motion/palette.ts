/**
 * 映像の配色。
 *
 * 出典: dataviz スキルの検証済みリファレンスパレット（ダークサーフェス用の段）。
 * 単価は「量」なので青1色の連続ランプ、強調だけ橙を当てる。
 * 虹色は使わない。文字には系列色を乗せず、必ずインク色を使う。
 */

/** 画面の地。 */
export const BG = '#111110';

/** パネル面。地よりわずかに明るい。 */
export const SURFACE = '#1a1a19';

/** 主文字。 */
export const INK = '#ffffff';

/** 副文字。 */
export const INK_SUB = '#c3c2b7';

/** 補助文字。出典や注記。 */
export const INK_MUTED = '#86857c';

/** 罫線・グリッド。数字より必ず後ろに退く。 */
export const RULE = '#34342f';

/** 強調（1か所だけに使う）。categorical slot 2 のダーク段。 */
export const ACCENT = '#d95926';

/**
 * 単価用の連続ランプ（暗い＝安い → 明るい＝高い）。
 * ダーク面での序数ランプの下限（step 600）より暗くしない。
 */
export const PRICE_RAMP: readonly string[] = [
  '#184f95', // 600
  '#1c5cab', // 550
  '#256abf', // 500
  '#2a78d6', // 450
  '#3987e5', // 400
  '#5598e7', // 350
  '#6da7ec', // 300
  '#86b6ef', // 250
  '#9ec5f4', // 200
  '#b7d3f6', // 150
  '#cde2fb', // 100
];

/** 0..1 の強さをランプ上の色に写す。 */
export function rampColor(t: number): string {
  const n = PRICE_RAMP.length;
  const i = Math.round(Math.min(1, Math.max(0, t)) * (n - 1));
  return PRICE_RAMP[i] ?? '#3987e5';
}

/** '#rrggbb' に不透明度を足して 'rgba(...)' にする。 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
