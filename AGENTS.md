## Agent Notes

- このリポジトリは Tone.js + `tonejs-json-sequencer` のデモ用。安易な独自実装ではなく、ライブラリを優先して組み込むこと。
- 開発: `npm install` → `npm run dev` / `npm run build`。Vite + TypeScript の標準構成。
- デプロイ: GitHub Pages 用ワークフロー（`.github/workflows/gh-pages.yml`）が `npm run build` して `dist` を artifact 配布・Pages に公開する。設定を壊さないこと。
- 大きな変更前に README とデモ挙動（C4 四分音符ループ）を確認すること。
- cat2151 が提供するライブラリ（例: tonejs-json-sequencer, tonejs-mml-to-json）はタグ/コミット固定せず `main` の最新を使うこと（重大バグ修正を即時取り込むため）。
- 実装前に package.json にある cat2151 製ライブラリ（例: tonejs-json-sequencer, tonejs-mml-to-json）を `npm update <cat2151-lib-name>` で更新し、毎日の重要修正を含む最新版を取得してから作業する（lock に古い版が残るとユーザーに既知バグが再発するため）。
