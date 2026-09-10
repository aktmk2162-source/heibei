import { describe, it, expect } from 'vitest';
import {
  confirmAnswer,
  currentQuestion,
  initGame,
  nextQuestion,
  setSlider,
  startPlay,
  tick,
  toResult,
} from '../src/game/state';
import { makeFixture } from './fixtures/market.fixture';
import { QUESTION_COUNT, TIME_LIMIT_MS } from '../src/constants';
import { unitPriceToT } from '../src/render/layout';

const data = makeFixture();

describe('initGame', () => {
  it('タイトルから始まり、8問を持つ', () => {
    const s = initGame(data, '2026-09-09');
    expect(s.phase).toBe('title');
    expect(s.questions).toHaveLength(QUESTION_COUNT);
    expect(s.index).toBe(0);
    expect(s.answers).toHaveLength(0);
  });

  it('スライダーは中央から始まる', () => {
    expect(initGame(data, '2026-09-09').sliderT).toBeCloseTo(0.5, 6);
  });
});

describe('startPlay', () => {
  it('出題へ移り、経過時間が0になる', () => {
    const s = startPlay(initGame(data, '2026-09-09'));
    expect(s.phase).toBe('question');
    expect(s.elapsedMs).toBe(0);
  });
});

describe('tick', () => {
  it('制限時間を超えると時間切れで判定へ移る', () => {
    const s = tick(startPlay(initGame(data, '2026-09-09')), TIME_LIMIT_MS + 1);
    expect(s.phase).toBe('reveal');
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0]?.guess).toBeNull();
    expect(s.answers[0]?.points).toBe(0);
  });

  it('制限時間内なら出題のままである', () => {
    const s = tick(startPlay(initGame(data, '2026-09-09')), 100);
    expect(s.phase).toBe('question');
    expect(s.elapsedMs).toBe(100);
  });

  it('判定中は時間が進まない', () => {
    const a = confirmAnswer(startPlay(initGame(data, '2026-09-09')));
    const b = tick(a, 5000);
    expect(b).toEqual(a);
  });
});

describe('confirmAnswer', () => {
  it('スライダーの値で採点され、判定へ移る', () => {
    const s0 = startPlay(initGame(data, '2026-09-09'));
    const truth = s0.questions[0]!.median;
    const s1 = setSlider(s0, unitPriceToT(truth));
    const s2 = confirmAnswer(s1);
    expect(s2.phase).toBe('reveal');
    expect(s2.answers).toHaveLength(1);
    expect(s2.answers[0]?.points).toBe(100);
  });

  it('出題中でなければ何も起きない', () => {
    const s = initGame(data, '2026-09-09');
    expect(confirmAnswer(s)).toEqual(s);
  });
});

describe('nextQuestion', () => {
  it('次の問題へ進む', () => {
    const s = nextQuestion(confirmAnswer(startPlay(initGame(data, '2026-09-09'))));
    expect(s.phase).toBe('question');
    expect(s.index).toBe(1);
    expect(s.elapsedMs).toBe(0);
  });

  it('8問終わると結果へ移る', () => {
    let s = startPlay(initGame(data, '2026-09-09'));
    for (let i = 0; i < QUESTION_COUNT; i++) {
      s = nextQuestion(confirmAnswer(s));
    }
    expect(s.phase).toBe('result');
    expect(s.answers).toHaveLength(QUESTION_COUNT);
  });
});

describe('currentQuestion', () => {
  it('結果画面では null を返す', () => {
    let s = startPlay(initGame(data, '2026-09-09'));
    for (let i = 0; i < QUESTION_COUNT; i++) s = nextQuestion(confirmAnswer(s));
    expect(currentQuestion(s)).toBeNull();
  });
});

describe('toResult', () => {
  it('全問正解なら800点でランクSになる', () => {
    let s = startPlay(initGame(data, '2026-09-09'));
    for (let i = 0; i < QUESTION_COUNT; i++) {
      const truth = s.questions[s.index]!.median;
      s = nextQuestion(confirmAnswer(setSlider(s, unitPriceToT(truth))));
    }
    const r = toResult(s);
    expect(r.totalPoints).toBe(800);
    expect(r.grade).toBe('S');
    expect(r.dateKey).toBe('2026-09-09');
  });
});
