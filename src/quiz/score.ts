import type { Answer, Grade, GameResult, Tile } from '../types';

/** 誤差率。時間切れ（null）は 1 とする。 */
export function errorRate(guess: number | null, truth: number): number {
  if (guess === null) return 1;
  return Math.abs(guess - truth) / truth;
}

/** 誤差率から得点（0..100）を出す。誤差2%以内は満点、30%以上は0点。 */
export function pointsFor(e: number): number {
  if (e <= 0.02) return 100;
  if (e >= 0.3) return 0;
  return Math.round((100 * (0.3 - e)) / 0.28);
}

export function tileFor(e: number): Tile {
  if (e <= 0.05) return '🟩';
  if (e <= 0.12) return '🟨';
  if (e <= 0.25) return '🟧';
  return '🟥';
}

export function gradeFor(meanErrorRate: number): Grade {
  if (meanErrorRate <= 0.1) return 'S';
  if (meanErrorRate <= 0.14) return 'A';
  if (meanErrorRate <= 0.18) return 'B';
  if (meanErrorRate <= 0.24) return 'C';
  return 'D';
}

export function makeAnswer(guess: number | null, truth: number): Answer {
  const e = errorRate(guess, truth);
  return { guess, errorRate: e, points: pointsFor(e), tile: tileFor(e) };
}

export function summarize(dateKey: string, answers: readonly Answer[]): GameResult {
  const totalPoints = answers.reduce((sum, a) => sum + a.points, 0);
  const meanErrorRate =
    answers.length === 0
      ? 1
      : answers.reduce((sum, a) => sum + a.errorRate, 0) / answers.length;
  return {
    dateKey,
    answers: [...answers],
    totalPoints,
    meanErrorRate,
    grade: gradeFor(meanErrorRate),
  };
}
