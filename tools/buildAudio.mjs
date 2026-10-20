// 映像に付ける音楽を合成して WAV に書き出します。
//
//   node tools/buildAudio.mjs --out dist-video/heibei.wav
//
// 外部の音源も音声ライブラリも使わず、波形をその場で作ります。映像と同じく
// 「時刻だけから決まる」ので、何度作っても同じ音が出ます。
//
// 和音は場面の切り替わりで動かします。画と音の変わり目を揃えるためです。
//
//   ★ src/motion/scenes.ts の SCENES を変えたら、下の SCENES も同じ値に
//     合わせてください（自動では同期されません）。tools/measureSkillGap.mjs と
//     同じ約束です。

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outPath = resolve(arg('out', 'dist-video/heibei.wav'));
const RATE = 48_000;

/** 1拍の長さ（秒）。120拍/分。8分音符が 0.25 秒になる。 */
const BEAT = 0.5;

// --- 場面割り（src/motion/scenes.ts の複製） ---
const SCENES = [
  { name: 'opening', start: 0, duration: 6.0 },
  { name: 'title', start: 6.0, duration: 4.2 },
  { name: 'scale', start: 10.2, duration: 6.0 },
  { name: 'bands', start: 16.2, duration: 10.0 },
  { name: 'cities', start: 26.2, duration: 9.0 },
  { name: 'focus', start: 35.2, duration: 11.0 },
  { name: 'closing', start: 46.2, duration: 5.8 },
  { name: 'coda', start: 52.0, duration: 4.5 },
];
const TOTAL = SCENES.reduce((end, s) => Math.max(end, s.start + s.duration), 0);
const sceneOf = (name) => SCENES.find((s) => s.name === name);
const startOf = (name) => sceneOf(name)?.start ?? 0;

/** 音名を周波数へ。A4 = 440Hz。 */
const SEMITONE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function freq(note) {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  if (!m) throw new Error(`音名が読めません: ${note}`);
  const [, letter, sharp, octave] = m;
  const semis = (SEMITONE[letter] ?? 0) + (sharp ? 1 : 0) + (Number(octave) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
}

/** xorshift32。種を固定するので、雑音も毎回同じ並びになる。 */
function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const left = new Float32Array(Math.ceil(TOTAL * RATE) + RATE);
const right = new Float32Array(left.length);

const shape = (v) => v * v * (3 - 2 * v);

/** 持続音の包絡。両端を丸めて、角が聴こえないようにする。 */
function padEnv(t, dur, attack, release) {
  if (t < 0 || t > dur) return 0;
  const up = attack > 0 ? Math.min(1, t / attack) : 1;
  const down = release > 0 ? Math.min(1, (dur - t) / release) : 1;
  return shape(up) * shape(down);
}

/** 撥弦の包絡。立ち上がりは一瞬、あとは指数的に減衰する。 */
function pluckEnv(t, dur, decay) {
  if (t < 0 || t > dur) return 0;
  const up = Math.min(1, t / 0.004);
  return up * Math.exp(-t / decay);
}

function mix(i, v, pan) {
  const lg = Math.cos(((pan + 1) / 2) * (Math.PI / 2));
  const rg = Math.sin(((pan + 1) / 2) * (Math.PI / 2));
  left[i] = (left[i] ?? 0) + v * lg;
  right[i] = (right[i] ?? 0) + v * rg;
}

/**
 * 持続音を1声。
 * わずかに音程をずらした3本を重ねて、単音の硬さを消している。
 */
function addPad({ note, start, dur, gain, attack = 1.4, release = 2.0, pan = 0, partials = [1, 0.3, 0.14, 0.06] }) {
  const f0 = freq(note);
  const detune = [0, 0.14, -0.12];
  const from = Math.max(0, Math.floor(start * RATE));
  const to = Math.min(left.length, Math.ceil((start + dur) * RATE));
  for (let i = from; i < to; i++) {
    const t = i / RATE - start;
    const env = padEnv(t, dur, attack, release);
    if (env <= 0) continue;
    let s = 0;
    for (const d of detune) {
      const f = f0 * Math.pow(2, d / 1200);
      for (let p = 0; p < partials.length; p++) s += (partials[p] ?? 0) * Math.sin(2 * Math.PI * f * (p + 1) * t);
    }
    const shimmer = 1 + 0.05 * Math.sin(2 * Math.PI * 0.11 * t + f0);
    mix(i, (s / (detune.length * partials.length)) * env * gain * shimmer, pan);
  }
}

/** 撥弦を1音。アルペジオと合図に使う。倍音を多めにして前に出す。 */
function addPluck({ note, start, gain, decay = 0.34, pan = 0, partials = [1, 0.62, 0.38, 0.22, 0.12, 0.06] }) {
  const f0 = freq(note);
  const dur = decay * 5;
  const from = Math.max(0, Math.floor(start * RATE));
  const to = Math.min(left.length, Math.ceil((start + dur) * RATE));
  for (let i = from; i < to; i++) {
    const t = i / RATE - start;
    const env = pluckEnv(t, dur, decay);
    if (env <= 0.0001) continue;
    let s = 0;
    for (let p = 0; p < partials.length; p++) {
      // 倍音ほど速く減る。金属質になりすぎるのを抑える。
      s += (partials[p] ?? 0) * Math.exp(-t * p * 1.6) * Math.sin(2 * Math.PI * f0 * (p + 1) * t);
    }
    mix(i, (s / partials.length) * env * gain, pan);
  }
}

/** 低い打点。拍を刻んで前へ進む感じを出す。 */
function addPulse(start, gain) {
  const dur = 0.30;
  const from = Math.max(0, Math.floor(start * RATE));
  const to = Math.min(left.length, Math.ceil((start + dur) * RATE));
  for (let i = from; i < to; i++) {
    const t = i / RATE - start;
    // 頭だけ高く始めて落とす。輪郭が出る。
    const f = 52 + 80 * Math.exp(-t / 0.028);
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.10);
    mix(i, Math.sin(2 * Math.PI * f * t) * env * gain, 0);
  }
}

/** 上昇音。次の場面へ持ち上げるための合図。 */
function addRiser(start, dur, gain) {
  const rng = createRng(0x52495345);
  const from = Math.max(0, Math.floor(start * RATE));
  const to = Math.min(left.length, Math.ceil((start + dur) * RATE));
  let lp = 0;
  for (let i = from; i < to; i++) {
    const t = i / RATE - start;
    const k = t / dur;
    const env = shape(Math.min(1, k)) * (1 - Math.max(0, (k - 0.92) / 0.08));
    // 雑音を鈍らせて、耳に刺さる帯域を落とす。
    lp += ((rng() * 2 - 1) - lp) * (0.02 + k * 0.10);
    const tone = Math.sin(2 * Math.PI * (220 + 900 * k * k) * t);
    mix(i, (lp * 0.5 + tone * 0.5) * env * gain, 0);
  }
}

// --- 構成 ---
// 明るめの響き（sus/add9）を選んでいる。純粋な短調だと沈んで聴こえるため。
const SECTIONS = [
  { at: 'opening', bass: 'A1', pad: ['A2', 'E3', 'B3'], arp: [], pulse: 0, gain: 0.34 },
  { at: 'title', bass: 'A1', pad: ['A2', 'E3', 'B3', 'E4'], arp: ['A4', 'E5', 'B4', 'E5'], pulse: 0.16, gain: 0.40 },
  { at: 'scale', bass: 'F1', pad: ['F2', 'C3', 'G3', 'C4'], arp: ['F4', 'C5', 'G4', 'C5'], pulse: 0.24, gain: 0.40 },
  { at: 'bands', bass: 'C2', pad: ['C3', 'G3', 'D4', 'G4'], arp: ['C5', 'G5', 'D5', 'G5'], pulse: 0.32, gain: 0.42 },
  { at: 'cities', bass: 'G1', pad: ['G2', 'D3', 'A3', 'D4'], arp: ['G4', 'D5', 'A4', 'D5'], pulse: 0.30, gain: 0.40 },
  { at: 'focus', bass: 'A1', pad: ['A2', 'E3', 'B3', 'E4'], arp: ['A4', 'E5', 'B4', 'E5'], pulse: 0.40, gain: 0.48 },
  { at: 'closing', bass: 'F1', pad: ['F2', 'C3', 'G3', 'C4'], arp: [], pulse: 0.18, gain: 0.44 },
  { at: 'coda', bass: 'A1', pad: ['A2', 'E3', 'B3'], arp: [], pulse: 0, gain: 0.34 },
];

for (const sec of SECTIONS) {
  const scene = sceneOf(sec.at);
  if (!scene) continue;
  // 和音は場面の頭より少し前から立ち上げ、後ろへ伸ばして重ねる。
  // 切り替わりで音が途切れると、画の連続感まで削がれる。
  const start = Math.max(0, scene.start - 1.2);
  const dur = scene.duration + 2.4;

  addPad({ note: sec.bass, start, dur, gain: sec.gain * 0.5, attack: 1.2, release: 1.8, partials: [1, 0.16, 0.05] });
  sec.pad.forEach((note, i) => {
    addPad({
      note,
      start,
      dur,
      gain: (sec.gain / sec.pad.length) * 0.85,
      attack: 1.5,
      release: 2.0,
      // 声部を左右に散らして、真ん中で団子にならないようにする。
      pan: ((i / Math.max(1, sec.pad.length - 1)) - 0.5) * 0.75,
    });
  });

  // アルペジオ。8分音符で回す。速すぎると数字から目が離れる。
  if (sec.arp.length > 0) {
    const step = BEAT / 2;
    let k = 0;
    for (let t = scene.start; t < scene.start + scene.duration - 0.2; t += step, k++) {
      const note = sec.arp[k % sec.arp.length];
      if (!note) continue;
      // 4音ごとに強弱を付ける。平坦だと機械の音になる。
      const accent = k % 4 === 0 ? 1.0 : 0.62;
      addPluck({ note, start: t, gain: 0.15 * accent, decay: 0.30, pan: ((k % 2) - 0.5) * 0.5 });
    }
  }

  // 打点。1拍おきに置く。
  if (sec.pulse > 0) {
    for (let t = scene.start; t < scene.start + scene.duration - 0.1; t += BEAT) {
      addPulse(t, sec.pulse);
    }
  }
}

// 場面の頭に短い高音を1つ置く。切り替わりの合図。
const MARKS = [
  { at: 'title', note: 'E5', gain: 0.20 },
  { at: 'scale', note: 'C5', gain: 0.18 },
  { at: 'bands', note: 'G5', gain: 0.18 },
  { at: 'cities', note: 'D5', gain: 0.18 },
  { at: 'focus', note: 'A5', gain: 0.24 },
  { at: 'closing', note: 'C5', gain: 0.20 },
  { at: 'coda', note: 'A5', gain: 0.18 },
];
for (const m of MARKS) {
  addPluck({ note: m.note, start: startOf(m.at), gain: m.gain, decay: 1.1 });
}

// 世田谷区の場面へ持ち上げる。映像の主題がそこにあるため。
addRiser(startOf('focus') - 2.0, 2.0, 0.16);
// 2.8倍が出る前後だけ、低い音をもう一段足して重みを付ける。
addPad({ note: 'A0', start: startOf('focus') + 4.0, dur: 7.0, gain: 0.20, attack: 1.6, release: 2.6, partials: [1] });

/** 付点8分の山びこ。アルペジオに広がりを出す。 */
function echo(buf, delaySec, feedback, mixLevel) {
  const d = Math.floor(delaySec * RATE);
  const out = Float32Array.from(buf);
  for (let i = d; i < out.length; i++) {
    out[i] = (out[i] ?? 0) + ((out[i - d] ?? 0) - (buf[i - d] ?? 0) * (1 - feedback)) * mixLevel;
  }
  return out;
}

/** 簡易な残響。減衰する数本の遅延を足すだけだが、奥行きは出る。 */
function reverb(buf) {
  const taps = [
    [0.029, 0.26], [0.043, 0.21], [0.067, 0.17],
    [0.101, 0.13], [0.149, 0.10], [0.211, 0.07],
  ];
  const out = Float32Array.from(buf);
  for (const [sec, g] of taps) {
    const d = Math.floor(sec * RATE);
    for (let i = d; i < out.length; i++) out[i] = (out[i] ?? 0) + (buf[i - d] ?? 0) * g;
  }
  return out;
}

// 左右で山びこの間隔をずらすと、音場が広がる。
const wetL = reverb(echo(left, BEAT * 0.75, 0.32, 0.30));
const wetR = reverb(echo(right, BEAT * 0.5, 0.32, 0.30));

// 全体の出入り。頭は無音から、終わりは完全に消えるまで。
for (let i = 0; i < wetL.length; i++) {
  const t = i / RATE;
  const g = Math.min(1, t / 2.0) * Math.min(1, Math.max(0, (TOTAL - t) / 3.0));
  wetL[i] = (wetL[i] ?? 0) * g;
  wetR[i] = (wetR[i] ?? 0) * g;
}

const frames = Math.ceil(TOTAL * RATE);
const frames0 = frames;

// 音量は「山」ではなく「平均」に合わせる。
// 打点やアルペジオは一瞬だけ大きく振れるので、山を基準にすると全体が沈む。
// 飛び出した分は下の soft() が丸める。
let sum = 0;
let count = 0;
for (let i = 0; i < frames0; i++) {
  const l = wetL[i] ?? 0;
  const r = wetR[i] ?? 0;
  sum += l * l + r * r;
  count += 2;
}
const rms = count > 0 ? Math.sqrt(sum / count) : 0;
let peak = 0;
for (let i = 0; i < frames0; i++) {
  peak = Math.max(peak, Math.abs(wetL[i] ?? 0), Math.abs(wetR[i] ?? 0));
}
// 平均で合わせるが、山が 0.92 を超えないところで頭を押さえる。
// 超えたままだと下の soft() が波形の頂点を潰し、歪みとして焼き付く。
// 最終的な音量は書き出し側の loudnorm が決めるので、ここは低めで構わない。
const norm = Math.min(rms > 0 ? 0.16 / rms : 1, peak > 0 ? 0.92 / peak : 1);

const bytes = Buffer.alloc(44 + frames * 4);
bytes.write('RIFF', 0);
bytes.writeUInt32LE(36 + frames * 4, 4);
bytes.write('WAVE', 8);
bytes.write('fmt ', 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(2, 22);
bytes.writeUInt32LE(RATE, 24);
bytes.writeUInt32LE(RATE * 4, 28);
bytes.writeUInt16LE(4, 32);
bytes.writeUInt16LE(16, 34);
bytes.write('data', 36);
bytes.writeUInt32LE(frames * 4, 40);

/** 端をやわらかく潰す。急に頭打ちにすると歪んで聴こえる。 */
const soft = (v) => Math.tanh(v * 1.25) / Math.tanh(1.25);

for (let i = 0; i < frames; i++) {
  const l = Math.max(-1, Math.min(1, soft((wetL[i] ?? 0) * norm)));
  const r = Math.max(-1, Math.min(1, soft((wetR[i] ?? 0) * norm)));
  bytes.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  bytes.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);
console.log(`音楽を書き出しました: ${outPath}（${TOTAL.toFixed(1)}秒 / ${RATE}Hz ステレオ）`);
