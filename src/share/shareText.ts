import type { GameResult } from '../types';
import { SHARE_URL } from '../constants';

/** 共有用のテキストを組み立てる。外部送信はしない。 */
export function buildShareText(result: GameResult, url: string = SHARE_URL): string {
  const mean = (result.meanErrorRate * 100).toFixed(1);
  const tiles = result.answers.map((a) => a.tile).join('');
  return [
    `HEIBEI ${result.dateKey}`,
    `平均誤差 ${mean}%  ${result.totalPoints}/800  ランク ${result.grade}`,
    tiles,
    url,
  ].join('\n');
}
