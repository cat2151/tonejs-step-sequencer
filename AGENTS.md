## Agent Notes

## 独自実装の禁止
- このリポジトリは Tone.js + `tonejs-json-sequencer` のデモ用。
    - 安易な独自実装ではなく、ライブラリを優先して組み込むこと。
- tonejs-json-sequencer の event に存在しない機能を自前実装することは禁止。
    - 必要なら「どの event を追加すべきか」を設計し、tonejs-json-sequencer の coding agent に伝えるためのプロンプトを PR コメントで user に報告すること。

## 構成
- 開発: `npm install` → `npm run dev` / `npm run build`。Vite + TypeScript の標準構成。
- デプロイ: GitHub Pages 用ワークフロー（`.github/workflows/gh-pages.yml`）が `npm run build` して `dist` を artifact 配布・Pages に公開する。設定を壊さないこと。

## ライブラリ
- cat2151 が提供するライブラリ（例: tonejs-json-sequencer, tonejs-mml-to-json）はタグ/コミット固定せず `main` の最新を使うこと（重大バグ修正を即時取り込むため）。
- 実装前に package.json にある cat2151 製ライブラリ“すべて”（例: tonejs-json-sequencer, tonejs-mml-to-json）を対象に、
    - `npm update <lib1> <lib2> ...` などでまとめて更新し、`package-lock.json` を最新化して毎日の重要修正を含む最新版を取得してから作業すること
    - （lock に古い版が残るとユーザーに既知バグが再発するため）。

## 実装
- 大きな変更前に README とデモ挙動（C4 四分音符ループ）を確認すること。
- 単一責任の原則に従ってソースファイルを分割すること。特に500行以上の場合は検討の優先度を高めること。
- commit前にformatterとlinterを適用すること。
