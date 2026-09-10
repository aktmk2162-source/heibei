import type { Answer, GameResult, MarketData, MarketGroup } from '../types';
import { QUESTION_COUNT, TIME_LIMIT_MS } from '../constants';
import { selectQuestions } from '../quiz/select';
import { makeAnswer, summarize } from '../quiz/score';
import { tToUnitPrice } from '../render/layout';

export type Phase = 'title' | 'question' | 'reveal' | 'result';

export interface GameState {
  phase: Phase;
  dateKey: string;
  questions: MarketGroup[];
  /** 0..QUESTION_COUNT-1。result では QUESTION_COUNT になる */
  index: number;
  /** スライダー位置 0..1 */
  sliderT: number;
  elapsedMs: number;
  answers: Answer[];
}

export function initGame(data: MarketData, dateKey: string): GameState {
  return {
    phase: 'title',
    dateKey,
    questions: selectQuestions(data, dateKey),
    index: 0,
    sliderT: 0.5,
    elapsedMs: 0,
    answers: [],
  };
}

export function startPlay(s: GameState): GameState {
  if (s.phase !== 'title') return s;
  return { ...s, phase: 'question', elapsedMs: 0 };
}

export function setSlider(s: GameState, t: number): GameState {
  if (s.phase !== 'question') return s;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return { ...s, sliderT: clamped };
}

export function currentQuestion(s: GameState): MarketGroup | null {
  return s.questions[s.index] ?? null;
}

function judge(s: GameState, guess: number | null): GameState {
  const q = currentQuestion(s);
  if (q === null) return s;
  return {
    ...s,
    phase: 'reveal',
    answers: [...s.answers, makeAnswer(guess, q.median)],
  };
}

/** 経過時間を進める。制限時間を超えたら時間切れとして判定へ移す。 */
export function tick(s: GameState, dtMs: number): GameState {
  if (s.phase !== 'question') return s;
  const elapsedMs = s.elapsedMs + dtMs;
  if (elapsedMs >= TIME_LIMIT_MS) {
    return judge({ ...s, elapsedMs: TIME_LIMIT_MS }, null);
  }
  return { ...s, elapsedMs };
}

/** スライダーの値で確定する。 */
export function confirmAnswer(s: GameState): GameState {
  if (s.phase !== 'question') return s;
  return judge(s, tToUnitPrice(s.sliderT));
}

/** 判定表示から次へ進む。8問終わっていれば結果へ。 */
export function nextQuestion(s: GameState): GameState {
  if (s.phase !== 'reveal') return s;
  const index = s.index + 1;
  if (index >= QUESTION_COUNT) {
    return { ...s, phase: 'result', index: QUESTION_COUNT };
  }
  return { ...s, phase: 'question', index, sliderT: 0.5, elapsedMs: 0 };
}

export function toResult(s: GameState): GameResult {
  return summarize(s.dateKey, s.answers);
}
