# ADR-0013: 学習データの統制と opt-in を analytics から分離する

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

Grift v2 は、将来的に上流工程に特化した独自モデル群を持つことを目標にする。

候補となるデータは以下である。

- Requirement Artifact
- Proposal / Estimate / Approval の構造化履歴
- ProjectOutcome
- 匿名化済み cross-tenant benchmark
- redaction 済みの会話断片
- 社内 Git 実績から抽出した正規化指標

しかし、以下を混同すると危険である。

- 分析のための利用
- 推論時の補正値としての利用
- 学習用 corpus としての利用

特に「analytics への同意」と「model training への同意」は別物である。

## 決定

学習データ利用は `analytics_opt_in` から分離し、別の明示同意 `training_opt_in` で管理する。

### 1. opt-in の分離

tenant 設定に以下を持つ。

- `analytics_opt_in`
  - 匿名化済み cross-tenant benchmark の生成に利用してよい
- `training_opt_in`
  - redaction / normalization 済みデータを、モデル評価または学習用 corpus に利用してよい

初期既定値:

- `analytics_opt_in = false`
- `training_opt_in = false`

`training_opt_in` は `analytics_opt_in` を自動で有効化しない。同様に `analytics_opt_in` も学習利用を意味しない。

### 2. 学習データの許可レイヤー

学習候補として許可するのは以下。

- 正規化済み Requirement Artifact
- band 化済み Estimate / Outcome
- 匿名化済み capability / stack / win-loss パターン
- 明示同意済み tenant から抽出した redaction 済み会話断片
- 引用整合性と品質チェックを通した instruction pair

学習候補として禁止するのは以下。

- 顧客資料原本
- raw chat transcript
- raw webhook payload
- private repository のコード断片
- third-party LLM に送信済みの restricted prompt をそのまま再利用した corpus

### 3. ストレージ分離

用途ごとに保管先を分ける。

- BigQuery
  - cohort 抽出
  - ラベル集計
  - 評価結果
  - データ lineage
- GCS
  - 学習用 JSONL / Parquet corpus
  - dataset version snapshot
  - redaction 済み instruction set
- Cloud SQL
  - opt-in 状態
  - dataset publish 履歴
  - delete / tombstone 管理

BigQuery は training corpus の本体ストアではない。

### 4. 学習ロードマップ

独自モデルは以下の順で育てる。

#### Phase A: 評価と補助モデル

- 見積補正 classifier
- go / no-go reranker
- market evidence quality scorer
- requirement completeness judge

#### Phase B: domain adapters

- Qwen3.5 に対する LoRA / adapter tuning
- 上流工程向け instruction tuning

#### Phase C: 上位モデル化

- 継続的な domain-adaptive training の評価
- multimodal ingestion を含む専用モデル化の検討

いきなり full pretraining は行わない。

### 5. 学習前の必須チェック

1. opt-in の確認
2. redaction version の確認
3. taxonomy version の確認
4. de-identification test の通過
5. deletion tombstone の反映
6. evaluation baseline の作成

### 6. 削除と opt-out

tenant が `training_opt_in = false` に変更した場合:

- 未公開 corpus から 30 日以内に除外する
- 公開済み dataset version には tombstone を記録し、次回以降の学習から必ず除外する
- 既存モデルへの過去影響は model card と release note に明示する

個票単位の削除要求がある場合も同様に tombstone を付与する。

### 7. モデル利用ポリシー

- training corpus は原則として self-hosted 環境でのみ処理する
- Restricted データを外部プロバイダの学習用途に送ってはならない
- cross-tenant 学習成果を顧客向けに使う場合、根拠は benchmark または rubric として提示し、個別データを推測できる表現を避ける

## 理由

### 同意境界の明確化

analytics と training を分けないと、顧客説明と内部統制の両方が破綻する。

### 独自モデルの実現可能性

いきなり大規模モデルを作るより、上流工程向けの classifier / reranker / adapter から始める方が現実的である。

### 削除要求への追随

lineage と tombstone を先に設計しておかないと、後からの削除対応が不可能になる。

## 結果

### 良い結果

- 学習利用の説明責任が成立する
- opt-in の粒度が明確になる
- 独自モデル化への道筋が実務的になる

### 悪い結果

- corpus 管理と lineage の実装が増える
- データセット versioning の運用が必要になる
- 学習開始までに前処理パイプラインの整備が必要になる

## 代替案

### 代替案 A: analytics opt-in を training にも流用する

却下理由:

- 同意範囲が広すぎる
- 顧客説明に耐えない
- opt-out / deletion の処理が曖昧になる

### 代替案 B: 学習データを BigQuery に一本化する

却下理由:

- corpus versioning と配布に向かない
- training run ごとの固定 snapshot を扱いにくい
- GCS の方が JSONL / Parquet 運用に自然

## 関連 ADR

- ADR-0001: ローカル LLM とクラウド LLM の責務境界
- ADR-0010: データガバナンスと保持期間
- ADR-0012: Cross-Tenant Anonymous Intelligence
