import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  hitTest,
  tToUnitPrice,
  unitPriceToT,
  xToT,
} from '../src/render/layout';
import { SLIDER_MAX, SLIDER_MIN } from '../src/constants';

describe('対数スケール', () => {
  it('t=0 は下限、t=1 は上限になる', () => {
    expect(tToUnitPrice(0)).toBeCloseTo(SLIDER_MIN, 3);
    expect(tToUnitPrice(1)).toBeCloseTo(SLIDER_MAX, 3);
  });

  it('t は 0..1 に丸められる', () => {
    expect(tToUnitPrice(-5)).toBeCloseTo(SLIDER_MIN, 3);
    expect(tToUnitPrice(5)).toBeCloseTo(SLIDER_MAX, 3);
  });

  it('往復で元に戻る', () => {
    for (const v of [200_000, 500_000, 944_000, 1_950_000, 3_461_000]) {
      expect(tToUnitPrice(unitPriceToT(v))).toBeCloseTo(v, 3);
    }
  });

  it('単調増加である', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = tToUnitPrice(t);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('中央付近の刻みが金額スケールより細かい（対数である）', () => {
    const lowStep = tToUnitPrice(0.51) - tToUnitPrice(0.5);
    const highStep = tToUnitPrice(0.91) - tToUnitPrice(0.9);
    expect(highStep).toBeGreaterThan(lowStep);
  });
});

describe('computeLayout', () => {
  it('要素が画面内に収まる（縦長）', () => {
    const l = computeLayout(375, 667);
    for (const r of [l.card, l.slider, l.confirm, l.timer, l.readout]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(375);
      expect(r.y + r.h).toBeLessThanOrEqual(667);
    }
  });

  it('要素が画面内に収まる（横長）', () => {
    const l = computeLayout(1280, 720);
    for (const r of [l.card, l.slider, l.confirm, l.timer, l.readout]) {
      expect(r.x + r.w).toBeLessThanOrEqual(1280);
      expect(r.y + r.h).toBeLessThanOrEqual(720);
    }
  });

  it('カード・スライダー・確定ボタンが縦に重ならない', () => {
    const l = computeLayout(375, 667);
    expect(l.card.y + l.card.h).toBeLessThanOrEqual(l.slider.y);
    expect(l.slider.y + l.slider.h).toBeLessThanOrEqual(l.confirm.y);
  });

  it('確定ボタンは指で押せる大きさがある', () => {
    const l = computeLayout(375, 667);
    expect(l.confirm.h).toBeGreaterThanOrEqual(44);
  });
});

describe('captionBaseline（判定画面の「成約レンジ」キャプション）', () => {
  const viewports: Array<[number, number]> = [
    [375, 667],
    [375, 812],
    [1280, 720],
  ];

  it('カード内に収まり、readout より上にある', () => {
    for (const [w, h] of viewports) {
      const l = computeLayout(w, h);
      expect(l.captionBaseline).toBeGreaterThan(l.card.y);
      expect(l.captionBaseline).toBeLessThanOrEqual(l.card.y + l.card.h);
      expect(l.captionBaseline).toBeLessThan(l.readout.y);
    }
  });
});

describe('notice（結果画面の出典・免責ブロック）', () => {
  const viewports: Array<[number, number]> = [
    [375, 667],
    [375, 812],
    [1280, 720],
  ];

  it('画面内に収まる', () => {
    for (const [w, h] of viewports) {
      const l = computeLayout(w, h);
      expect(l.notice.x).toBeGreaterThanOrEqual(0);
      expect(l.notice.y).toBeGreaterThanOrEqual(0);
      expect(l.notice.x + l.notice.w).toBeLessThanOrEqual(w);
      expect(l.notice.y + l.notice.h).toBeLessThanOrEqual(h);
    }
  });

  it('確定ボタンの unit 分上で終わる', () => {
    for (const [w, h] of viewports) {
      const l = computeLayout(w, h);
      expect(l.notice.y + l.notice.h).toBeLessThanOrEqual(l.confirm.y - l.unit);
    }
  });

  it('確定ボタンと重ならない', () => {
    for (const [w, h] of viewports) {
      const l = computeLayout(w, h);
      const overlapsVertically = l.notice.y < l.confirm.y + l.confirm.h && l.notice.y + l.notice.h > l.confirm.y;
      expect(overlapsVertically).toBe(false);
    }
  });
});

describe('mute（タイトル画面右上のミュートボタン）', () => {
  const viewports: Array<[number, number]> = [
    [375, 667],
    [375, 812],
    [1280, 720],
  ];

  it('画面内に収まる', () => {
    for (const [w, h] of viewports) {
      const l = computeLayout(w, h);
      expect(l.mute.x).toBeGreaterThanOrEqual(0);
      expect(l.mute.y).toBeGreaterThanOrEqual(0);
      expect(l.mute.x + l.mute.w).toBeLessThanOrEqual(w);
      expect(l.mute.y + l.mute.h).toBeLessThanOrEqual(h);
    }
  });

  it('残り時間バー（timer）と重ならない', () => {
    for (const [w, h] of viewports) {
      const l = computeLayout(w, h);
      const overlapsVertically = l.mute.y < l.timer.y + l.timer.h && l.mute.y + l.mute.h > l.timer.y;
      const overlapsHorizontally = l.mute.x < l.timer.x + l.timer.w && l.mute.x + l.mute.w > l.timer.x;
      expect(overlapsVertically && overlapsHorizontally).toBe(false);
    }
  });

  it('指で押せる大きさ（44×44 以上）がある', () => {
    for (const [w, h] of viewports) {
      const l = computeLayout(w, h);
      expect(l.mute.w).toBeGreaterThanOrEqual(44);
      expect(l.mute.h).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('xToT', () => {
  const slider = { x: 20, y: 100, w: 200, h: 40 };

  it('左端で0、右端で1になる', () => {
    expect(xToT(20, slider)).toBeCloseTo(0, 6);
    expect(xToT(220, slider)).toBeCloseTo(1, 6);
  });

  it('範囲外は丸められる', () => {
    expect(xToT(-100, slider)).toBe(0);
    expect(xToT(9999, slider)).toBe(1);
  });

  it('幅が0でも落ちない', () => {
    expect(xToT(50, { x: 20, y: 0, w: 0, h: 10 })).toBe(0);
  });
});

describe('hitTest', () => {
  const r = { x: 10, y: 10, w: 100, h: 50 };

  it('内側は true', () => {
    expect(hitTest(r, 50, 30)).toBe(true);
  });

  it('外側は false', () => {
    expect(hitTest(r, 5, 30)).toBe(false);
    expect(hitTest(r, 50, 70)).toBe(false);
  });

  it('境界は含む', () => {
    expect(hitTest(r, 10, 10)).toBe(true);
    expect(hitTest(r, 110, 60)).toBe(true);
  });
});
