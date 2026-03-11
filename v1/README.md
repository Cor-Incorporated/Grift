# Grift v1 (参照実装)

v1 の Next.js 実装を参照用に退避したディレクトリです。

## 構成

- `src/` — Next.js App Router ソースコード
- `e2e/` — Playwright E2E テスト
- `public/` — 静的アセット
- `supabase/` — マイグレーションファイル
- `scripts/` — v1 用ユーティリティスクリプト
- `docs/plans/` — v1 スプリント計画

## ローカル実行

```bash
cd v1
npm ci
npm run dev
```

## 注意事項

- `.env.local` はリポジトリルートに配置（v1/ には移動しない）
- v2 の SSOT ではない。実装パターンの参考用
- CI は `v1/` ワーキングディレクトリで自動実行される
