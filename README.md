# tonejs-step-sequencer

Tone.js + `tonejs-json-sequencer` の疎通チェック用デモです。demo-library / streaming demo を参考に、C4 の四分音符が NDJSON ストリーム経由でループ再生されます。

## 使い方

```bash
npm install
npm run dev   # ローカル開発
npm run build # dist 出力
```

## デプロイ

`.github/workflows/gh-pages.yml` で GitHub Pages に `dist` を artifact として公開します。エントリポイントはルートの `index.html`。
