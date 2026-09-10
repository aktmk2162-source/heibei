import { createAudio } from '../audio/synth';
import { TIME_LIMIT_MS } from '../constants';
import { market } from '../data/loadMarket';
import { attachPointer } from '../input/pointer';
import { computeLayout, hitTest, xToT, type Layout } from '../render/layout';
import { drawFrame } from '../render/draw';
import { todayKey } from '../quiz/rng';
import { buildShareText } from '../share/shareText';
import { loadPrefs, savePrefs } from '../storage/prefs';
import {
  confirmAnswer,
  initGame,
  nextQuestion,
  setSlider,
  startPlay,
  tick as tickState,
  toResult,
  type GameState,
} from './state';

export function startLoop(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D コンテキストを取得できません');

  let state: GameState = initGame(market, todayKey());
  let layout: Layout = computeLayout(1, 1);
  let dragging = false;
  let lastTs = 0;
  let rafId = 0;
  let lastPhase: GameState['phase'] = state.phase;

  const audio = createAudio();
  audio.setMuted(loadPrefs().muted);

  /** リサイズすると canvas の内容は消えるので、必ずこの直後に描き直す。 */
  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = computeLayout(cssW, cssH);
    drawFrame(ctx, state, layout, market, audio.isMuted());
  };

  const copyResult = (): void => {
    const text = buildShareText(toResult(state));
    // navigator.clipboard?.writeText は Promise を返すため、拒否（許可拒否など）も
    // ここで catch しておく。try/catch だけでは同期例外しか捕まらない。
    navigator.clipboard?.writeText(text).catch(() => {
      // クリップボードが使えない環境では何もしない。
    });
  };

  const rememberBest = (): void => {
    const r = toResult(state);
    const prefs = loadPrefs();
    if (prefs.best === null || r.totalPoints > prefs.best.points) {
      savePrefs({
        ...prefs,
        best: { dateKey: r.dateKey, points: r.totalPoints, meanErrorRate: r.meanErrorRate },
      });
    }
  };

  const detach = attachPointer(canvas, {
    onDown: (x, y) => {
      // 最初のユーザー操作より前に音を鳴らさないため、ここで最初に呼ぶ。
      audio.unlock();
      if (state.phase === 'title') {
        if (hitTest(layout.mute, x, y)) {
          audio.setMuted(!audio.isMuted());
          savePrefs({ ...loadPrefs(), muted: audio.isMuted() });
          return;
        }
        if (hitTest(layout.confirm, x, y)) {
          // 日付を跨いでタブを開きっぱなしにしていた場合、前日分の8問と
          // シェア文の日付が残ってしまうため、開始直前に当日分へ作り直す。
          const key = todayKey();
          if (key !== state.dateKey) {
            state = initGame(market, key);
          }
          state = startPlay(state);
          audio.startBgm();
        }
        return;
      }
      if (state.phase === 'question') {
        if (hitTest(layout.slider, x, y)) {
          dragging = true;
          state = setSlider(state, xToT(x, layout.slider));
          audio.click();
        } else if (hitTest(layout.confirm, x, y)) {
          state = confirmAnswer(state);
          audio.confirm();
        }
        return;
      }
      if (state.phase === 'reveal') {
        if (hitTest(layout.confirm, x, y)) {
          state = nextQuestion(state);
          if (state.phase === 'result') rememberBest();
        }
        return;
      }
      if (state.phase === 'result') {
        if (hitTest(layout.confirm, x, y)) copyResult();
      }
    },
    onMove: (x) => {
      if (dragging && state.phase === 'question') {
        state = setSlider(state, xToT(x, layout.slider));
        audio.click();
      }
    },
    onUp: () => {
      dragging = false;
    },
  });

  const frame = (ts: number): void => {
    const dt = lastTs === 0 ? 0 : ts - lastTs;
    lastTs = ts;
    if (state.phase === 'question') {
      state = tickState(state, dt);
      if (state.phase !== 'question') dragging = false;
    }
    if (state.phase === 'question') {
      audio.setUrgency(state.elapsedMs / TIME_LIMIT_MS);
    }
    if (lastPhase !== 'reveal' && state.phase === 'reveal') {
      const last = state.answers[state.answers.length - 1];
      if (last !== undefined) audio.judge(last.errorRate);
    }
    if (lastPhase !== 'result' && state.phase === 'result') {
      audio.stopBgm();
    }
    lastPhase = state.phase;
    drawFrame(ctx, state, layout, market, audio.isMuted());
    rafId = window.requestAnimationFrame(frame);
  };

  window.addEventListener('resize', resize);
  resize();
  rafId = window.requestAnimationFrame(frame);

  return () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    detach();
    audio.stopBgm();
  };
}
