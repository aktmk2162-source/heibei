import { describe, it, expect } from 'vitest';
import { buildShareText } from '../src/share/shareText';
import { makeAnswer, summarize } from '../src/quiz/score';

function resultWithErrors(errors: readonly number[]) {
  const answers = errors.map((e) => makeAnswer(1_000_000 * (1 + e), 1_000_000));
  return summarize('2026-09-09', answers);
}

describe('buildShareText', () => {
  it('4行で出力する', () => {
    const text = buildShareText(resultWithErrors([0, 0, 0, 0, 0, 0, 0, 0]), 'https://x.invalid/');
    expect(text.split('\n')).toHaveLength(4);
  });

  it('1行目はゲーム名と日付', () => {
    const text = buildShareText(resultWithErrors([0, 0, 0, 0, 0, 0, 0, 0]), 'https://x.invalid/');
    expect(text.split('\n')[0]).toBe('HEIBEI 2026-09-09');
  });

  it('2行目に平均誤差・得点・ランクが入る', () => {
    const text = buildShareText(resultWithErrors([0, 0, 0, 0, 0, 0, 0, 0]), 'https://x.invalid/');
    expect(text.split('\n')[1]).toBe('平均誤差 0.0%  800/800  ランク S');
  });

  it('3行目は色ブロック8個', () => {
    const text = buildShareText(
      resultWithErrors([0, 0, 0.08, 0, 0.3, 0, 0.08, 0]),
      'https://x.invalid/',
    );
    const tiles = text.split('\n')[2] ?? '';
    expect([...tiles]).toHaveLength(8);
    expect(tiles).toBe('🟩🟩🟨🟩🟥🟩🟨🟩');
  });

  it('4行目はURL', () => {
    const text = buildShareText(resultWithErrors([0, 0, 0, 0, 0, 0, 0, 0]), 'https://x.invalid/');
    expect(text.split('\n')[3]).toBe('https://x.invalid/');
  });

  it('平均誤差は小数第1位まで', () => {
    const text = buildShareText(
      resultWithErrors([0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04]),
      'https://x.invalid/',
    );
    expect(text.split('\n')[1]).toContain('平均誤差 4.0%');
  });
});
