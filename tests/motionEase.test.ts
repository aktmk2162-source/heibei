import { describe, it, expect } from 'vitest';
import {
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  easeOutExpo,
  fadeInOut,
  lerp,
  progress,
  staggered,
} from '../src/motion/ease';

describe('clamp01', () => {
  it('0未満と1超を丸める', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(2)).toBe(1);
  });
});

describe('lerp', () => {
  it('両端と中間を返す', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });
});

describe('イージング', () => {
  const eases = { easeOutCubic, easeOutExpo, easeInOutCubic };

  for (const [name, fn] of Object.entries(eases)) {
    it(`${name} は 0 で 0、1 で 1 を返す`, () => {
      expect(fn(0)).toBeCloseTo(0, 5);
      expect(fn(1)).toBeCloseTo(1, 5);
    });

    it(`${name} は単調に増える`, () => {
      let prev = -Infinity;
      for (let i = 0; i <= 40; i++) {
        const v = fn(i / 40);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });

    it(`${name} は範囲外の入力でも 0..1 に収まる`, () => {
      expect(fn(-5)).toBeGreaterThanOrEqual(0);
      expect(fn(5)).toBeLessThanOrEqual(1);
    });
  }
});

describe('progress', () => {
  it('区間の前後で 0 と 1 になる', () => {
    expect(progress(0, 2, 1)).toBe(0);
    expect(progress(2, 2, 1)).toBe(0);
    expect(progress(2.5, 2, 1)).toBe(0.5);
    expect(progress(3, 2, 1)).toBe(1);
    expect(progress(9, 2, 1)).toBe(1);
  });

  it('尺が0なら開始時刻で切り替わる', () => {
    expect(progress(1.9, 2, 0)).toBe(0);
    expect(progress(2, 2, 0)).toBe(1);
  });
});

describe('fadeInOut', () => {
  it('区間の外では 0 になる', () => {
    expect(fadeInOut(0, 1, 4, 0.5)).toBe(0);
    expect(fadeInOut(1, 1, 4, 0.5)).toBe(0);
    expect(fadeInOut(5, 1, 4, 0.5)).toBe(0);
    expect(fadeInOut(9, 1, 4, 0.5)).toBe(0);
  });

  it('真ん中では 1 になる', () => {
    expect(fadeInOut(3, 1, 4, 0.5)).toBe(1);
  });

  it('入りと出の途中では 0..1 の間になる', () => {
    const inMid = fadeInOut(1.25, 1, 4, 0.5);
    const outMid = fadeInOut(4.75, 1, 4, 0.5);
    expect(inMid).toBeCloseTo(0.5, 5);
    expect(outMid).toBeCloseTo(0.5, 5);
  });
});

describe('staggered', () => {
  it('後ろの要素ほど遅れて始まる', () => {
    expect(staggered(1.0, 0, 1, 0.5, 1)).toBe(0);
    expect(staggered(1.5, 0, 1, 0.5, 1)).toBe(0.5);
    expect(staggered(1.5, 1, 1, 0.5, 1)).toBe(0);
    expect(staggered(3.0, 1, 1, 0.5, 1)).toBe(1);
  });
});
