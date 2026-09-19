/** 映像の尺と場面割り。秒で書き、フレーム番号へ変換する。 */

/** 書き出しフレームレート。ブラウザ再生もこの値に合わせる。 */
export const FPS = 30;

/** 書き出し解像度。 */
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type SceneName =
  | 'opening'
  | 'title'
  | 'scale'
  | 'bands'
  | 'cities'
  | 'focus'
  | 'closing'
  | 'coda';

export interface Scene {
  name: SceneName;
  /** 開始秒 */
  start: number;
  /** 尺（秒） */
  duration: number;
}

/** 場面割り。順に並べる。 */
export const SCENES: readonly Scene[] = [
  // 冒頭と末尾は、本編の 1,032 点をそのまま夜景の灯りとして散らした画。
  // 同じ点が bands の散布図になるので、絵として地続きになる。
  { name: 'opening', start: 0, duration: 6.0 },
  { name: 'title', start: 6.0, duration: 4.2 },
  { name: 'scale', start: 10.2, duration: 6.0 },
  { name: 'bands', start: 16.2, duration: 10.0 },
  { name: 'cities', start: 26.2, duration: 9.0 },
  { name: 'focus', start: 35.2, duration: 11.0 },
  { name: 'closing', start: 46.2, duration: 5.8 },
  { name: 'coda', start: 52.0, duration: 4.5 },
];

/** 全体の尺（秒）。 */
export const TOTAL_SEC = SCENES.reduce((end, s) => Math.max(end, s.start + s.duration), 0);

/** 全体のフレーム数。 */
export const TOTAL_FRAMES = Math.round(TOTAL_SEC * FPS);

/**
 * その時刻に映っている場面と、場面内での経過秒を返す。
 * 尺を過ぎていれば最後の場面の終端を返す。
 */
export function sceneAt(timeSec: number): { scene: Scene; local: number } {
  const last = SCENES[SCENES.length - 1];
  if (!last) throw new Error('motion: 場面がありません');
  for (const scene of SCENES) {
    if (timeSec < scene.start + scene.duration) {
      const local = Math.max(0, timeSec - scene.start);
      return { scene, local };
    }
  }
  return { scene: last, local: last.duration };
}

/** フレーム番号を秒に直す。 */
export function frameToSec(frame: number): number {
  return frame / FPS;
}
