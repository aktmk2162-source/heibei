// モーショングラフィックスを mp4 に書き出します。
//
//   npm run motion:render                     -- 既定（dist/ をビルド済みの前提で 1920x1080 / 30fps）
//   node tools/renderMotion.mjs --out out.mp4 --limit 60
//
// 1フレームずつ seek して canvas の中身をそのまま取り出し、ffmpeg に流し込みます。
// 実時間で録るのではなくフレーム番号で描くので、マシンの速さに関係なく同じ映像が出ます。
//
// 実写や生成映像を挟む場合（前後へ 0.8 秒のディゾルブで入ります）:
//
// 音楽を付ける場合（tools/buildAudio.mjs で作った WAV を渡します）:
//
//   node tools/buildAudio.mjs --out dist-video/heibei.wav
//   node tools/renderMotion.mjs --audio dist-video/heibei.wav
//
// 音量は -13 LUFS。会議室のプロジェクタ程度の音量でも埋もれません。
//
// 素材はローカルのファイルでも、http(s) のURLでも指定できます。URLのときは
// ダウンロード不要で、ffmpeg がそのまま読みに行きます。
//
//   node tools/renderMotion.mjs \
//     --intro opening.mp4 \              頭につなぐ（URLでも可）
//     --insert focus=street.mp4 \        focus の場面の直前に挟む
//     --insert closing=dawn.mp4 \        closing の場面の直前に挟む
//     --clip-seconds 4                   挟む素材はそれぞれ先頭4秒だけ使う
//
// 場面の名前は src/motion/scenes.ts の SCENES に合わせます
// （title / scale / bands / cities / focus / closing）。
// --insert は何個でも指定できます。画角とフレームレートは自動で揃えます。
//
// 必要なもの（いずれも devDependencies には入れていません。書き出すときだけ入れてください）:
//   npm install --no-save playwright ffmpeg-static
//   npx playwright install chromium
//
// すでに手元に Chromium がある場合は、ダウンロードせずにそれを使えます:
//   CHROMIUM_PATH=/path/to/chrome npm run motion:render

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * 素材の指定を ffmpeg に渡せる形にする。
 * ffmpeg は http(s) をそのまま入力にできるので、URL は絶対パス化せずに素通しする。
 * 手元にダウンロードしなくても、生成結果のURLを直接指定できる。
 */
function asInput(value) {
  return /^https?:\/\//i.test(value) ? value : resolve(value);
}

/** 同じ名前の引数をすべて集める。--insert を複数回書けるようにするため。 */
function argAll(name) {
  const out = [];
  process.argv.forEach((v, i) => {
    if (v === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

const outPath = resolve(arg('out', 'dist-video/heibei-motion.mp4'));
const limit = Number(arg('limit', '0'));
const crf = arg('crf', '17');
const introPath = arg('intro', '');
const audioPath = arg('audio', '');
// 挟む素材の尺はこちらで切り詰める。長さが分かっていればディゾルブの位置を計算で出せる。
const clipSec = Number(arg('clip-seconds', arg('intro-seconds', '4')));
const dissolveSec = Number(arg('dissolve', '0.8'));
const inserts = argAll('insert').map((spec) => {
  const at = spec.indexOf('=');
  if (at <= 0) throw new Error(`--insert は 場面名=ファイル の形で書いてください: ${spec}`);
  return { scene: spec.slice(0, at), path: asInput(spec.slice(at + 1)) };
});

if (!(clipSec > dissolveSec)) {
  throw new Error(`--clip-seconds (${clipSec}) は --dissolve (${dissolveSec}) より長くしてください。`);
}

const { chromium } = require('playwright');
const ffmpegPath = require('ffmpeg-static');
const { preview } = await import('vite');

await mkdir(dirname(outPath), { recursive: true });

const server = await preview({ preview: { port: 4317, strictPort: false } });
const base = server.resolvedUrls?.local?.[0];
if (!base) throw new Error('プレビューサーバのURLを取得できませんでした。先に npm run build を実行してください。');

const chromiumPath = process.env.CHROMIUM_PATH ?? arg('chromium', '');
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

await page.goto(new URL('motion/index.html', base).href, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.heibeiMotion));
// フォントが載る前に撮ると字が入れ替わるので、必ず待つ。
await page.evaluate(() => document.fonts.ready);

const meta = await page.evaluate(() => ({
  totalFrames: window.heibeiMotion.totalFrames,
  fps: window.heibeiMotion.fps,
  scenes: window.heibeiMotion.scenes,
}));
const totalFrames = limit > 0 ? Math.min(limit, meta.totalFrames) : meta.totalFrames;
const bodySec = totalFrames / meta.fps;

// 差し込み位置を場面名から秒に直す。頭につなぐものは最初の場面の直前として扱う。
const cuts = [];
for (const ins of inserts) {
  const scene = meta.scenes.find((s) => s.name === ins.scene);
  if (!scene) {
    const names = meta.scenes.map((s) => s.name).join(' / ');
    throw new Error(`場面 "${ins.scene}" がありません。指定できるのは: ${names}`);
  }
  if (scene.start <= 0) throw new Error(`最初の場面の前は --intro で指定してください（${ins.scene}）。`);
  if (scene.start >= bodySec) throw new Error(`場面 "${ins.scene}" は今回の書き出し範囲より後ろにあります。`);
  cuts.push({ at: scene.start, path: ins.path, scene: ins.scene });
}
cuts.sort((a, b) => a.at - b.at);

console.log(`書き出し: ${totalFrames} フレーム / ${meta.fps}fps -> ${outPath}`);

// 素材を挟む・音を付けるときは、いったん隣に書き出してから仕上げる。
const hasClips = Boolean(introPath) || cuts.length > 0;
const hasAudio = Boolean(audioPath);
const bodyPath = hasClips || hasAudio ? outPath.replace(/\.mp4$/, '.body.mp4') : outPath;
// 素材を挟んだ結果。音も付けるなら、これもまだ途中の置き場になる。
const joinedPath = hasAudio ? outPath.replace(/\.mp4$/, '.joined.mp4') : outPath;

/** ffmpeg を1回走らせる。失敗したら末尾のログを添えて投げる。 */
function runFfmpeg(args, label) {
  return new Promise((res, rej) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (c) => { err += c.toString(); });
    proc.on('close', (code) => {
      if (code === 0) res();
      else rej(new Error(`${label}に失敗しました (code ${code})\n${err.slice(-2000)}`));
    });
  });
}

const ffmpeg = spawn(ffmpegPath, [
  '-y',
  '-f', 'image2pipe',
  '-framerate', String(meta.fps),
  '-i', '-',
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', crf,
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  bodyPath,
], { stdio: ['pipe', 'ignore', 'pipe'] });

let ffmpegErr = '';
ffmpeg.stderr.on('data', (c) => { ffmpegErr += c.toString(); });

const done = new Promise((res, rej) => {
  ffmpeg.on('close', (code) => {
    if (code === 0) res();
    else rej(new Error(`ffmpeg が異常終了しました (code ${code})\n${ffmpegErr.slice(-2000)}`));
  });
});

/** stdin が詰まったら書き込み側を待たせる。待たないとメモリを食い潰す。 */
function write(buf) {
  if (ffmpeg.stdin.write(buf)) return Promise.resolve();
  return new Promise((res) => ffmpeg.stdin.once('drain', res));
}

const started = Date.now();
for (let frame = 0; frame < totalFrames; frame++) {
  const dataUrl = await page.evaluate((f) => {
    window.heibeiMotion.seek(f);
    const canvas = document.getElementById('stage');
    return canvas.toDataURL('image/png');
  }, frame);
  await write(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));

  if (frame % 60 === 0 || frame === totalFrames - 1) {
    const pct = Math.round(((frame + 1) / totalFrames) * 100);
    const rate = (frame + 1) / ((Date.now() - started) / 1000);
    process.stdout.write(`\r  ${pct}%  (${frame + 1}/${totalFrames}, ${rate.toFixed(1)} fps)   `);
  }
}
process.stdout.write('\n');

ffmpeg.stdin.end();
await done;

await browser.close();
await server.close();

if (hasClips) {
  // 素材と本編の断片を順番に並べ、隣どうしをディゾルブでつなぐ。
  const segments = [];
  if (introPath) segments.push({ kind: 'clip', path: asInput(introPath), dur: clipSec });

  let prev = 0;
  for (const cut of cuts) {
    segments.push({ kind: 'body', start: prev, dur: cut.at - prev });
    segments.push({ kind: 'clip', path: cut.path, dur: clipSec });
    prev = cut.at;
  }
  segments.push({ kind: 'body', start: prev, dur: bodySec - prev });

  for (const seg of segments) {
    if (seg.dur <= dissolveSec) {
      throw new Error(`つなぎ目が詰まりすぎています（${seg.dur.toFixed(2)}秒）。--dissolve を短くしてください。`);
    }
  }

  const label = segments
    .map((s) => (s.kind === 'clip' ? '素材' : `本編 ${s.start.toFixed(1)}〜${(s.start + s.dur).toFixed(1)}s`))
    .join(' → ');
  console.log(`組み立て: ${label}（ディゾルブ ${dissolveSec}秒）`);

  const inputs = [];
  for (const seg of segments) {
    // 尺は -t で入力側を切る。filter の trim は後段にフレームレートを伝えず xfade が拒む。
    if (seg.kind === 'clip') inputs.push('-t', String(seg.dur), '-i', seg.path);
    else inputs.push('-ss', String(seg.start), '-t', String(seg.dur), '-i', bodyPath);
  }

  // fps は必ず最後に置く。setpts より前だとレートが未定として xfade に拒まれる。
  const norm =
    `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
    `setsar=1,setpts=PTS-STARTPTS,format=yuv420p,fps=${meta.fps}`;

  const parts = segments.map((_, i) => `[${i}:v]${norm}[v${i}]`);
  let prevLabel = 'v0';
  let running = segments[0].dur;
  for (let i = 1; i < segments.length; i++) {
    const out = i === segments.length - 1 ? 'out' : `x${i}`;
    const offset = (running - dissolveSec).toFixed(3);
    parts.push(`[${prevLabel}][v${i}]xfade=transition=fade:duration=${dissolveSec}:offset=${offset}[${out}]`);
    running = running + segments[i].dur - dissolveSec;
    prevLabel = out;
  }

  await runFfmpeg([
    '-y',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', `[${prevLabel}]`,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', crf,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    joinedPath,
  ], '組み立て');
  await rm(bodyPath, { force: true });
  console.log(`仕上がり: ${running.toFixed(1)}秒`);
}

if (hasAudio) {
  const audio = asInput(audioPath);
  console.log(`音楽を重ねます: ${audio}`);
  const videoIn = hasClips ? joinedPath : bodyPath;
  // 絵は作り直さない（-c:v copy）。音だけ載せる。
  // loudnorm は -13 LUFS。ナレーションが無い映像なので、やや前に出して良い。
  await runFfmpeg([
    '-y',
    '-i', videoIn,
    '-i', audio,
    '-c:v', 'copy',
    '-af', 'loudnorm=I=-13:TP=-1.0:LRA=9',
    '-c:a', 'aac',
    '-b:a', '192k',
    // loudnorm は内部で標本化周波数を上げる。そのまま出すと 96kHz になり、
    // 古いプレーヤーや PowerPoint で音が出ないことがあるので 48kHz に戻す。
    '-ar', '48000',
    '-shortest',
    '-movflags', '+faststart',
    outPath,
  ], '音の重ね合わせ');
  await rm(videoIn, { force: true });
}

console.log(`完成: ${outPath}`);
