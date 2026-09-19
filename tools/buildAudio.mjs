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
const startOf = (name) => SCENES.find((s) => s.name === name)?.start ?? 0;

/** 音名を周波数へ。A4 = 440Hz。 */
const SEMITONE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function freq(note) {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  if (!m) throw new Error(`音名が読めません: ${note}`);
  const [, letter, sharp, octave] = m;
  const semis = (SEMITONE[letter] ?? 0) + (sharp ? 1 : 0) + (Number(octave) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
}

const left = new Float32Array(Math.ceil(TOTAL * RATE) + RATE);
const right = new Float32Array(left.length);

/** 立ち上がりと余韻。角を立てないよう、どの端も滑らかに閉じる。 */
function envelope(t, dur, attack, release) {
  if (t < 0 || t > dur) return 0;
  const up = attack > 0 ? Math.min(1, t / attack) : 1;
  const down = release > 0 ? Math.min(1, (dur - t) / release) : 1;
  // 直線だと折れ目が聴こえるので、両端を丸める。
  const shape = (v) => v * v * (3 - 2 * v);
  return shape(up) * shape(down);
}

/**
 * 1声を足し込む。
 * わずかに音程をずらした3本を重ねて、単音の硬さを消している。
 * 倍音は少なめ。データの映像に音が勝たないようにするため。
 */
function addVoice({ note, start, dur, gain, attack = 0.8, release = 1.2, pan = 0, partials = [1, 0.28, 0.1] }) {
  const f0 = freq(note);
  const detune = [0, 0.13, -0.11];
  const from = Math.max(0, Math.floor(start * RATE));
  const to = Math.min(left.length, Math.ceil((start + dur) * RATE));
  const lg = Math.cos(((pan + 1) / 2) * (Math.PI / 2));
  const rg = Math.sin(((pan + 1) / 2) * (Math.PI / 2));

  for (let i = from; i < to; i++) {
    const t = i / RATE - start;
    const env = envelope(t, dur, attack, release);
    if (env <= 0) continue;
    let s = 0;
    for (let d = 0; d < detune.length; d++) {
      const f = f0 * Math.pow(2, (detune[d] ?? 0) / 1200);
      for (let p = 0; p < partials.length; p++) {
        s += (partials[p] ?? 0) * Math.sin(2 * Math.PI * f * (p + 1) * t);
      }
    }
    // ごく遅い揺らぎ。完全に静止した音は機械的に聴こえる。
    const shimmer = 1 + 0.05 * Math.sin(2 * Math.PI * 0.11 * t + f0);
    const v = (s / (detune.length * partials.length)) * env * gain * shimmer;
    left[i] = (left[i] ?? 0) + v * lg;
    right[i] = (right[i] ?? 0) + v * rg;
  }
}

// --- 構成 ---
// 場面ごとに和音を置く。ベースは低く長く、パッドはその上に重ねる。
const SECTIONS = [
  { at: 'opening', bass: 'A1', pad: ['A2', 'E3', 'A3'], gain: 0.30 },
  { at: 'title', bass: 'A1', pad: ['A2', 'C3', 'E3', 'B3'], gain: 0.36 },
  { at: 'scale', bass: 'F1', pad: ['F2', 'A2', 'C3'], gain: 0.34 },
  { at: 'bands', bass: 'C2', pad: ['C3', 'E3', 'G3'], gain: 0.36 },
  { at: 'cities', bass: 'G1', pad: ['G2', 'B2', 'D3'], gain: 0.36 },
  { at: 'focus', bass: 'A1', pad: ['A2', 'C3', 'E3', 'A3'], gain: 0.42 },
  { at: 'closing', bass: 'F1', pad: ['F2', 'A2', 'C3', 'F3'], gain: 0.38 },
  { at: 'coda', bass: 'A1', pad: ['A2', 'E3', 'A3'], gain: 0.30 },
];

for (const sec of SECTIONS) {
  const scene = SCENES.find((s) => s.name === sec.at);
  if (!scene) continue;
  // 和音は場面の頭より少し前から立ち上げ、後ろへ伸ばして重ねる。
  // 切り替わりで音が途切れると、画の連続感まで削がれる。
  const start = Math.max(0, scene.start - 1.2);
  const dur = scene.duration + 2.4;
  addVoice({ note: sec.bass, start, dur, gain: sec.gain * 0.55, attack: 1.4, release: 2.0, partials: [1, 0.12] });
  sec.pad.forEach((note, i) => {
    addVoice({
      note,
      start,
      dur,
      gain: (sec.gain / sec.pad.length) * 0.9,
      attack: 1.6,
      release: 2.2,
      // 声部を左右に散らして、真ん中で団子にならないようにする。
      pan: ((i / Math.max(1, sec.pad.length - 1)) - 0.5) * 0.7,
    });
  });
}

// 場面の頭に短い高音を1つ置く。切り替わりの合図。
const MARKS = [
  { at: 'title', note: 'E5', gain: 0.10 },
  { at: 'scale', note: 'C5', gain: 0.09 },
  { at: 'bands', note: 'G5', gain: 0.09 },
  { at: 'cities', note: 'D5', gain: 0.09 },
  { at: 'focus', note: 'A4', gain: 0.12 },
  { at: 'closing', note: 'C5', gain: 0.10 },
  { at: 'coda', note: 'A5', gain: 0.09 },
];
for (const m of MARKS) {
  addVoice({
    note: m.note,
    start: startOf(m.at),
    dur: 3.2,
    gain: m.gain,
    attack: 0.02,
    release: 3.0,
    partials: [1, 0.5, 0.22, 0.08],
  });
}

// 世田谷区の2.8倍が出る前後だけ、低い音をもう一段足して重みを付ける。
addVoice({ note: 'A0', start: startOf('focus') + 4.0, dur: 7.0, gain: 0.16, attack: 2.0, release: 3.0, partials: [1] });

/** 簡易な残響。減衰する数本の遅延を足すだけだが、奥行きは出る。 */
function reverb(buf) {
  const taps = [
    [0.031, 0.30], [0.047, 0.24], [0.071, 0.19],
    [0.109, 0.15], [0.157, 0.11], [0.223, 0.08],
  ];
  const out = Float32Array.from(buf);
  for (const [sec, g] of taps) {
    const d = Math.floor(sec * RATE);
    for (let i = d; i < out.length; i++) out[i] = (out[i] ?? 0) + (buf[i - d] ?? 0) * g;
  }
  return out;
}
const wetL = reverb(left);
const wetR = reverb(right);

// 全体の出入り。頭は無音から、終わりは完全に消えるまで。
for (let i = 0; i < wetL.length; i++) {
  const t = i / RATE;
  const fadeIn = Math.min(1, t / 2.5);
  const fadeOut = Math.min(1, Math.max(0, (TOTAL - t) / 3.0));
  const g = fadeIn * fadeOut;
  wetL[i] = (wetL[i] ?? 0) * g;
  wetR[i] = (wetR[i] ?? 0) * g;
}

// 山を揃える。歪ませずに、聴きやすい音量まで持ち上げる。
let peak = 0;
for (let i = 0; i < wetL.length; i++) {
  peak = Math.max(peak, Math.abs(wetL[i] ?? 0), Math.abs(wetR[i] ?? 0));
}
const norm = peak > 0 ? 0.72 / peak : 1;

const frames = Math.ceil(TOTAL * RATE);
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
const soft = (v) => Math.tanh(v * 1.2) / Math.tanh(1.2);

for (let i = 0; i < frames; i++) {
  const l = Math.max(-1, Math.min(1, soft((wetL[i] ?? 0) * norm)));
  const r = Math.max(-1, Math.min(1, soft((wetR[i] ?? 0) * norm)));
  bytes.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  bytes.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);
console.log(`音楽を書き出しました: ${outPath}（${TOTAL.toFixed(1)}秒 / ${RATE}Hz ステレオ）`);
