import { describe, it, expect } from 'vitest';
import { toCanvasPoint } from '../src/input/pointer';

describe('toCanvasPoint', () => {
  const rect = { left: 10, top: 20, width: 400, height: 800 };

  it('等倍なら要素の左上を原点にした座標になる', () => {
    expect(toCanvasPoint(rect, 400, 800, 110, 120)).toEqual({ x: 100, y: 100 });
  });

  it('表示サイズと描画サイズが違えば比率で換算する', () => {
    // CSS 400x800 の要素に対し、論理描画サイズが 200x400（0.5倍）
    expect(toCanvasPoint(rect, 200, 400, 210, 420)).toEqual({ x: 100, y: 200 });
  });

  it('要素の幅が0でも落ちない', () => {
    expect(toCanvasPoint({ left: 0, top: 0, width: 0, height: 0 }, 100, 100, 50, 50)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('要素の外側でも計算する（呼び出し側で扱う）', () => {
    expect(toCanvasPoint(rect, 400, 800, 0, 0)).toEqual({ x: -10, y: -20 });
  });
});
