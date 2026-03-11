# Grift v2 設計ドキュメント群

最終更新: 2026-03-11

このディレクトリは、v2 を再構築するための設計資料をまとめたものです。

## 読み順

1. [v2 アーキテクチャ概要](./architecture-overview.md)
2. [ADR-0001: ローカル LLM とクラウド LLM の境界](./adr-0001-local-llm-boundary.md)
3. [ADR-0002: マルチソース市場調査](./adr-0002-multi-source-market-intelligence.md)
4. [ADR-0003: Supabase から Cloud SQL への移行](./adr-0003-supabase-to-cloudsql-migration.md)
5. [ADR-0004: Operational Intelligence ループ](./adr-0004-operational-intelligence-loop.md)
6. [ADR-0005: Linear と GitHub Issues の責務分割](./adr-0005-linear-github-responsibility-split.md)
7. [ADR-0006: デプロイトポロジーとコスト最適化](./adr-0006-deployment-topology.md)
8. [ADR-0007: テナント分離と RLS](./adr-0007-tenant-isolation-and-rls.md)
9. [ADR-0008: 埋め込みモデルとベクトルスキーマ](./adr-0008-embedding-model-and-vector-schema.md)
10. [ADR-0009: イベント冪等性と Webhook replay](./adr-0009-event-idempotency-and-webhook-replay.md)
11. [ADR-0010: データガバナンスと保持期間](./adr-0010-data-governance-and-retention.md)
12. [ADR-0011: Qwen3.5 の GCP ホスティング戦略](./adr-0011-qwen35-gcp-hosting-strategy.md)
13. [ADR-0012: Cross-Tenant Anonymous Intelligence](./adr-0012-cross-tenant-anonymous-intelligence.md)
14. [ADR-0013: 学習データの統制と opt-in](./adr-0013-training-data-governance-and-opt-in.md)
15. [ADR-0014: llm-gateway NDJSON Streaming-First](./adr-0014-ai-gateway-ndjson-streaming-first.md)
16. [ADR-0015: Observation Pipeline 非同期 QA 抽出](./adr-0015-observation-pipeline-async-qa-extraction.md)
17. [ADR-0016: Estimation × Research ドメイン統合](./adr-0016-product-integration-estimation-research.md)
18. [Cross-Tenant Anonymous Intelligence 設計](./cross-tenant-intelligence-architecture.md)
19. [上流工程特化 LLM の学習戦略](./upstream-llm-training-strategy.md)
20. [プラットフォーム bootstrap](./platform-bootstrap.md)
21. [Qwen3.5 PoC 合格基準](./qwen35-poc-acceptance-criteria.md)
22. [Qwen3.5 ローカル LLM 戦略](./qwen35-local-llm-strategy.md)
23. [実装ロードマップ](./implementation-roadmap.md)
24. [テスト戦略](./testing-strategy.md)

## この資料群の狙い

- 受託開発 / 既存顧客対応に特化した v2 の境界を定義する
- `React + Go + Python` を前提に、フロントとバックエンドの責務を分離する
- `Qwen3.5` をローカル推論基盤として取り込みつつ、外部調査が必要な処理はクラウド LLM に残す
- GCP 前提のスケーラブルなデータ基盤へ移行する
- マルチプロバイダ（Grok / Brave / Perplexity / Gemini）による市場調査の信頼性を向上する
- BigQuery による実績蓄積と見積精度のフィードバックループを構築する
- 匿名化された cross-tenant intelligence を benchmark と学習準備資産へ変換する
- Linear（ビジネス）と GitHub Issues（技術）の責務を明確に分割する
- SaaS 化を見据えたマルチテナント設計を初期から組み込む

## 設計上の前提

- `Qwen3.5` の仕様については、2026-03-08 時点で公開されている GitHub README を優先する
- GCP / Firebase Auth / Linear / GitHub 連携の詳細仕様は ADR で管理する
- `.env.local` は当面 repo root に残し、v1 退避時にもアーカイブしない
- v2 はマイクロサービスから始めず、モジュラーモノリスに近い monorepo で境界を固定したうえで分離可能性を残す
- v1 のデータは移行しない（クリーンスタート）
- v1 の `source-analysis-cron.yml` は未移植の legacy 運用として schedule を停止し、必要時のみ手動実行で扱う
- 当面の運用は日本市場に限定する

## 一次情報

- Qwen Team, `Qwen3.5` GitHub README
  - https://github.com/QwenLM/Qwen3.5

## 決定事項一覧

| # | 決定 | ADR |
|---|------|-----|
| 1 | ローカル LLM とクラウド LLM の境界分離 | ADR-0001 |
| 2 | 4 プロバイダによるマルチソース市場調査 | ADR-0002 |
| 3 | Supabase → Cloud SQL 移行（クリーンスタート） | ADR-0003 |
| 4 | BigQuery 蓄積 + フィードバックループ | ADR-0004 |
| 5 | Linear = ビジネス SSOT / GitHub Issues = 技術 SSOT | ADR-0005 |
| 6 | Cloud Run + GKE 混在 + 夜間停止 | ADR-0006 |
| 7 | Cloud SQL native RLS + app RBAC の二重ガード | ADR-0007 |
| 8 | 生成モデルと埋め込みモデルを分離し、vector schema を version 管理 | ADR-0008 |
| 9 | Domain Event / Webhook は冪等かつ replay 可能にする | ADR-0009 |
| 10 | データ分類、保持期間、外部送信条件を固定する | ADR-0010 |
| 11 | Qwen3.5 の GCP 本番基盤は GKE + vLLM を第一候補とする | ADR-0011 |
| 12 | tenant 内分析と匿名横断 intelligence を別レイヤーで扱う | ADR-0012 |
| 13 | analytics 利用と training 利用の同意を分離する | ADR-0013 |
| 14 | llm-gateway NDJSON Streaming-First + OpenAI 互換 API | ADR-0014 |
| 15 | Observation Pipeline 非同期 QA 抽出 + 品質スコアリング | ADR-0015 |
| 16 | Estimation × Research ドメイン統合 | ADR-0016 |
