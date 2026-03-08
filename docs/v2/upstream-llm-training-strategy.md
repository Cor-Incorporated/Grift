# 上流工程特化 LLM の学習戦略

最終更新: 2026-03-08

## 1. 目的

BenevolentDirector 固有のデータ資産を使って、上流工程に強いモデル群を段階的に作る。

ここでいう「モデル群」は 1 個の巨大 LLM だけを意味しない。まずは以下の組み合わせを前提にする。

- classifier
- reranker
- judge / rubric model
- Qwen3.5 adapter

## 2. 先に固定する考え方

- BigQuery は学習 corpus の本体ストアではない
- 学習に使えるのは `training_opt_in = true` のデータだけ
- 匿名 benchmark はそのまま学習しない。必要なら別途 instruction / label に再構成する
- まず value を出すのは `評価`, `補正`, `判定`

## 3. 学習対象タスク

初期に狙うタスクは以下。

### 3.1 分類

- 案件カテゴリ分類
- bug / additional scope 判定
- go / no-go 補助判定
- 要件の不足項目検出

### 3.2 reranking / scoring

- 類似案件候補の rerank
- market evidence の品質スコア
- proposal の勝率補正

### 3.3 generation support

- Requirement Artifact の初稿生成
- 次に聞くべき質問候補
- proposal の比較説明文の草案

## 4. データソース

許可されたソース:

- redaction / normalization 済み Requirement Artifact
- structured Proposal / Estimate / Outcome
- anonymized benchmark から作る label
- 明示同意済み conversation snippet

禁止ソース:

- raw customer docs
- raw source code
- raw private repo diff
- unrestricted personal data

## 5. 学習データの形

### 5.1 分類 / judge 用

```json
{
  "task": "change_classification",
  "input": {
    "requirement_summary": "...",
    "requested_change_summary": "...",
    "project_phase": "delivery"
  },
  "label": "additional_scope",
  "metadata": {
    "dataset_version": "2026-03-08.v1",
    "taxonomy_version": "v1",
    "redaction_version": "v1"
  }
}
```

### 5.2 generation 用

```json
{
  "messages": [
    {"role": "system", "content": "You help with upstream software discovery."},
    {"role": "user", "content": "Summarize the requirement gaps for this case..."},
    {"role": "assistant", "content": "Missing items are ..."}
  ],
  "citations": ["artifact:ra_123", "evidence:me_456"],
  "metadata": {
    "allowed_for_training": true,
    "dataset_version": "2026-03-08.v1"
  }
}
```

## 6. データ生成パイプライン

```text
Cloud SQL / BigQuery / GCS
        |
        v
opt-in filter
        |
        v
redaction + normalization
        |
        v
quality checks
        |
        +--> BigQuery lineage / eval registry
        +--> GCS dataset snapshot (JSONL / Parquet)
```

## 7. モデルロードマップ

### Stage 1: 補助モデル

- XGBoost / LightGBM / small transformer も許容
- pricing correction
- win probability
- requirement completeness

### Stage 2: Qwen3.5 adapter

- LoRA / adapter tuning
- 上流工程向け instruction tuning
- prompt 短縮と推論安定化

### Stage 3: judge ensemble

- local judge
- rule engine
- benchmark-backed rubric

### Stage 4: 専用モデル化の再評価

- multimodal ingestion が十分に蓄積された後に検討
- full pretraining ではなく domain-adaptive training を先に評価

## 8. BigQuery の役割

BigQuery は以下に使う。

- cohort 抽出
- label 集計
- drift 監視
- eval set 生成
- dataset lineage

GCS は以下に使う。

- 学習 corpus snapshot
- trainer input
- model release artifact の付帯データ

## 9. 評価

各学習リリースで最低限見るもの:

- task accuracy / F1
- citation consistency
- hallucination rate
- latency impact
- human review pass rate
- opt-out / delete 反映率

## 10. 顧客価値への接続

学習成果は以下の形で顧客価値へ戻す。

- より短いヒアリングで不足項目を発見できる
- より妥当な見積補正ができる
- 強みと市場のズレを説明できる
- bug / additional scope 判定の一貫性が上がる

## 11. 非ゴール

- いきなり独自 foundation model を作ること
- opt-in なしデータで学習すること
- raw tenant data をそのまま学習させること

## 12. 関連文書

- ADR-0012: Cross-Tenant Anonymous Intelligence
- ADR-0013: 学習データの統制と opt-in
- `qwen35-local-llm-strategy.md`
