# HEIBEI

中古マンションの成約㎡単価を10秒で当てる、8問構成のブラウザゲームです。

- 1プレイ 約90秒
- 全員が同じ8問を解きます（日替わり）
- スコアは平均誤差率のみ。運の要素はありません

## 遊ぶ

https://aktmk2162-source.github.io/heibei/

## データについて

出典：国土交通省 不動産情報ライブラリ（https://www.reinfolib.mlit.go.jp/）

本ゲームは同APIで取得した成約価格情報を、町丁・築年帯ごとの中央値等に集計・加工したものです。国土交通省が作成したものではありません。

このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません。

個人制作のゲームです。特定の不動産の取引を勧誘するものではなく、査定・投資判断に用いることはできません。

収録データは2025年（暦年）分の成約価格情報を集計したものです。

## モーショングラフィックス

収録データから、相場の構造を説明する46秒の映像を生成します。ブラウザで再生・確認でき、mp4 に書き出せます。

```
npm run motion          # ブラウザで再生・シーク（webm での録画ボタン付き）
npm run motion:render   # 1920x1080 / 30fps の mp4 を dist-video/ に書き出す
```

映像はフレーム番号だけから描いており、時計を読みません。同じデータからは何度書き出しても同じ映像になります。

書き出しには次の2つが要ります。実行時の依存を増やさないため devDependencies には入れていません。

```
npm install --no-save playwright ffmpeg-static
npx playwright install chromium
```

手元にすでに Chromium がある場合は、ダウンロードせずにそれを使えます。

```
CHROMIUM_PATH=/path/to/chrome npm run motion:render
```

実写や生成映像を挟むこともできます。画角とフレームレートは自動で揃え、前後へ0.8秒の
ディゾルブで入ります。

```
node tools/renderMotion.mjs \
  --intro opening.mp4 \
  --insert focus=street.mp4 \
  --insert closing=dawn.mp4 \
  --clip-seconds 4
```

`--intro` は頭に、`--insert 場面名=ファイル` はその場面の直前に入ります。場面名は
`title` / `scale` / `bands` / `cities` / `focus` / `closing` で、`--insert` は何個でも
指定できます。`--clip-seconds` は挟む素材の先頭を何秒使うかです。

素材はローカルのファイルのほか、http(s) のURLでも指定できます。手元にダウンロードしなくても、
ffmpeg がそのまま読みに行きます。

```
node tools/renderMotion.mjs --intro "https://example.com/opening.mp4"
```

音楽も付けられます。外部の音源は使わず、場面割りに合わせて波形をその場で合成します。

```
node tools/buildAudio.mjs --out dist-video/heibei.wav
node tools/renderMotion.mjs --audio dist-video/heibei.wav
```

和音は場面の切り替わりで動きます。音量は会議室で流す前提の -16 LUFS に揃えます。

## 技術

- TypeScript / HTML5 Canvas 2D / Vite / Vitest
- 実行時の依存パッケージはありません
- 外部への通信を行いません。クッキーも使いません
- 保存するのはミュート状態と自己ベストのみで、localStorage に閉じます

## 開発

```
npm install
npm run dev
npm test
npm run build
```

スキルギャップ測定（乱択との比較）を再現する場合は次を実行します。

```
npm run measure
```

## データの更新

収録データは暦年（1月〜12月）単位で作成しています。年が変わったら、新しい暦年のデータで次の手順を再実行してください。複数年をプールすることはできません（時点が混ざると正解が定義できなくなるため）。

```
powershell -ExecutionPolicy Bypass -File .\tools\fetchMarket.ps1 -KeyPath <APIキーのファイルパス> -Years <年>
powershell -ExecutionPolicy Bypass -File .\tools\buildMarket.ps1 -Year <年>
```

APIキーはリポジトリに含めません。パスは引数で渡してください。

## 制作

北野晶夫
