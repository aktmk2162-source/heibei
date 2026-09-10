export interface AudioController {
  /** 最初のユーザー操作で呼ぶ。これより前に音を鳴らさない。 */
  unlock(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  startBgm(): void;
  stopBgm(): void;
  /** 0..1。1に近いほど時間切れが近い。テンポと音程が上がる。 */
  setUrgency(u: number): void;
  click(): void;
  confirm(): void;
  /** 誤差率に応じて音程を変える。小さいほど高い。 */
  judge(errorRate: number): void;
}

const SCALE = [0, 2, 4, 7, 9]; // ペンタトニック（半音）

/** テスト環境（vitest, environment: 'node'）には window が存在しない。 */
const hasWindow = (): boolean => typeof window !== 'undefined';

export function createAudio(): AudioController {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  let bgmTimer: number | null = null;
  let urgency = 0;
  let step = 0;

  const ensure = (): AudioContext | null => {
    if (ctx !== null) return ctx;
    if (!hasWindow()) return null;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.25;
      master.connect(ctx.destination);
      return ctx;
    } catch {
      return null;
    }
  };

  const beep = (freq: number, durMs: number, type: OscillatorType, gain: number): void => {
    const c = ensure();
    if (c === null || master === null || muted) return;
    try {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const now = c.currentTime;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gain, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + durMs / 1000 + 0.02);
    } catch (err) {
      // Web Audio例外は無視する必要がある（例：ブラウザの状態遷移による例外）。
      // ただしBGMのsetTimeoutコールバックで例外が起きると無音になるため、ログに記録する。
      console.warn('[heibei] 音の再生に失敗しました', err);
    }
  };

  const bgmStep = (): void => {
    const semitone = SCALE[step % SCALE.length] ?? 0;
    const octave = urgency > 0.7 ? 1 : 0;
    const base = 220 * Math.pow(2, (semitone + octave * 12) / 12);
    beep(base, 120, 'triangle', 0.08 + urgency * 0.06);
    step++;
    const intervalMs = 320 - urgency * 160;
    if (hasWindow()) {
      bgmTimer = window.setTimeout(bgmStep, intervalMs);
    }
  };

  return {
    unlock: () => {
      const c = ensure();
      if (c !== null && c.state === 'suspended') void c.resume();
    },
    setMuted: (v: boolean) => {
      muted = v;
      if (master !== null) master.gain.value = v ? 0 : 0.25;
    },
    isMuted: () => muted,
    startBgm: () => {
      if (bgmTimer !== null) return;
      if (!hasWindow()) return;
      step = 0;
      bgmStep();
    },
    stopBgm: () => {
      if (bgmTimer !== null) {
        if (hasWindow()) window.clearTimeout(bgmTimer);
        bgmTimer = null;
      }
    },
    setUrgency: (u: number) => {
      urgency = u < 0 ? 0 : u > 1 ? 1 : u;
    },
    click: () => beep(880, 30, 'square', 0.05),
    confirm: () => beep(660, 90, 'sine', 0.12),
    judge: (errorRate: number) => {
      const t = errorRate < 0 ? 0 : errorRate > 1 ? 1 : errorRate;
      beep(880 - t * 500, 220, 'sine', 0.15);
    },
  };
}
