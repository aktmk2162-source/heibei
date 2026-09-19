/**
 * 1フレームを描く。
 *
 * 描画はフレーム番号だけで決まる（時計を読まない）。
 * だからブラウザでの再生と、ヘッドレスでの書き出しが同じ絵になる。
 */
import { ACCENT, BG, INK, INK_MUTED, INK_SUB, RULE, rampColor, withAlpha } from './palette';
import {
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  easeOutExpo,
  fadeInOut,
  lerp,
  progress,
  staggered,
} from './ease';
import { HEIGHT, WIDTH, frameToSec, sceneAt } from './scenes';
import { SHARE_URL } from '../constants';
import type { MotionData } from './data';

const FONT = '"Hiragino Sans", "Noto Sans JP", "IPAGothic", "Yu Gothic", system-ui, sans-serif';

const SOURCE_LINE = '出典：国土交通省 不動産情報ライブラリ（成約価格情報）';

/** 末尾に出す遷移先。スキームは読み上げの邪魔なので落とす。 */
const SHARE_LABEL = SHARE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

interface TextOpts {
  size: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
  bold?: boolean;
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts): void {
  const alpha = o.alpha ?? 1;
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${o.bold ? '600 ' : ''}${o.size}px ${FONT}`;
  ctx.fillStyle = o.color ?? INK;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** 横罫。データより必ず後ろに退く太さにする。 */
function rule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  alpha: number,
  color = RULE,
): void {
  if (alpha <= 0 || w <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.restore();
}

/** 棒。左端は基線に揃え、データ側の端だけ 4px 丸める。 */
function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0 || w <= 0.5) return;
  const r = Math.min(4, w / 2, h / 2);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 文字の背面を地色で埋める。
 * 数字の「0」のような中空の字形は、後ろの罫線が内側から透けて読み違いのもとになる。
 */
function textPlate(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  alpha: number,
  bold = false,
): void {
  if (alpha <= 0) return;
  const w = measure(ctx, s, size, bold);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = BG;
  ctx.fillRect(x - 5, y - size * 0.82, w + 10, size * 1.1);
  ctx.restore();
}

/** 3桁区切り。環境の地域設定に左右されないよう自前で組む。 */
export function formatInt(value: number): string {
  const n = Math.round(value);
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(n).toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i] ?? '';
  }
  return sign + out;
}

/** 円/㎡ を「万」単位の文字列にする。 */
export function formatMan(yen: number, digits = 1): string {
  return (yen / 10_000).toFixed(digits);
}

/** 画面の隅に出典を小さく置く。 */
function sourceCredit(ctx: CanvasRenderingContext2D, alpha: number): void {
  text(ctx, SOURCE_LINE, 80, HEIGHT - 52, { size: 21, color: INK_MUTED, alpha });
}

/**
 * 夜景の灯りを描く。
 *
 * 点は本編の散布図と同じ 1,032 群。冒頭でばらまいた灯りが、あとで築年帯の
 * 散布図になり、最後にまた灯りへ戻る。絵として地続きにするための仕掛け。
 *
 * @param settle 0 で散らばったまま、1 で中央へ寄る（散布図への前振り）
 * @param gain   全体の明るさ。末尾では落として文字を立たせる
 */
function drawField(
  ctx: CanvasRenderingContext2D,
  t: number,
  d: MotionData,
  settle: number,
  gain: number,
): void {
  const cy = HEIGHT / 2;
  for (const p of d.field) {
    // 出る順は位相から決める。データの並び順に左から出ると機械的に見える。
    const delay = 0.1 + (p.phase / (Math.PI * 2)) * 2.0;
    const appear = easeOutCubic(progress(t, delay, 1.1));
    if (appear <= 0) continue;

    // 手前ほど速く流れる。奥行きが出て、止まって見えなくなる。
    const x = p.x * WIDTH + Math.sin(t * 0.3 + p.phase) * 16 * p.depth;
    const drifted = p.y * HEIGHT - t * (5 + p.depth * 13);
    const y = lerp(drifted, cy + (drifted - cy) * 0.5, settle);

    ctx.save();
    ctx.globalAlpha *= (0.16 + p.depth * 0.55) * appear * gain;
    ctx.fillStyle = rampColor(clamp01(p.median / d.priceMax));
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + p.depth * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawOpening(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  drawField(ctx, t, d, easeInOutCubic(progress(t, 3.0, 2.6)), 1);

  text(ctx, `${d.totals.sourceYear}年　首都圏　中古マンション成約データ`, WIDTH / 2, HEIGHT - 150, {
    size: 28,
    color: INK_SUB,
    align: 'center',
    alpha: progress(t, 3.4, 1.0),
  });
  text(ctx, `${formatInt(d.totals.groups)}の町丁 × 築年帯`, WIDTH / 2, HEIGHT - 108, {
    size: 22,
    color: INK_MUTED,
    align: 'center',
    alpha: progress(t, 4.0, 1.0),
  });
}

function drawCoda(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  // 冒頭と同じ灯りへ戻す。文字を読ませたいので明るさは落とす。
  drawField(ctx, t + 2.0, d, 0, 0.45);

  const cx = WIDTH / 2;
  const inAlpha = easeOutCubic(progress(t, 0.5, 1.0));
  text(ctx, 'HEIBEI', cx, HEIGHT / 2 - 16, {
    size: 68,
    align: 'center',
    alpha: inAlpha,
    bold: true,
  });

  const ruleW = 360 * easeOutCubic(progress(t, 1.0, 0.9));
  rule(ctx, cx - ruleW / 2, HEIGHT / 2 + 22, ruleW, progress(t, 1.0, 0.9), INK_SUB);

  text(ctx, SHARE_LABEL, cx, HEIGHT / 2 + 76, {
    size: 26,
    color: INK_SUB,
    align: 'center',
    alpha: progress(t, 1.3, 0.9),
  });
}

function drawTitle(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  const ruleW = 520 * easeOutCubic(progress(t, 0.1, 1.0));
  rule(ctx, cx - ruleW / 2, cy - 150, ruleW, 1, INK_SUB);

  const tIn = easeOutCubic(progress(t, 0.55, 0.9));
  text(ctx, '相場は、町丁で決まる。', cx, cy + 20 + (1 - tIn) * 26, {
    size: 112,
    align: 'center',
    alpha: tIn,
  });

  const sIn = easeOutCubic(progress(t, 1.35, 0.8));
  text(ctx, '首都圏　中古マンション　成約㎡単価', cx, cy + 108, {
    size: 36,
    color: INK_SUB,
    align: 'center',
    alpha: sIn,
  });

  const mIn = progress(t, 1.95, 0.8);
  text(ctx, `${d.totals.sourceYear}年（暦年）成約価格情報　${SOURCE_LINE}`, cx, cy + 176, {
    size: 23,
    color: INK_MUTED,
    align: 'center',
    alpha: mIn,
  });
}

function drawScale(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  const tiles: { value: number; unit: string; label: string }[] = [
    { value: d.totals.deals, unit: '件', label: '成約件数' },
    { value: d.totals.districts, unit: '町丁', label: '対象エリア' },
    { value: d.totals.groups, unit: '', label: '町丁 × 築年帯 のグループ' },
  ];

  const tileW = 440;
  const gap = 60;
  const totalW = tileW * tiles.length + gap * (tiles.length - 1);
  const x0 = (WIDTH - totalW) / 2;
  const topY = HEIGHT / 2 - 110;

  text(ctx, `${d.totals.sourceYear}年、首都圏の中古マンション成約データ`, WIDTH / 2, topY - 120, {
    size: 34,
    color: INK_SUB,
    align: 'center',
    alpha: progress(t, 0.2, 0.7),
  });

  tiles.forEach((tile, i) => {
    const x = x0 + i * (tileW + gap);
    const p = staggered(t, i, 0.5, 0.55, 1.5);
    rule(ctx, x, topY, tileW * easeOutCubic(p), Math.min(1, p * 3));

    const shown = Math.round(tile.value * easeOutExpo(p));
    text(ctx, formatInt(shown), x, topY + 122, { size: 104, alpha: Math.min(1, p * 2), bold: true });

    if (tile.unit) {
      const numW = measure(ctx, formatInt(shown), 104, true);
      text(ctx, tile.unit, x + numW + 14, topY + 122, {
        size: 38,
        color: INK_SUB,
        alpha: Math.min(1, p * 2),
      });
    }
    text(ctx, tile.label, x, topY + 172, { size: 26, color: INK_MUTED, alpha: p });
  });

  text(ctx, `${d.totals.cities}の区市町村／成約件数8件以上のグループのみを集計`, WIDTH / 2, topY + 300, {
    size: 26,
    color: INK_MUTED,
    align: 'center',
    alpha: progress(t, 3.1, 0.8),
  });
  sourceCredit(ctx, progress(t, 3.1, 0.8));
}

function measure(
  ctx: CanvasRenderingContext2D,
  s: string,
  size: number,
  bold = false,
): number {
  ctx.save();
  ctx.font = `${bold ? '600 ' : ''}${size}px ${FONT}`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

const BAND_LABEL: Record<string, string> = {
  '~1980': '〜1980',
  '1981-1990': '81-90',
  '1991-2000': '91-00',
  '2001-2010': '01-10',
  '2011-2020': '11-20',
  '2021-': '21〜',
};

function drawBands(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  const plotX = 280;
  const plotY = 232;
  const plotW = 1380;
  const plotH = 636;
  const colW = plotW / d.bands.length;
  const yOf = (median: number): number => plotY + (1 - clamp01(median / d.priceMax)) * plotH;
  const xOf = (bandIndex: number, jitter: number): number =>
    plotX + colW * (bandIndex + 0.5) + jitter * (colW * 0.34);

  text(ctx, '築年帯別　㎡単価の分布', 80, 128, { size: 46, alpha: progress(t, 0.05, 0.6) });
  text(ctx, `1点 = 1グループ（町丁 × 築年帯）　全${formatInt(d.totals.groups)}点　縦軸は㎡単価（円）`, 80, 176, {
    size: 25,
    color: INK_MUTED,
    alpha: progress(t, 0.35, 0.6),
  });

  // 目盛り。数字より後ろに退かせる。
  const axisAlpha = progress(t, 0.4, 0.8);
  for (let v = 0; v <= 3_000_000; v += 1_000_000) {
    const y = yOf(v);
    rule(ctx, plotX, y, plotW, axisAlpha * 0.9);
    text(ctx, v === 0 ? '0' : `${formatMan(v, 0)}万`, plotX - 20, y + 9, {
      size: 24,
      color: INK_MUTED,
      align: 'right',
      alpha: axisAlpha,
    });
  }

  // 点。飛び込む順は jitter から決めるので、毎回同じ順で同じ位置に落ちる。
  for (const dot of d.dots) {
    const delay = 0.55 + ((dot.jitter + 1) / 2) * 1.6;
    const p = progress(t, delay, 0.7);
    if (p <= 0) continue;
    const e = easeOutCubic(p);
    const y = yOf(dot.median) + (1 - e) * 150;
    const x = xOf(dot.bandIndex, dot.jitter);
    ctx.save();
    ctx.globalAlpha *= e * 0.82;
    ctx.fillStyle = rampColor(clamp01(dot.median / d.priceMax));
    ctx.beginPath();
    ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  d.bands.forEach((band, i) => {
    const a = staggered(t, i, 1.9, 0.08, 0.6);
    text(ctx, BAND_LABEL[band.band] ?? band.band, plotX + colW * (i + 0.5), plotY + plotH + 46, {
      size: 27,
      color: INK_SUB,
      align: 'center',
      alpha: a,
    });
    text(ctx, `${formatInt(band.groups)}点`, plotX + colW * (i + 0.5), plotY + plotH + 78, {
      size: 21,
      color: INK_MUTED,
      align: 'center',
      alpha: a,
    });
  });

  // 中央値の折れ線。1本だけの系列なので凡例は置かず、見出しで示す。
  const lineP = easeOutCubic(progress(t, 3.0, 2.0));
  if (lineP > 0) {
    const pts = d.bands.map((b, i) => ({ x: plotX + colW * (i + 0.5), y: yOf(b.median) }));
    ctx.save();
    ctx.globalAlpha *= 1;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const totalSeg = pts.length - 1;
    const shown = lineP * totalSeg;
    const first = pts[0];
    if (first) {
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const cur = pts[i];
        if (!prev || !cur) continue;
        const segP = clamp01(shown - (i - 1));
        ctx.lineTo(lerp(prev.x, cur.x, segP), lerp(prev.y, cur.y, segP));
        if (segP < 1) break;
      }
      ctx.stroke();
    }
    // 丸は地の色で縁取りし、点群と重なっても形が残るようにする。
    pts.forEach((pt, i) => {
      if (shown < i) return;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = BG;
      ctx.stroke();
    });
    ctx.restore();

    d.bands.forEach((band, i) => {
      const pt = pts[i];
      if (!pt) return;
      const a = staggered(t, i, 3.3, 0.33, 0.5);
      text(ctx, `${formatMan(band.median)}万`, pt.x, pt.y - 24, {
        size: 27,
        align: 'center',
        alpha: a,
        bold: true,
      });
    });
    text(ctx, '各築年帯の中央値', plotX + colW * 0.5, yOf(d.bands[0]?.median ?? 0) + 44, {
      size: 23,
      color: ACCENT,
      align: 'center',
      alpha: progress(t, 3.5, 0.6),
    });
  }

  const noteA = fadeInOut(t, 5.9, 3.6, 0.7);
  if (noteA > 0) {
    const oldest = d.bands[0];
    const newest = d.bands[d.bands.length - 1];
    if (oldest && newest) {
      const ratio = newest.median / oldest.median;
      text(ctx, '築年が新しいほど、単価は上がる', WIDTH - 80, 128, {
        size: 40,
        align: 'right',
        alpha: noteA,
      });
      text(
        ctx,
        `〜1980年築 ${formatMan(oldest.median)}万 → 2021年〜 ${formatMan(newest.median)}万（${ratio.toFixed(1)}倍）`,
        WIDTH - 80,
        176,
        { size: 25, color: INK_SUB, align: 'right', alpha: noteA },
      );
    }
  }
  sourceCredit(ctx, progress(t, 1.0, 0.8));
}

function drawCities(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  const rows = d.cities;
  const top = rows[0];
  if (!top) return;
  const labelX = 540;
  const barX = 580;
  const barMaxW = 900;
  const rowH = 58;
  const barH = 40;
  const y0 = 252;
  const maxMedian = top.median;
  const minMedian = rows[rows.length - 1]?.median ?? 0;

  text(ctx, '区市町村別　㎡単価の中央値', 80, 128, { size: 46, alpha: progress(t, 0.05, 0.6) });
  text(ctx, '全築年帯をまとめた中央値／グループ10件以上の区市町村・上位10', 80, 176, {
    size: 25,
    color: INK_MUTED,
    alpha: progress(t, 0.3, 0.6),
  });

  rows.forEach((row, i) => {
    const p = staggered(t, i, 0.55, 0.12, 0.9);
    if (p <= 0) return;
    const e = easeOutCubic(p);
    const y = y0 + i * rowH;
    // 色は順位ではなく値に対応させる。下位でも地に沈まないよう 0.3 から始める。
    const span = maxMedian - minMedian;
    const norm = span > 0 ? (row.median - minMedian) / span : 1;
    const w = (row.median / maxMedian) * barMaxW * e;

    text(ctx, row.city, labelX, y + barH / 2 + 10, {
      size: 29,
      color: INK_SUB,
      align: 'right',
      alpha: Math.min(1, p * 2),
    });
    bar(ctx, barX, y, w, barH, rampColor(0.3 + norm * 0.7), 1);
    text(ctx, `${formatMan(row.median * easeOutExpo(p))}万`, barX + w + 18, y + barH / 2 + 10, {
      size: 28,
      alpha: Math.min(1, p * 2),
      bold: true,
    });
    text(ctx, `${row.groups}グループ`, WIDTH - 80, y + barH / 2 + 9, {
      size: 21,
      color: INK_MUTED,
      align: 'right',
      alpha: p * 0.9,
    });
  });

  const footA = fadeInOut(t, 4.2, 4.2, 0.7);
  if (footA > 0) {
    const low = d.cityLow;
    const ratio = top.median / low.median;
    rule(ctx, 80, HEIGHT - 148, WIDTH - 160, footA * 0.8);
    text(
      ctx,
      `最も安い${low.city}は${formatMan(low.median)}万円/㎡。${top.city}とは${ratio.toFixed(1)}倍の開きがある`,
      80,
      HEIGHT - 100,
      { size: 32, color: INK_SUB, alpha: footA },
    );
  }
  sourceCredit(ctx, progress(t, 0.6, 0.8));
}

function drawFocus(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  const f = d.focus;
  const rows = f.districts;
  const hi = rows[0];
  const lo = rows[rows.length - 1];
  if (!hi || !lo) return;

  // 終盤は図を沈めて、言いたいことだけを残す。
  const dim = progress(t, 6.5, 0.8);
  const chartAlpha = lerp(1, 0.1, dim);

  ctx.save();
  ctx.globalAlpha *= chartAlpha;

  const labelX = 520;
  const barX = 560;
  const barMaxW = 860;
  const y0 = 262;
  const rowH = 31;
  const barH = 22;
  const maxMedian = hi.median;

  text(ctx, '同じ区、同じ築年でも', 80, 128, { size: 46, alpha: progress(t, 0.05, 0.6) });
  text(
    ctx,
    `${f.city}／${f.band === '2001-2010' ? '2001〜2010年築' : f.band}　${rows.length}町丁・成約${formatInt(f.deals)}件`,
    80,
    176,
    { size: 25, color: INK_MUTED, alpha: progress(t, 0.3, 0.6) },
  );

  const highlight = progress(t, 4.4, 0.8);

  rows.forEach((row, i) => {
    const p = staggered(t, i, 0.7, 0.07, 0.8);
    if (p <= 0) return;
    const e = easeOutCubic(p);
    const y = y0 + i * rowH;
    const w = (row.median / maxMedian) * barMaxW * e;
    const isEnd = i === 0 || i === rows.length - 1;
    // 端の2つだけを橙にし、他は沈める。色だけに頼らないよう、値は全行に出す。
    const fade = isEnd ? 1 : lerp(1, 0.4, highlight);
    const color = isEnd && highlight > 0 ? ACCENT : rampColor(0.3 + (row.median / maxMedian) * 0.7);

    text(ctx, row.district, labelX, y + barH / 2 + 8, {
      size: 23,
      color: isEnd && highlight > 0.5 ? INK : INK_SUB,
      align: 'right',
      alpha: Math.min(1, p * 2),
    });
    bar(ctx, barX, y, w, barH, color, fade);
    text(ctx, `n=${row.deals}`, WIDTH - 260, y + barH / 2 + 7, {
      size: 18,
      color: INK_MUTED,
      align: 'right',
      alpha: p * 0.8 * fade,
    });
  });

  // 区全体の中央値。平均がどの町丁も説明しないことを、線で見せる。
  const medA = progress(t, 3.3, 0.8);
  if (medA > 0) {
    const mx = barX + (f.median / maxMedian) * barMaxW;
    ctx.save();
    ctx.globalAlpha *= medA;
    ctx.strokeStyle = INK_SUB;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(mx, y0 - 16);
    ctx.lineTo(mx, y0 + rows.length * rowH + 4);
    ctx.stroke();
    ctx.restore();
    text(ctx, `この区・この築年の中央値 ${formatMan(f.median)}万`, mx, y0 - 30, {
      size: 22,
      color: INK_SUB,
      align: 'center',
      alpha: medA,
    });
  }

  // 値は中央値の破線より前に、かつ不透明で置く。
  // 半透明のままだと後ろの破線が透けて数字が読めなくなる。沈めるのは棒だけにする。
  rows.forEach((row, i) => {
    const p = staggered(t, i, 0.7, 0.07, 0.8);
    if (p <= 0) return;
    const w = (row.median / maxMedian) * barMaxW * easeOutCubic(p);
    const label = `${formatMan(row.median * easeOutExpo(p))}万`;
    const lx = barX + w + 14;
    const ly = y0 + i * rowH + barH / 2 + 8;
    // 終盤は数値も一緒に引かせる。白のままだと言いたいことの邪魔になる。
    const la = Math.min(1, p * 2) * lerp(1, 0.65, dim);
    textPlate(ctx, label, lx, ly, 22, la, true);
    text(ctx, label, lx, ly, { size: 22, alpha: la, bold: true });
  });

  // 倍率。端2行の対比としてまとめて出す。
  const ratioA = progress(t, 5.3, 0.8);
  if (ratioA > 0) {
    const yTop = y0 + barH / 2;
    const yBot = y0 + (rows.length - 1) * rowH + barH / 2;
    const bx = WIDTH - 210;
    ctx.save();
    ctx.globalAlpha *= ratioA;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx - 14, yTop);
    ctx.lineTo(bx, yTop);
    ctx.lineTo(bx, yBot);
    ctx.lineTo(bx - 14, yBot);
    ctx.stroke();
    ctx.restore();
    text(ctx, `${f.ratio.toFixed(1)}倍`, bx + 16, (yTop + yBot) / 2 + 4, {
      size: 54,
      color: INK,
      alpha: ratioA,
      bold: true,
    });
    text(ctx, '最高と最低の開き', bx + 16, (yTop + yBot) / 2 + 42, {
      size: 22,
      color: INK_SUB,
      alpha: ratioA,
    });
  }
  ctx.restore();

  const msgA = progress(t, 7.0, 0.9);
  if (msgA > 0) {
    text(ctx, `「${f.city}の相場」という平均は、`, WIDTH / 2, HEIGHT / 2 - 34, {
      size: 72,
      align: 'center',
      alpha: msgA,
    });
    text(ctx, 'どの町丁にも当てはまらない。', WIDTH / 2, HEIGHT / 2 + 76, {
      size: 72,
      align: 'center',
      alpha: progress(t, 7.4, 0.9),
    });
  }
  sourceCredit(ctx, progress(t, 0.6, 0.8) * lerp(1, 0.3, dim));
}

function drawClosing(ctx: CanvasRenderingContext2D, t: number, d: MotionData): void {
  const cx = WIDTH / 2;
  const headIn = easeOutCubic(progress(t, 0.25, 0.9));
  text(ctx, 'だから、町丁で持つ。', cx, 396 + (1 - headIn) * 22, {
    size: 96,
    align: 'center',
    alpha: headIn,
  });

  const subA = progress(t, 1.5, 0.8);
  const ruleW = 560 * easeOutCubic(progress(t, 1.4, 0.8));
  rule(ctx, cx - ruleW / 2, 452, ruleW, subA, INK_SUB);
  text(
    ctx,
    `${formatInt(d.totals.districts)}町丁 × ${d.bands.length}築年帯 ＝ ${formatInt(d.totals.groups)}グループ／成約${formatInt(d.totals.deals)}件`,
    cx,
    514,
    { size: 34, color: INK_SUB, align: 'center', alpha: subA },
  );

  const noteA = progress(t, 2.5, 0.9);
  const notes = [
    `出典：国土交通省 不動産情報ライブラリ（成約価格情報・${d.totals.sourceYear}年）`,
    '同APIで取得したデータを町丁・築年帯ごとの中央値等に集計・加工したものです。国土交通省が作成したものではありません。',
    '特定の不動産の取引を勧誘するものではなく、査定・投資判断に用いることはできません。',
  ];
  notes.forEach((line, i) => {
    text(ctx, line, cx, 660 + i * 36, {
      size: 22,
      color: INK_MUTED,
      align: 'center',
      alpha: progress(t, 2.5 + i * 0.18, 0.9),
    });
  });
  void noteA;

  text(ctx, 'HEIBEI', cx, 852, {
    size: 30,
    color: INK_SUB,
    align: 'center',
    alpha: progress(t, 3.3, 0.8),
    bold: true,
  });
}

/** 指定フレームを ctx に描く。呼ぶ前に ctx のサイズを WIDTH × HEIGHT にしておくこと。 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  frame: number,
  data: MotionData,
): void {
  const timeSec = frameToSec(frame);
  const { scene, local } = sceneAt(timeSec);

  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 場面の出入り。中の動きはこれとは別に各場面が持つ。
  const enter = progress(local, 0, 0.35);
  const exit = 1 - progress(local, scene.duration - 0.6, 0.6);
  ctx.globalAlpha = Math.min(enter, exit);

  switch (scene.name) {
    case 'opening':
      drawOpening(ctx, local, data);
      break;
    case 'title':
      drawTitle(ctx, local, data);
      break;
    case 'scale':
      drawScale(ctx, local, data);
      break;
    case 'bands':
      drawBands(ctx, local, data);
      break;
    case 'cities':
      drawCities(ctx, local, data);
      break;
    case 'focus':
      drawFocus(ctx, local, data);
      break;
    case 'closing':
      drawClosing(ctx, local, data);
      break;
    case 'coda':
      drawCoda(ctx, local, data);
      break;
  }
  ctx.restore();
}

export { withAlpha };
