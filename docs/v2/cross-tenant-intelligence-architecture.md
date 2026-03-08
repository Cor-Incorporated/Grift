# Cross-Tenant Anonymous Intelligence 設計

最終更新: 2026-03-08

## 1. 目的

tenant ごとの閉じた学習ループに加えて、匿名化された横断知見をプロダクト価値に変換する。

想定する利用先:

- 顧客向け benchmark
- 営業 / PM 向け pricing radar
- go / no-go 補正
- 需要トレンドの可視化
- 独自モデル向け evaluation / training 候補抽出

## 2. 何を解くか

このレイヤーで答えたい問いは以下。

- 今月、どの案件カテゴリの需要が伸びているか
- どの stack 構成がどの価格帯に収束しているか
- どの強みを持つチームが、どの案件タイプで勝ちやすいか
- 見積乖離が大きい組み合わせは何か
- 市場価格と自社提案がどの程度ずれているか

## 3. 非ゴール

- raw 顧客データの横断検索
- online RAG の主ストア
- 個社や個人を推定できるランキング提供
- full model pretraining の即時実施

## 4. 参照アーキテクチャ

```text
Cloud SQL / GCS / Pub/Sub
        |
        v
BigQuery tenant_raw
        |
        v
BigQuery tenant_enriched
        |
        v
BigQuery tenant_analytics
        |
        v
Anonymization + taxonomy normalization job
        |
        v
BigQuery cross_tenant.stage_anonymized_features
        |
        +--> cross_tenant.cohort_benchmarks
        +--> cross_tenant.pricing_index
        +--> cross_tenant.demand_trends
        +--> cross_tenant.stack_adoption
        +--> cross_tenant.strength_patterns
        |
        +--> feature export for runtime benchmark API
        +--> cohort export for model eval / training selection
```

## 5. データセット設計

### 5.1 tenant analytics 側

保持する主テーブル:

- `tenant_analytics.estimation_accuracy`
- `tenant_analytics.customer_portfolio`
- `tenant_analytics.capacity_forecast`
- `tenant_analytics.pricing_trends`
- `tenant_enriched.project_outcomes`
- `tenant_enriched.team_velocity`

ここまでは `tenant_id` を持つ。

### 5.2 cross_tenant 側

保持する主テーブル:

- `cross_tenant.stage_anonymized_features`
- `cross_tenant.cohort_benchmarks`
- `cross_tenant.pricing_index`
- `cross_tenant.demand_trends`
- `cross_tenant.stack_adoption`
- `cross_tenant.strength_patterns`
- `cross_tenant.model_eval_cohorts`

ここでは tenant 名や会社名は保持しない。削除追随と lineage のため、内部用に `source_tenant_surrogate_id` は保持するが、customer-facing view には出さない。

## 6. 正規化 feature schema

最低限そろえる軸は以下。

| 軸 | 例 | 用途 |
|---|---|---|
| `case_category` | new_build, extension, rescue, maintenance | 需要分析 |
| `industry` | retail, healthcare, logistics | cohort 比較 |
| `company_size_band` | smb, mid, enterprise | 価格帯補正 |
| `engagement_model` | fixed_bid, retainer, t_and_m | 受注傾向 |
| `requested_capability` | ai_chat, admin_panel, mobile_app | 提案比較 |
| `stack_tags` | react, nextjs, go, python, gcp | stack trend |
| `delivery_type` | greenfield, modernization, integration | 難易度補正 |
| `pricing_band` | <1m, 1m-3m, 3m-5m, 5m+ | benchmark |
| `actual_hours_band` | <80h, 80-160h, 160-320h, 320h+ | 実績比較 |
| `winning_strengths` | speed, ai_ops, design_system, domain_knowledge | 勝率分析 |
| `estimate_error_band` | under, accurate, over | 精度改善 |

すべての派生行は以下を持つ。

- `feature_schema_version`
- `taxonomy_version`
- `generated_at`
- `opt_in_basis`
- `deid_policy_version`

## 7. 匿名化処理

### 7.1 除去するもの

- 会社名
- ユーザー名
- URL 原文
- 資料本文
- repository / issue / PR の生タイトル
- 自由記述の勝因コメント

### 7.2 変換するもの

- 金額: band 化
- 工数: band 化
- 日付: week / month 単位へ丸める
- stack: taxonomy 正規化
- 強み: controlled vocabulary へ寄せる

### 7.3 抑制するもの

- 最小 cohort 未満の slice
- 極端に希少な stack 組み合わせ
- 個票に近い生の outlier 表示

## 8. 生成するプロダクト機能

### 8.1 顧客向け

- 「同規模 / 同カテゴリ案件の匿名 benchmark」
- 「今四半期の相場トレンド」
- 「よく採用される stack と工数レンジ」

### 8.2 社内向け

- 価格改定レコメンド
- 需要カテゴリの月次レーダー
- 強みと受注率の相関分析
- proposal の勝率補正

### 8.3 モデル向け

- eval cohort sampling
- drift detection baseline
- training candidate scoring

## 9. ランタイム連携

runtime でそのまま BigQuery の重いクエリを叩かない。

以下に分ける。

- BigQuery
  - 集計
  - cohort 生成
  - trend 分析
- runtime benchmark API
  - materialized な benchmark を配信
- GCS
  - 学習 / eval corpus の snapshot

## 10. ガードレール

- `analytics_opt_in` が false の tenant は cross_tenant 系の生成対象にしない
- customer-facing benchmark は `k >= 10`
- internal feature は `k >= 5`
- raw text は cross_tenant に入れない
- taxonomy 変更時は `feature_schema_version` を上げる
- delete request 時は lineage を基に派生テーブルと corpus を追随削除する

## 11. 実装順

1. taxonomy 定義
2. anonymization job
3. `cross_tenant.stage_anonymized_features`
4. `cohort_benchmarks` / `pricing_index`
5. runtime benchmark API
6. model eval cohort export

## 12. この文書の位置づけ

この文書は ADR-0012 を実装へ落とすための具体設計である。個別の同意境界と学習利用は ADR-0013 を参照する。
