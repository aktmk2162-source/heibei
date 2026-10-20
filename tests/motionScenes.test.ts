import { describe, it, expect } from 'vitest';
import { FPS, SCENES, TOTAL_FRAMES, TOTAL_SEC, frameToSec, sceneAt } from '../src/motion/scenes';

describe('場面割り', () => {
  it('隙間も重なりもなく前から並ぶ', () => {
    let cursor = 0;
    for (const scene of SCENES) {
      expect(scene.start).toBeCloseTo(cursor, 6);
      expect(scene.duration).toBeGreaterThan(0);
      cursor = scene.start + scene.duration;
    }
    expect(cursor).toBeCloseTo(TOTAL_SEC, 6);
  });

  it('場面名が重複しない', () => {
    const names = SCENES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('全体の尺とフレーム数が対応する', () => {
    expect(TOTAL_FRAMES).toBe(Math.round(TOTAL_SEC * FPS));
  });
});

describe('sceneAt', () => {
  it('各場面の開始時刻では、その場面の先頭を返す', () => {
    for (const scene of SCENES) {
      const at = sceneAt(scene.start);
      expect(at.scene.name).toBe(scene.name);
      expect(at.local).toBeCloseTo(0, 6);
    }
  });

  it('場面の終わり際はまだその場面にいる', () => {
    const first = SCENES[0];
    if (!first) throw new Error('場面がありません');
    const at = sceneAt(first.start + first.duration - 0.001);
    expect(at.scene.name).toBe(first.name);
  });

  it('尺を過ぎたら最後の場面の終端を返す', () => {
    const last = SCENES[SCENES.length - 1];
    if (!last) throw new Error('場面がありません');
    const at = sceneAt(TOTAL_SEC + 10);
    expect(at.scene.name).toBe(last.name);
    expect(at.local).toBe(last.duration);
  });

  it('全フレームがいずれかの場面に収まり、経過秒は尺を超えない', () => {
    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const { scene, local } = sceneAt(frameToSec(f));
      expect(local).toBeGreaterThanOrEqual(0);
      expect(local).toBeLessThanOrEqual(scene.duration);
    }
  });
});
