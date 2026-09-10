// このプロジェクトは npm 依存を増やさない方針のため @types/node を導入していません。
// tests/marketData.test.ts が使う Node 組み込みモジュールのみ、必要な分だけ型を宣言します。

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
