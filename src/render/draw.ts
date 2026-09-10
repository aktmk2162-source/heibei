import type { MarketData, MarketGroup } from '../types';
import type { GameState } from '../game/state';
import { currentQuestion, toResult } from '../game/state';
import { TIME_LIMIT_MS } from '../constants';
import { buildShareText } from '../share/shareText';
import type { Layout, Rect } from './layout';
import { tToUnitPrice, unitPriceToT } from './layout';

const BG = '#10141a';
const FG = '#e6edf3';
const DIM = '#8b98a8';
const ACCENT = '#6EB92B';
const WARN = '#e0533d';
const PANEL = '#1a212b';

const man = (yen: number): string => (yen / 10_000).toFixed(1);
const oku = (yen: number): string => (yen / 100_000_000).toFixed(2);

function panel(ctx: CanvasRenderingContext2D, r: Rect, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(12, r.h / 4));
  ctx.fill();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
): void {
  ctx.fillStyle = color;
  ctx.font = `${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

const NOTICE = [
  '出典：国土交通省 不動産情報ライブラリ',
  'https://www.reinfolib.mlit.go.jp/',
  '成約価格情報を町丁・築年帯ごとの中央値等に集計・加工したものです。',
  '国土交通省が作成したものではありません。',
  'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、',
  '提供情報の最新性、正確性、完全性等が保証されたものではありません。',
  '個人制作のゲームです。特定の不動産の取引を勧誘するものではなく、',
  '査定・投資判断に用いることはできません。',
];

/** 右上のミュード切替ボタン。当たり判定（loop.ts）と同じ l.mute を描く。 */
function drawMuteButton(ctx: CanvasRenderingContext2D, r: Rect, muted: boolean): void {
  panel(ctx, r, PANEL);
  text(ctx, muted ? '♪×' : '♪', r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.16, r.h * 0.42, muted ? DIM : ACCENT, 'center');
}

function drawTitle(ctx: CanvasRenderingContext2D, l: Layout, market: MarketData, muted: boolean): void {
  const cx = l.width / 2;
  text(ctx, 'HEIBEI', cx, l.height * 0.28, l.unit * 4, FG, 'center');
  text(ctx, '中古マンションの成約㎡単価を10秒で当てる', cx, l.height * 0.28 + l.unit * 3, l.unit * 1.4, DIM, 'center');
  text(ctx, `全8問 ／ 対象年 ${market.sourceYear}年`, cx, l.height * 0.28 + l.unit * 5.4, l.unit * 1.4, DIM, 'center');

  panel(ctx, l.confirm, ACCENT);
  text(ctx, 'はじめる', cx, l.confirm.y + l.confirm.h / 2 + l.unit * 0.6, l.unit * 2, '#0b0f14', 'center');

  drawMuteButton(ctx, l.mute, muted);

  let y = l.height * 0.52;
  for (const line of NOTICE) {
    text(ctx, line, cx, y, Math.max(9, l.unit * 0.95), DIM, 'center');
    y += Math.max(13, l.unit * 1.35);
  }
  text(ctx, `取得日 ${market.fetchedAt}`, cx, y + l.unit, Math.max(9, l.unit * 0.95), DIM, 'center');
}

function drawCard(ctx: CanvasRenderingContext2D, l: Layout, q: MarketGroup, market: MarketData, index: number): void {
  panel(ctx, l.card, PANEL);
  const px = l.card.x + l.unit;
  let y = l.card.y + l.unit * 2.4;
  text(ctx, `第${index + 1}問 / 8`, px, y, l.unit * 1.2, DIM);
  y += l.unit * 2.6;
  text(ctx, `${q.pref} ${q.city}`, px, y, l.unit * 1.6, DIM);
  y += l.unit * 2.6;
  text(ctx, q.district, px, y, l.unit * 3, FG);
  y += l.unit * 3;
  text(ctx, `中古マンション ／ ${q.yearBand.replace('~', '〜')}年築 ／ ${q.structure}`, px, y, l.unit * 1.4, FG);
  y += l.unit * 2.2;
  text(ctx, q.cityPlanning, px, y, l.unit * 1.4, FG);
  y += l.unit * 2.2;
  text(ctx, `専有面積の中央値 ${q.areaMedian}㎡ ／ 成約 ${q.n}件`, px, y, l.unit * 1.4, FG);
  y += l.unit * 2.2;
  text(ctx, `成約時点 ${market.sourceYear}年`, px, y, l.unit * 1.4, DIM);
}

function drawSlider(ctx: CanvasRenderingContext2D, l: Layout, t: number): void {
  panel(ctx, l.slider, PANEL);
  const knobX = l.slider.x + l.slider.w * t;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.roundRect(l.slider.x, l.slider.y, l.slider.w * t, l.slider.h, Math.min(12, l.slider.h / 4));
  ctx.fill();
  ctx.fillStyle = FG;
  ctx.beginPath();
  ctx.arc(knobX, l.slider.y + l.slider.h / 2, l.slider.h * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

function drawTimer(ctx: CanvasRenderingContext2D, l: Layout, elapsedMs: number): void {
  const remain = Math.max(0, 1 - elapsedMs / TIME_LIMIT_MS);
  panel(ctx, l.timer, PANEL);
  ctx.fillStyle = remain < 0.3 ? WARN : ACCENT;
  ctx.beginPath();
  ctx.roundRect(l.timer.x, l.timer.y, l.timer.w * remain, l.timer.h, l.timer.h / 2);
  ctx.fill();
}

function drawQuestion(ctx: CanvasRenderingContext2D, l: Layout, s: GameState, market: MarketData): void {
  const q = currentQuestion(s);
  if (q === null) return;
  drawTimer(ctx, l, s.elapsedMs);
  drawCard(ctx, l, q, market, s.index);

  const unitPrice = tToUnitPrice(s.sliderT);
  const total = unitPrice * q.areaMedian;
  const cx = l.width / 2;
  // 総額の行とスライダー帯の間隔が詰まっていたため、2行とも 0.3*unit 上へ寄せて
  // 隙間を広げる（2行間の間隔は変えないので新たな重なりは生じない）。
  text(ctx, `${man(unitPrice)} 万円/㎡`, cx, l.readout.y + l.unit * 2.3, l.unit * 3, FG, 'center');
  text(ctx, `総額 ${oku(total)} 億円`, cx, l.readout.y + l.unit * 4.3, l.unit * 1.4, DIM, 'center');

  drawSlider(ctx, l, s.sliderT);
  panel(ctx, l.confirm, ACCENT);
  text(ctx, '決定', cx, l.confirm.y + l.confirm.h / 2 + l.unit * 0.6, l.unit * 2, '#0b0f14', 'center');
}

function drawReveal(ctx: CanvasRenderingContext2D, l: Layout, s: GameState, market: MarketData): void {
  const q = currentQuestion(s);
  const a = s.answers[s.answers.length - 1];
  if (q === null || a === undefined) return;
  drawCard(ctx, l, q, market, s.index);

  const cx = l.width / 2;
  text(ctx, `正解 ${man(q.median)} 万円/㎡`, cx, l.readout.y + l.unit * 2.2, l.unit * 2.4, ACCENT, 'center');
  const yourText = a.guess === null ? '時間切れ' : `あなた ${man(a.guess)} 万円/㎡`;
  text(ctx, yourText, cx, l.readout.y + l.unit * 4.4, l.unit * 1.5, FG, 'center');

  panel(ctx, l.slider, PANEL);
  const y = l.slider.y + l.slider.h / 2;
  const tx = (v: number): number => l.slider.x + l.slider.w * unitPriceToT(v);
  ctx.fillStyle = DIM;
  ctx.fillRect(tx(q.q1), y - l.slider.h * 0.18, Math.max(2, tx(q.q3) - tx(q.q1)), l.slider.h * 0.36);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(tx(q.median) - 2, y - l.slider.h * 0.34, 4, l.slider.h * 0.68);
  if (a.guess !== null) {
    ctx.fillStyle = FG;
    ctx.beginPath();
    ctx.arc(tx(a.guess), y, l.slider.h * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  // l.captionBaseline はカード下部の余白（card 内・readout より上）に置かれており、
  // 確定ボタン（l.confirm）の描画範囲と重ならないことをレイアウトのテストで保証している。
  text(
    ctx,
    `成約レンジ ${man(q.q1)}〜${man(q.q3)} 万円/㎡（n=${q.n}）`,
    cx,
    l.captionBaseline,
    l.unit * 1.2,
    DIM,
    'center',
  );

  panel(ctx, l.confirm, ACCENT);
  const label = `${a.tile}  誤差 ${(a.errorRate * 100).toFixed(1)}%  ${a.points}点  ▶`;
  text(ctx, label, cx, l.confirm.y + l.confirm.h / 2 + l.unit * 0.6, l.unit * 1.6, '#0b0f14', 'center');
}

function drawResult(ctx: CanvasRenderingContext2D, l: Layout, s: GameState): void {
  const r = toResult(s);
  const cx = l.width / 2;
  text(ctx, `${r.totalPoints} / 800`, cx, l.height * 0.24, l.unit * 4, FG, 'center');
  text(ctx, `ランク ${r.grade}`, cx, l.height * 0.24 + l.unit * 3.4, l.unit * 2.4, ACCENT, 'center');
  text(
    ctx,
    `平均誤差 ${(r.meanErrorRate * 100).toFixed(1)}%`,
    cx,
    l.height * 0.24 + l.unit * 6,
    l.unit * 1.6,
    DIM,
    'center',
  );
  text(ctx, r.answers.map((a) => a.tile).join(''), cx, l.height * 0.24 + l.unit * 9, l.unit * 2.4, FG, 'center');

  // l.notice はタイル行と確定ボタンの間の空きに置かれる（layout.ts でテスト済み）。
  // 行数から行高を算出するので、フォントサイズを固定値で決め打ちしない。
  const noticeLineH = l.notice.h / NOTICE.length;
  let noticeY = l.notice.y + noticeLineH * 0.8;
  for (const line of NOTICE) {
    text(ctx, line, cx, noticeY, Math.max(8, noticeLineH * 0.68), DIM, 'center');
    noticeY += noticeLineH;
  }

  panel(ctx, l.confirm, ACCENT);
  text(ctx, '結果をコピー', cx, l.confirm.y + l.confirm.h / 2 + l.unit * 0.6, l.unit * 1.8, '#0b0f14', 'center');
  text(ctx, buildShareText(r).split('\n')[3] ?? '', cx, l.confirm.y - l.unit, l.unit * 1.1, DIM, 'center');
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  s: GameState,
  l: Layout,
  market: MarketData,
  muted = false,
): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, l.width, l.height);
  switch (s.phase) {
    case 'title':
      drawTitle(ctx, l, market, muted);
      break;
    case 'question':
      drawQuestion(ctx, l, s, market);
      break;
    case 'reveal':
      drawReveal(ctx, l, s, market);
      break;
    case 'result':
      drawResult(ctx, l, s);
      break;
  }
}
