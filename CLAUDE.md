# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HEIBEI は、中古マンションの成約㎡単価を当てる8問構成のブラウザゲームです。
このファイルを含め、コード内のコメント・ドキュメント・テスト名はすべて日本語で書いています。

## コマンド

```
npm run dev              # ゲーム本編の開発サーバ
npm run motion           # モーショングラフィックスを /motion/ で開く
npm test                 # 全テスト（vitest）
npm run build            # tsc --noEmit してから vite build
npm run measure          # ランク閾値の実測（乱択との比較シミュレーション）
npm run motion:render    # 映像を mp4 に書き出す
```

音楽を付けて書き出す場合:

```
node tools/buildAudio.mjs --out dist-video/heibei.wav
node tools/renderMotion.mjs --audio dist-video/heibei.wav
```

テストを1ファイルだけ、あるいは1ケースだけ動かす:

```
npx vitest run tests/score.test.ts
npx vitest run -t '同じ種なら同じ列を返す'
npx vitest                                  # ウォッチ
```

`npm run motion:render` だけは追加のツールが要ります。実行時の依存を増やさない方針のため
devDependencies には入れていません。

```
npm install --no-save playwright ffmpeg-static
npx playwright install chromium
CHROMIUM_PATH=/path/to/chrome npm run motion:render   # 既存の Chromium を使う場合
```

## 守るべき制約

この3つはプロダクトの性格そのものなので、変更前に必ず確認してください。

1. **実行時の依存パッケージはゼロ。** `dependencies` は空のまま保ちます。devDependencies は
   TypeScript / Vite / Vitest の3つだけです。
2. **外部へ通信しない。クッキーも使わない。** localStorage に保存するのはミュート状態と
   自己ベストだけです（`src/storage/prefs.ts`）。
3. **同じ入力からは必ず同じ結果が出る。** 下記「決定性」を参照。

## 決定性

このリポジトリで最も壊しやすく、壊れたときに最も気づきにくい性質です。

- **出題**: 日付キー `YYYY-MM-DD`（Asia/Tokyo）を FNV-1a で32bitに畳み、xorshift32 の種にします
  （`src/quiz/rng.ts`）。全員が同じ日に同じ8問を解くのはこのためです。`Math.random()` や
  `Date.now()` を選題の経路に持ち込むと、この保証が消えます。
- **映像**: `renderFrame(ctx, frame, data)` はフレーム番号だけから絵を決め、時計を読みません
  （`src/motion/render.ts`）。だからブラウザ再生とヘッドレス書き出しが一致します。散布図の
  横ずらしも種を固定した乱数です（`src/motion/data.ts`）。

## 構造

### 純粋な核と、副作用の殻

テストは `environment: 'node'` で動きます。DOM に触るモジュールは import すら通らないので、
ロジックは純粋側に置いてください。

- **純粋（テスト対象）**: `quiz/rng` `quiz/select` `quiz/score` `game/state` `render/layout`
  `share/shareText` `storage/prefs`（`StorageLike` を注入する） `motion/ease` `motion/scenes`
  `motion/data`
- **副作用（テストなし）**: `game/loop`（rAF） `render/draw`（Canvas） `input/pointer`
  `audio/synth`（WebAudio） `motion/main` `main.ts`

`GameState` は不変です。`startPlay` `setSlider` `tick` `confirmAnswer` はいずれも新しい状態を
返します（`src/game/state.ts`）。

### 出題の選び方

`selectQuestions`（`src/quiz/select.ts`）は単純なランダム抽出ではありません。中央値で価格帯を
3等分し、「3帯とも2問以上」かつ「同一市区町村は最大2問、同一町丁は1問まで」を満たす組み合わせを、
同じ乱数列から最大200回の貪欲試行で探して最良を採ります。帯の最低2問は保証ではなく努力目標で、
候補総数が8問に満たないときだけ例外を投げます。ここを触るときは意図を理解してからにしてください。

### データ

`src/data/market.json` は PowerShell のツール（`tools/fetchMarket.ps1` → `tools/buildMarket.ps1`）
が国土交通省 不動産情報ライブラリのAPIから作ります。APIキーはリポジトリに含めず、引数で渡します。

- **暦年1年分だけを収録します。複数年をプールしてはいけません。** 時点が混ざると正解が
  定義できなくなります。
- `src/data/loadMarket.ts` が import 時に形を検証し、壊れていれば例外を投げます。
- `tests/marketData.test.ts` が同梱データ自体の健全性（`n >= 8`、`q1 <= median <= q3`、
  中央値が出題範囲とスライダー範囲の内側、など）を守っています。データ更新時はここが最初の砦です。

### 映像

`src/motion/` は `market.json` から56.5秒・8場面の映像を組み立てます。場面割りは `scenes.ts`、
集計は `data.ts`、描画は `render.ts` です。`motion/index.html` が2つ目のビルド入口になっており、
ゲーム本編は `/`、映像は `/motion/` に出ます。

冒頭（`opening`）と末尾（`coda`）は、本編の1,032群をそのまま夜景の灯りとして散らした画です。
同じ点が `bands` で散布図になり、最後にまた灯りへ戻ります。絵を地続きにするための作りなので、
`data.ts` の `field` と `render.ts` の `drawField` は対で見てください。

音楽は `tools/buildAudio.mjs` が波形から合成します。外部の音源も音声ライブラリも使いません。
和音は場面の切り替わりで動き、`tools/renderMotion.mjs --audio` で重ねます。

映像で数字を出すときの約束:

- **町丁どうしを比べるときは築年帯を固定します。** 帯をまたぐと、差の一部が「築年の違い」で
  説明できてしまいます。`buildFocus` が築年帯を揃えたうえで開きが最大の (区市町村 × 築年帯) を
  選ぶのはこのためです。
- 少数サンプルを目立つ場所に出しません（ランキングはグループ10件以上、注目シーンは町丁15以上）。
- 出典と免責は映像内にも入れます。「国土交通省が作成したものではない」「査定・投資判断には
  使えない」の2点は外さないでください。

配色は `src/motion/palette.ts` に集約しています。連続値は青1色のランプ、強調は橙1色だけです。
文字に系列色を乗せません。

## 落とし穴

- **`tools/measureSkillGap.mjs` は `src/quiz/score.ts` の `pointsFor` と `src/constants.ts` の
  出題条件を複製しています。** 依存ゼロ・ビルド不要の素の Node で動かすためで、自動では
  同期されません。採点や出題条件を変えたら、このファイルも手で合わせてください（ファイル先頭に
  同じ注意書きがあります）。
- **`tools/buildAudio.mjs` も `src/motion/scenes.ts` の場面割りを複製しています。** 理由は
  `measureSkillGap.mjs` と同じ（依存ゼロの素の Node で動かすため）で、これも自動では同期されません。
  場面の尺や並びを変えたら、このファイルの `SCENES` も手で合わせてください。ずれると音と画の
  変わり目が合わなくなりますが、エラーにはならないので気づきにくいです。
- **`noUncheckedIndexedAccess` が有効です。** 配列の添字アクセスは `T | undefined` を返すので、
  必ず絞り込んでから使ってください。
- **`@types/node` を入れていません。** Node の組み込みモジュールが要る場合は
  `tests/node-shims.d.ts` に必要な分だけ宣言を足します。
- `src/constants.ts` が出題条件の単一の出どころで、`tests/constants.test.ts` が値を固定しています。
  定数を変えるとこのテストが落ちるのは意図どおりです。値と一緒にテストも更新してください。

## CI

`.github/workflows/deploy.yml` が `main` への push で `npm ci && npm test && npm run build` を
走らせ、`dist` を GitHub Pages に配ります。テストが落ちるとデプロイされません。
