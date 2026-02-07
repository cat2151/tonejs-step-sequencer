## Agent Notes

- このリポジトリは Tone.js + `tonejs-json-sequencer` のデモ用。安易な独自実装ではなく、ライブラリを優先して組み込むこと。
- 開発: `npm install` → `npm run dev` / `npm run build`。Vite + TypeScript の標準構成。
- デプロイ: GitHub Pages 用ワークフロー（`.github/workflows/gh-pages.yml`）が `npm run build` して `dist` を artifact 配布・Pages に公開する。設定を壊さないこと。
- 大きな変更前に README とデモ挙動（C4 四分音符ループ）を確認すること。
