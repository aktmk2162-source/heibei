import { describe, it, expect } from 'vitest';
import {
  QUESTION_COUNT,
  TIME_LIMIT_MS,
  SLIDER_MIN,
  SLIDER_MAX,
  ELIGIBLE_MIN,
  ELIGIBLE_MAX,
  MIN_SAMPLES,
} from '../src/constants';

describe('constants', () => {
  it('出題数は8問である', () => {
    expect(QUESTION_COUNT).toBe(8);
  });

  it('制限時間は10秒である', () => {
    expect(TIME_LIMIT_MS).toBe(10_000);
  });

  it('スライダー範囲は出題対象の範囲を内側に含む', () => {
    expect(SLIDER_MIN).toBeLessThan(ELIGIBLE_MIN);
    expect(SLIDER_MAX).toBeGreaterThan(ELIGIBLE_MAX);
  });

  it('最小成約件数は8件である', () => {
    expect(MIN_SAMPLES).toBe(8);
  });
});
