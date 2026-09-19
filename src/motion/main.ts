/**
 * ブラウザでの再生窓。
 *
 * ここは「再生・シーク・録画」だけを持ち、絵そのものは renderFrame が決める。
 * window.heibeiMotion は書き出し（tools/renderMotion.mjs）から呼ぶための足場。
 */
import { FPS, HEIGHT, TOTAL_FRAMES, TOTAL_SEC, WIDTH } from './scenes';
import { buildMotionData } from './data';
import { renderFrame } from './render';

declare global {
  interface Window {
    heibeiMotion?: {
      totalFrames: number;
      fps: number;
      /** そのフレームを描いて戻る。描画は同期で終わる。 */
      seek: (frame: number) => void;
    };
  }
}

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('motion: #stage がありません');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('motion: 2d コンテキストを取得できません');

canvas.width = WIDTH;
canvas.height = HEIGHT;

const data = buildMotionData();

const scrub = document.getElementById('scrub');
const playBtn = document.getElementById('play');
const recBtn = document.getElementById('rec');
const clock = document.getElementById('clock');

let frame = 0;
let playing = false;
let rafId = 0;
let startedAt = 0;
let startedFrame = 0;

function draw(f: number): void {
  frame = Math.max(0, Math.min(TOTAL_FRAMES - 1, Math.round(f)));
  renderFrame(ctx as CanvasRenderingContext2D, frame, data);
  if (scrub instanceof HTMLInputElement) scrub.value = String(frame);
  if (clock) {
    const sec = frame / FPS;
    clock.textContent = `${sec.toFixed(1)}s / ${TOTAL_SEC.toFixed(1)}s　(frame ${frame})`;
  }
}

function tick(now: number): void {
  if (!playing) return;
  const elapsed = (now - startedAt) / 1000;
  const next = startedFrame + elapsed * FPS;
  if (next >= TOTAL_FRAMES - 1) {
    draw(TOTAL_FRAMES - 1);
    setPlaying(false);
    return;
  }
  draw(next);
  rafId = requestAnimationFrame(tick);
}

function setPlaying(next: boolean): void {
  playing = next;
  if (playBtn) playBtn.textContent = playing ? '一時停止' : '再生';
  if (playing) {
    startedAt = performance.now();
    startedFrame = frame >= TOTAL_FRAMES - 1 ? 0 : frame;
    rafId = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(rafId);
  }
}

playBtn?.addEventListener('click', () => setPlaying(!playing));

scrub?.addEventListener('input', (e) => {
  const target = e.currentTarget;
  if (!(target instanceof HTMLInputElement)) return;
  setPlaying(false);
  draw(Number(target.value));
});

document.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    setPlaying(!playing);
  }
  if (e.key === 'ArrowRight') draw(frame + (e.shiftKey ? FPS : 1));
  if (e.key === 'ArrowLeft') draw(frame - (e.shiftKey ? FPS : 1));
});

/** 画面を最初から最後まで回しながら webm に録る。保存はブラウザのダウンロード。 */
recBtn?.addEventListener('click', () => {
  if (!(recBtn instanceof HTMLButtonElement) || recBtn.disabled) return;
  setPlaying(false);
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 12_000_000,
  });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  recorder.addEventListener('stop', () => {
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'heibei-motion.webm';
    a.click();
    URL.revokeObjectURL(url);
    recBtn.disabled = false;
    recBtn.textContent = '録画して保存';
  });

  recBtn.disabled = true;
  draw(0);
  recorder.start();
  const began = performance.now();
  const step = (now: number): void => {
    const f = ((now - began) / 1000) * FPS;
    if (f >= TOTAL_FRAMES - 1) {
      draw(TOTAL_FRAMES - 1);
      recorder.stop();
      return;
    }
    draw(f);
    recBtn.textContent = `録画中… ${Math.round((f / TOTAL_FRAMES) * 100)}%`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

window.heibeiMotion = { totalFrames: TOTAL_FRAMES, fps: FPS, seek: draw };

if (scrub instanceof HTMLInputElement) scrub.max = String(TOTAL_FRAMES - 1);
draw(0);
