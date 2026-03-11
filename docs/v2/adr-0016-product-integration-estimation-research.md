# ADR-0016: Estimation Domain と Research Domain を単一プロダクトとして統合する

## ステータス

提案

## 日付

2026-03-11

## コンテキスト

Grift v2（Estimation Domain: 見積・提案自動化）と next-gen-research（Research Domain: 1-to-N AI リサーチインタビュー）は、それぞれ独立したプロダクトとして設計されてきた。

両プロダクトを比較すると、以下の共通基盤が確認された:

| 共通要素 | Estimation Domain | Research Domain |
|---------|-------------------|-----------------|
| 会話エンジン | Intake Chat | Interview Chat |
| 構造化抽出 | 技術要件・予算・納期 | テーマ回答・感情・インサイト |
| 品質スコアリング | 見積精度 vs 実績 | インタビュー品質推移 |
| テナント分離 | RLS + X-Tenant-ID | 同一パターン |
| LLM 推論 | Qwen3.5 on vLLM | 同一基盤 |
| Event-Driven | Pub/Sub | 同一基盤 |
| インフラ | GCP Terraform | 同一基盤 |

一方で、以下の差異がある:

| 差異 | Estimation | Research |
|------|-----------|----------|
| Bounded Contexts | 7 (Intake〜Operational Intelligence) | 4 (Design/Interview/Observation/Analysis) |
| 会話の目的 | 要件収集 → 見積生成 | 仮説検証 → インサイト抽出 |
| N 数 | 1 案件 = 1 会話 | 1 調査 = N 並列インタビュー |
| 出力物 | 見積書・提案書 | 分析レポート・ユーザーストーリー |
| フィードバック | 見積 vs 実績の乖離 | インタビュー品質推移 |

統合の動機:

- ローカル LLM の RAG としてフィードバックループを回し、ユーザビリティを向上させるには、両ドメインのデータが同一 Training Data Lake から学習する構造が必要
- 共通基盤（llm-gateway, Observation Pipeline, テナント管理, Event Bus, Terraform）の重複実装を避ける
- Polls から継承可能なナレッジ（CI/CD 27 Workflows, processing_lock, Feature Flag 運用, Secret 管理）を一箇所で活用する（next-gen-research 内部文書 knowledge-transfer.md に基づく）

## 決定

### 1. 単一プロダクトとして統合する

Estimation Domain と Research Domain を Grift v2 の単一 monorepo 内で統合する。

```text
統合プロダクト
├─ Shared Plane（共通基盤）
│   ├─ llm-gateway（ADR-0014）
│   ├─ Observation Pipeline（ADR-0015）
│   ├─ Tenant Management
│   ├─ Event Bus (Pub/Sub)
│   └─ Training Data Lake（系譜追跡付き）
├─ Estimation Domain
│   ├─ Intake → Repository Intelligence → Market → Estimate → Handoff
│   └─ フィードバック: 見積精度 vs 実績の乖離データ
└─ Research Domain
    ├─ Design → Interview → Observation → Analysis
    └─ フィードバック: インタビュー品質スコア推移
```

### 2. 会話エンジンの統一設計

両ドメインとも GuideAgent パターンを採用する。Polls 教訓を反映し、AI 出力でフロー制御しない。

```text
コード側が System Prompt を動的更新 → AI はプレーンテキストのみ返す
```

GuideAgent パターンの仕様:

入力:
- Observation Pipeline からの `observation.completeness.updated` イベント（completeness チェックリスト、suggested_next_topics）
- セッションのターン数、経過時間

処理:
1. completeness チェックリストを評価し、未収集・低信頼度の項目を特定
2. `suggested_next_topics` を System Prompt の末尾に動的注入（例: 「残りの確認事項: 予算範囲、納期」）
3. 安全弁の評価: max turns（デフォルト 30）到達 or 3 回連続で新情報なし（3-strike rule）→ セッション完了

出力:
- 更新された System Prompt（AI に渡される）
- セッション完了フラグ（コード側が判定、AI は判定しない）

制約:
- AI の出力から `is_complete`, `asking_question_id` 等のフロー制御フィールドを読み取らない（Polls 教訓）
- System Prompt の更新は冪等（同じ completeness 状態なら同じ Prompt を生成）

会話エンジンの共通実装:

- シンプル HTTP ラッパー（50-100 行）
- NDJSON ストリーミング（ADR-0014）
- System Prompt の動的注入（Observation Pipeline の completeness 結果に基づく）
- ターン数ベースの安全弁（max turns, 3-strike rule）

ドメイン固有の差異は以下で吸収:

- CompletionTracker のチェックリスト項目（Estimation: 技術要件・予算・納期 / Research: テーマ・仮説・セグメント）
- System Prompt テンプレート（ドメインごとに異なるペルソナと質問方針）
- セッション管理（Estimation: 1:1 / Research: 1:N 並列）

### 3. Training Data Lake の合流設計

両ドメインのフィードバックが合流する Training Data Lake を設計する。

初期スキーマとして以下のカラムを全関連テーブルに追加:

```sql
source_domain      TEXT NOT NULL DEFAULT 'unknown',
training_eligible  BOOLEAN NOT NULL DEFAULT FALSE
```

これにより:

- Training Data Lake は後から VIEW で構築可能
- 各データの出自（estimation / research）が追跡可能
- fine-tuning 対象の opt-in 制御が可能（ADR-0013）

### 4. 実装フェーズへの統合

既存ロードマップに Research Domain と Observation Pipeline を追加する:

```text
Phase 1:   Repository Intelligence（進行中、Issue #110 参照）
Phase 2:   llm-gateway + vLLM 基盤 ← ADR-0014 の仕様を統合
Phase 3:   Intake + Conversation Engine ← シンプルラッパー + GuideAgent
Phase 3.5: Observation Pipeline ← ADR-0015（Phase 3 と並行可能）
Phase 4:   Market Benchmark + Analysis Engine
Phase 5:   Research Domain 統合 ← next-gen-research の 4BC を統合
Phase 6:   Feedback Loop + Training Data Lake
Phase 7:   Cross-Tenant Intelligence
```

Phase 3.5 を Phase 3 と並行にする理由:

- Observation Pipeline のインターフェース（イベントスキーマ）は Phase 2 で確定
- 実装は Phase 3 の Intake Chat からデータが流れ始めてからテスト可能
- Pipeline 本体は Intake Chat に依存しないため、並行開発が可能

**Contract-first**: 各 Phase の実装開始前に `packages/contracts/openapi.yaml` および `packages/contracts/initial-schema.sql` を先行更新する（ADR-0014 同様）。

Phase 5 で Research Domain を統合する理由:

- Shared Plane（llm-gateway, Observation Pipeline, Tenant Management）が Phase 2-3.5 で安定している前提
- Research Domain の 4 Bounded Contexts（Design, Interview, Observation, Analysis）のうち、Observation は Phase 3.5 で共通基盤として構築済み
- Interview は会話エンジンの共通実装を再利用

### 5. Polls ナレッジの再利用

| Polls 資産 | 統合プロダクトでの用途 | 移行コスト |
|-----------|----------------------|-----------|
| CI/CD 27 Workflows（※1） | ベースにして拡張 | 低 |
| GCP Terraform 構成 | ほぼそのまま | 低 |
| Streaming 3 層防御パターン | NDJSON 版に書き換え | 中 |
| processing_lock（同時実行制御） | Interview 並行実行に必須 | 低 |
| Feature Flag 運用ノウハウ | カナリアリリースに活用 | 低 |
| Secret 管理パターン | Terraform 集約で改善 | 中 |

※1: Polls の数値データ（Workflow 数、行数等）は next-gen-research 内部文書 knowledge-transfer.md に基づく。本リポジトリ内では検証不可。

## 理由

### 統合の根拠

ローカル LLM のフィードバックループを効果的に回すには、見積精度データとインタビュー品質データが同一の Training Data Lake から学習する必要がある。分離プロダクトでは cross-product のデータ共有に追加のインフラと権限管理が必要になり、コストに見合わない。

### GuideAgent パターンの根拠

Polls の最大の失敗は「AI 出力でフロー制御する」設計だった（god usecase 996 行、asking_question_id の 6 種不一致パターン）（next-gen-research 内部文書 knowledge-transfer.md に基づく）。next-gen-research の設計調査で、コード → System Prompt 動的更新 → AI plain text の方式が保守性と会話品質の両方で優位と確認された。

### フェーズ統合の根拠

Research Domain を Phase 5 に配置するのは、Shared Plane の安定を待つため。Phase 2-3.5 で llm-gateway と Observation Pipeline が実証されていれば、Research Domain は共通基盤の上に薄いドメインレイヤーを追加するだけで実装できる。

## 結果

### 良い結果

- 共通基盤の重複実装を回避（llm-gateway, Observation, Tenant, Event Bus, Terraform）
- フィードバックループが単一 Training Data Lake で完結
- Polls ナレッジを一箇所で効率的に再利用
- Research Domain が Shared Plane の上に薄く構築可能

### 悪い結果

- monorepo の複雑性が増加（2 ドメイン × 共通基盤）
- Phase 5 まで Research Domain の実装が遅れる
- 2 ドメインの要件が競合した場合の優先順位決定が必要

## 代替案

### 代替案 A: 2 つの独立プロダクトとして開発する

却下理由:

- 共通基盤（llm-gateway, Observation, Terraform 等）の重複実装
- cross-product データ共有のためのインフラ追加
- Polls ナレッジの再利用が分散

### 代替案 B: Research Domain を先に実装する

却下理由:

- Estimation Domain の方が v1 からの継続性がある
- Repository Intelligence（Phase 1）のデータ蓄積期間を確保する必要
- Market Benchmark（Phase 4）は Estimation 固有の価値

## 関連 ADR

- ADR-0013: 学習データの統制と opt-in を analytics から分離する
- ADR-0014: llm-gateway NDJSON Streaming-First
- ADR-0015: Observation Pipeline の非同期 QA 抽出設計

## 一次情報

- next-gen-research: vision.md（内部設計文書）
- next-gen-research: bounded-contexts.md（内部設計文書）
- next-gen-research: knowledge-transfer.md（Polls 教訓分析、7 カテゴリ 718 行）— 本 ADR 内の Polls に関する数値（996 行、6 種不一致、27 Workflows 等）はこの文書に基づく
- next-gen-research: conversation-engine.md（GuideAgent パターン設計）
- next-gen-research: adr-0001-conversation-observation-separation.md
- next-gen-research: adr-0002-streaming-first-design.md
