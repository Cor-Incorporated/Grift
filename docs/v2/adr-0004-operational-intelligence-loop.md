# ADR-0004: Operational Intelligence ループ

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v1 では見積の精度改善が構造化されていない。見積を出した後の実績データ（実工数、バグ率、追加開発率）が蓄積・分析されず、次の見積に反映されない。

v2 では GitHub、Linear、Slack / Discord からの実行データを BigQuery に蓄積し、見積精度のキャリブレーションと顧客ポートフォリオ分析を行う。

さらに SaaS 化を見据え、tenant 内ループとは別に匿名化済み cross-tenant intelligence を生成できる設計が必要になる。

## 決定

Operational Intelligence Context を新設し、実行データの収集 → 蓄積 → 分析 → フィードバックのクローズドループを構築する。

この Context は以下の 2 層を持つ。

- tenant-scoped loop
- cross-tenant anonymous intelligence loop

### データ収集

| データセット | ソース | 蓄積頻度 | 取得方法 |
|---|---|---|---|
| コミット活動 | GitHub Events API / Webhook | 日次バッチ | GitHub App |
| PR / レビューサイクル | GitHub PR API | イベント駆動 | Webhook |
| Issue 進捗 | GitHub Issues / Projects | イベント駆動 | Webhook |
| Linear 進捗 | Linear Webhook | イベント駆動 | Webhook |
| 顧客コミュニケーション | Slack / Discord | 日次バッチ | Bot（要約のみ、生データは送らない） |
| 見積 vs 実績 | Estimate + Linear 完了時 | 案件完了時 | Pub/Sub イベント |
| 市場エビデンス品質 | EvidenceFragment | 案件完了時 | Pub/Sub イベント |

### BigQuery データモデル

```text
bigquery/
├─ tenant_raw/
│   ├─ github_events
│   ├─ linear_events
│   └─ communication_summaries
│
├─ tenant_enriched/
│   ├─ project_outcomes
│   ├─ team_velocity
│   ├─ evidence_quality
│   └─ customer_signals
│
├─ tenant_analytics/
│   ├─ estimation_accuracy
│   ├─ customer_portfolio
│   ├─ capacity_forecast
│   └─ pricing_trends
│
└─ cross_tenant/
    ├─ stage_anonymized_features
    ├─ cohort_benchmarks
    ├─ pricing_index
    ├─ demand_trends
    └─ strength_patterns
```

tenant 系テーブルは `tenant_id` を持つ。cross-tenant 系は direct identifier を持たず、匿名化パイプライン経由でのみ生成する。

### 匿名横断レイヤー

cross-tenant レイヤーは以下の条件でのみ生成する。

- `analytics_opt_in = true` の tenant だけを対象にする
- raw text を含めない
- 顧客提示用 benchmark は `k >= 10`
- internal feature は `k >= 5`

cross-tenant intelligence は pricing、需要傾向、stack 傾向、strength-to-win の分析に使う。学習利用の可否は ADR-0013 で別管理する。

### 顧客ポートフォリオ分析

BigQuery の Scheduled Query で以下を定期生成する。

顧客別:

- 累計案件数、総工数、総売上
- 見積精度の推移（初期 ±40% → 学習後 ±15% を目標）
- バグ率と追加開発率の傾向
- コミュニケーションコスト（Slack 頻度 × 対応時間）
- LTV 予測（継続率 × 平均案件単価）

プロジェクト横断:

- 技術スタック別の工数傾向
- チーム構成別の生産性
- フェーズ別の遅延パターン
- 類似案件のクラスタリング

経営判断支援:

- 顧客継続 / 終了の推奨（LTV < 獲得コストなら警告）
- キャパシティ予測（Velocity × 稼働率）
- 新規案件の受注可否（類似案件の実績ベース）
- 価格改定の根拠データ

### フィードバックループ

```text
新規見積リクエスト
    ↓
Estimation Context が BigQuery に問い合わせ
    ↓
補正情報:
├─ 「この顧客の過去案件は見積の 1.3 倍かかる傾向」
├─ 「同規模 React 案件の実績中央値: 240 時間」
├─ 「この顧客のバグ率は平均の 2 倍 → バッファ +20% 推奨」
└─ 「Perplexity の工数推定が最も実績に近い（乖離率 8%）」
    ↓
Three-Way Proposal に実績ベースの補正が入る
    ↓
顧客への提示:
「市場相場: ¥5M / 自社実績ベース: ¥3.2M / ご提案: ¥3.5M」
「※ 同規模案件 3 件の実績に基づく精度 ±12% の見積です」
```

### ドメインイベント

- `ProjectOutcomeRecorded` — 案件完了時に見積 vs 実績を記録
- `CalibrationUpdated` — 補正係数が更新された
- `CapacityForecastRefreshed` — キャパシティ予測が再計算された
- `CustomerHealthChanged` — 顧客の健全性スコアが変動した
- `CrossTenantBenchmarkRefreshed` — 匿名横断 benchmark が更新された

## 理由

### 学習する見積

案件を重ねるほど見積精度が上がる構造は、競合にない差別化要素になる。

### 顧客ポートフォリオ管理

受託開発会社にとって「どの顧客に注力すべきか」は経営判断の根幹であり、データ駆動で支援できる。

### SaaS 化時の価値

テナントごとに独立した学習ループに加え、匿名化された横断 benchmark を持てる構造は、SaaS の価値提案としてさらに強い。

## 結果

### 良い結果

- 見積精度が案件を重ねるほど向上する
- 顧客別の傾向データが経営判断を支援する
- プロバイダ選択が自動最適化される

### 悪い結果

- BigQuery のクエリコストが増える（Scheduled Query の頻度管理が必要）
- 十分なデータが溜まるまで（10-20 案件）は補正精度が低い
- 顧客データの取り扱いにプライバシーポリシーの整備が必要
- taxonomy と匿名化ルールの運用が必要になる

## 代替案

### 代替案 A: Cloud SQL 内で完結

却下理由:

- OLTP と分析クエリの混在はパフォーマンスリスクが高い
- 時系列分析や大規模集計は BigQuery の方が適している

### 代替案 B: 外部 BI ツール（Looker / Metabase）に任せる

却下理由:

- フィードバックループ（BigQuery → Estimation Context）の自動化が困難
- BI ツールは可視化であり、ドメインロジックへの組み込みには向かない

## 関連 ADR

- ADR-0010: データガバナンスと保持期間
- ADR-0012: Cross-Tenant Anonymous Intelligence
- ADR-0013: 学習データの統制と opt-in
