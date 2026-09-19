// モーショングラフィックスを mp4 に書き出します。
//
//   npm run motion:render                     -- 既定（dist/ をビルド済みの前提で 1920x1080 / 30fps）
//   node tools/renderMotion.mjs --out out.mp4 --limit 60
//
// 頭に実写・生成映像をつなぐ場合（本編へ 0.8 秒のディゾルブで入ります）:
//   node tools/renderMotion.mjs --intro opening.mp4 --intro-seconds 4
//
// 1フレームずつ seek して canvas の中身をそのまま取り出し、ffmpeg に流し込みます。
// 実時間で録るのではなくフレーム番号で描くので、マシンの速さに関係なく同じ映像が出ます。
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

const outPath = resolve(arg('out', 'dist-video/heibei-motion.mp4'));
const limit = Number(arg('limit', '0'));
const crf = arg('crf', '17');
const introPath = arg('intro', '');
// 尺は測らず、こちらで切り詰める。長さが分かっていればディゾルブの位置を計算で出せる。
const introSec = Number(arg('intro-seconds', '4'));
const dissolveSec = Number(arg('dissolve', '0.8'));

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
}));
const totalFrames = limit > 0 ? Math.min(limit, meta.totalFrames) : meta.totalFrames;

console.log(`書き出し: ${totalFrames} フレーム / ${meta.fps}fps -> ${outPath}`);

// intro をつなぐときは、本編をいったん隣に書き出してから合成する。
const bodyPath = introPath ? outPath.replace(/\.mp4$/, '.body.mp4') : outPath;

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

if (introPath) {
  const intro = resolve(introPath);
  console.log(`頭に ${intro} を ${introSec}秒 つなぎます（ディゾルブ ${dissolveSec}秒）`);
  // intro は長さも画角もフレームレートもまちまちなので、16:9 に充填してから揃える。
  // 尺は -t で入力側を切る。filter の trim は後段にフレームレートを伝えず xfade が拒む。
  // fps は必ず最後に置く。setpts より前だと、同じ理由でレートが未定として落ちる。
  const norm = `setsar=1,setpts=PTS-STARTPTS,format=yuv420p,fps=${meta.fps}`;
  const filter = [
    `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${norm}[a];`,
    `[1:v]${norm}[b];`,
    `[a][b]xfade=transition=fade:duration=${dissolveSec}:offset=${(introSec - dissolveSec).toFixed(3)}[v]`,
  ].join('');

  await new Promise((res, rej) => {
    const join = spawn(ffmpegPath, [
      '-y',
      '-t', String(introSec),
      '-i', intro,
      '-i', bodyPath,
      '-filter_complex', filter,
      '-map', '[v]',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', crf,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    join.stderr.on('data', (c) => { err += c.toString(); });
    join.on('close', (code) => {
      if (code === 0) res();
      else rej(new Error(`頭つなぎに失敗しました (code ${code})\n${err.slice(-2000)}`));
    });
  });
  await rm(bodyPath, { force: true });
}

console.log(`完成: ${outPath}`);
