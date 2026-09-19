// モーショングラフィックスを mp4 に書き出します。
//
//   npm run motion:render                     -- 既定（dist/ をビルド済みの前提で 1920x1080 / 30fps）
//   node tools/renderMotion.mjs --out out.mp4 --limit 60
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
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outPath = resolve(arg('out', 'dist-video/heibei-motion.mp4'));
const limit = Number(arg('limit', '0'));
const crf = arg('crf', '17');

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
  outPath,
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
console.log(`完成: ${outPath}`);
