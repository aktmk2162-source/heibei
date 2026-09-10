import { SLIDER_MAX, SLIDER_MIN } from '../constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  /** 余白と文字サイズの基準 */
  unit: number;
  /** 出題カード */
  card: Rect;
  /** スライダーの帯 */
  slider: Rect;
  /** 確定ボタン */
  confirm: Rect;
  /** 残り時間バー */
  timer: Rect;
  /** 入力中の単価と総額の表示 */
  readout: Rect;
  /** 判定画面の「成約レンジ …」キャプションのテキストベースライン */
  captionBaseline: number;
  /** 結果画面の出典・免責（NOTICE）を描く領域 */
  notice: Rect;
  /** タイトル画面右上のミュート切替ボタン */
  mute: Rect;
}

/** NOTICE（出典・免責）の行数。src/render/draw.ts の NOTICE 配列と一致させること。 */
const NOTICE_LINE_COUNT = 8;

const LN_MIN = Math.log(SLIDER_MIN);
const LN_MAX = Math.log(SLIDER_MAX);

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** スライダー位置 t（0..1）を㎡単価（円/㎡）へ。対数スケール。 */
export function tToUnitPrice(t: number): number {
  return Math.exp(LN_MIN + (LN_MAX - LN_MIN) * clamp01(t));
}

/** ㎡単価（円/㎡）をスライダー位置 t（0..1）へ。 */
export function unitPriceToT(v: number): number {
  return clamp01((Math.log(v) - LN_MIN) / (LN_MAX - LN_MIN));
}

/** スライダー帯の中の x 座標を t へ。 */
export function xToT(x: number, slider: Rect): number {
  if (slider.w <= 0) return 0;
  return clamp01((x - slider.x) / slider.w);
}

export function hitTest(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * スマートフォンの縦画面を基準に、上からカード・読み取り・スライダー・確定ボタンを積む。
 * 横長でも同じ順序のまま、幅を 520px までに制限して中央へ寄せる。
 */
export function computeLayout(width: number, height: number): Layout {
  const unit = Math.max(8, Math.min(width, height) / 40);
  const contentW = Math.min(width - unit * 2, 520);
  const left = Math.round((width - contentW) / 2);

  const timerH = Math.max(6, unit * 0.6);
  const timer: Rect = { x: left, y: unit, w: contentW, h: timerH };

  // タイトル画面右上のミュートボタン。指で押せる大きさ（44×44 以上）を確保しつつ、
  // timer の下に unit 分の隙間を空けて重ならないようにする。
  const muteSize = Math.max(44, unit * 4);
  const mute: Rect = {
    x: width - unit - muteSize,
    y: timer.y + timer.h + unit,
    w: muteSize,
    h: muteSize,
  };

  const confirmH = Math.max(44, unit * 5);
  const confirm: Rect = {
    x: left,
    y: height - unit - confirmH,
    w: contentW,
    h: confirmH,
  };

  const sliderH = Math.max(40, unit * 4);
  const slider: Rect = {
    x: left,
    y: confirm.y - unit - sliderH,
    w: contentW,
    h: sliderH,
  };

  const readoutH = Math.max(36, unit * 4);
  const readout: Rect = {
    x: left,
    y: slider.y - unit - readoutH,
    w: contentW,
    h: readoutH,
  };

  const cardTop = timer.y + timer.h + unit;
  const card: Rect = {
    x: left,
    y: cardTop,
    w: contentW,
    h: Math.max(0, readout.y - unit - cardTop),
  };

  // カード下部の余白に置く。card 内かつ readout より上であることをテストで保証する。
  const captionBaseline = card.y + card.h - unit * 1.2;

  // 結果画面には確定ボタンの unit 分上に共有URLのプレビュー行が別途描かれる
  // （drawResult 内、l.confirm.y - unit のベースライン）。notice の下端をそこへ
  // ぴったり合わせると行の重なりが生じるため、2.5*unit 上で止めて隙間を確保する。
  // それでも confirm.y - unit 以下（＝要件を満たす）である。
  const noticeBottom = confirm.y - unit * 2.5;
  const noticeLineH = Math.max(13, unit * 1.35);
  const noticeDesiredH = NOTICE_LINE_COUNT * noticeLineH + unit * 2;
  const noticeTop = Math.max(0, noticeBottom - noticeDesiredH);
  const notice: Rect = {
    x: left,
    y: noticeTop,
    w: contentW,
    h: noticeBottom - noticeTop,
  };

  return { width, height, unit, card, slider, confirm, timer, readout, captionBaseline, notice, mute };
}
