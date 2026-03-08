# ADR-0012: Cross-Tenant Anonymous Intelligence を tenant 内ループから分離する

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 の Operational Intelligence は、まず tenant ごとの見積精度改善と経営判断支援を目的としている。

一方、SaaS として展開する場合は、tenant ごとに閉じた学習ループだけでは差別化が弱い。匿名化された横断データから以下を抽出できると、プロダクト価値が大きく上がる。

- 月次の価格帯変動
- 案件カテゴリ別の需要トレンド
- 技術スタックの採用傾向
- どの強みを持つ会社 / チームがどの案件で勝ちやすいか
- 見積乖離や受注率に効くパターン

ただし、tenant 内分析と cross-tenant 分析を同じレイヤーで扱うと、再識別リスクと同意境界が曖昧になる。

## 決定

Operational Intelligence Context の中に、tenant 内ループとは別の `Cross-Tenant Anonymous Intelligence` レイヤーを設ける。

### 1. 分離する 2 つの分析レイヤー

#### Tenant-scoped intelligence

- 各 tenant の `tenant_id` を持つ分析データ
- 見積補正、顧客ポートフォリオ、チームキャパシティに利用
- 既存の ADR-0004 の範囲

#### Cross-tenant anonymous intelligence

- tenant 横断で使う匿名化 / 集計済み派生データ
- 顧客向け benchmark、内部の価格指数、需要レーダー、技術トレンド分析に利用
- direct identifier と raw payload は含めない

### 2. 利用条件

Cross-tenant anonymous intelligence は、tenant 単位の `analytics_opt_in = true` がある場合のみ生成対象に含める。

初期既定値:

- `analytics_opt_in = false`
- 明示的な tenant admin 操作でのみ有効化

### 3. BigQuery の論理構成

```text
bigquery/
├─ tenant_raw/
├─ tenant_enriched/
├─ tenant_analytics/
│
└─ cross_tenant/
   ├─ stage_anonymized_features
   ├─ cohort_benchmarks
   ├─ pricing_index
   ├─ demand_trends
   ├─ stack_adoption
   └─ strength_patterns
```

`cross_tenant/*` は tenant raw を直接参照しない。必ず tenant analytics から匿名化パイプラインを経由して生成する。

### 4. 匿名化ルール

cross-tenant レイヤーに流してよいのは以下のみ。

- 正規化済みカテゴリ
- 金額 / 工数 / 企業規模などの band 化済み値
- 週次 / 月次に丸めた時系列
- stack taxonomy に正規化した技術タグ
- 強み taxonomy に正規化した capability タグ
- win / loss / margin / estimate_accuracy などの集計値

cross-tenant レイヤーに流してはいけないもの:

- 顧客資料原本
- raw conversation
- raw prompt / response
- repository 名、issue title、PR title などの生テキスト
- tenant 名、会社名、担当者名、メールアドレスなど direct identifier
- 少数事例のまま逆算できる細粒度組み合わせ

### 5. 再識別防止ルール

初期ルールは以下とする。

- internal feature 生成の最小 cohort: `k >= 5`
- 顧客提示用 benchmark の最小 cohort: `k >= 10`
- `industry + case_category + stack + company_size_band` の組み合わせが最小 cohort を満たさない場合は 1 段階上の粒度へ roll-up
- customer-facing 出力では中央値、四分位、band のみ返し、個票は返さない

### 6. 標準 taxonomy

cross-tenant 分析では以下を必須軸とする。

- `case_category`
- `industry`
- `company_size_band`
- `engagement_model`
- `requested_capability`
- `stack_tags`
- `delivery_type`
- `pricing_band`
- `actual_hours_band`
- `winning_strengths`
- `change_request_ratio_band`

taxonomy は version 管理し、`feature_schema_version` をすべての派生データに持たせる。

### 7. 生成する成果物

#### 顧客提示用

- 匿名 benchmark 付き Three-Way Proposal
- 月次価格トレンド
- 技術スタック別の工数レンジ
- 要件カテゴリ別の需要傾向

#### 内部用

- pricing index
- demand radar
- stack adoption map
- strength-to-win correlation
- go / no-go 補正値

#### 学習用の前段

- model evaluation 用 cohort
- training 候補サンプルの抽出条件
- drift 監視のための基準分布

学習データそのものの利用可否は ADR-0013 で別に管理する。

## 理由

### SaaS の moat

匿名化された横断データから継続的に benchmark を作れると、単なる workflow SaaS ではなく intelligence product になる。

### tenant 分離との両立

tenant 内ループと横断 intelligence を明示的に分けることで、価値化とガバナンスを両立できる。

### 実装容易性

BigQuery の tenant analytics を元に派生ビュー / 派生テーブルを作る構成は、既存の Operational Intelligence と整合する。

## 結果

### 良い結果

- 顧客向け benchmark を自社独自データで提示できる
- 価格、需要、stack の変化を月次で追える
- モデル評価と将来の学習データ選定に活用できる

### 悪い結果

- taxonomy 設計と匿名化パイプラインの実装コストが増える
- cohort しきい値未満では提示できないケースがある
- opt-in 管理と削除追随の運用が必要になる

## 代替案

### 代替案 A: cross-tenant intelligence を持たない

却下理由:

- tenant ごとの閉じた最適化だけでは、中長期の差別化が弱い
- SaaS としての benchmark 商品価値を失う

### 代替案 B: tenant raw data をそのまま横断分析に使う

却下理由:

- 再識別リスクが高い
- opt-in と説明責任が成立しない
- 学習用途まで境界が崩れる

## 関連 ADR

- ADR-0004: Operational Intelligence ループ
- ADR-0010: データガバナンスと保持期間
- ADR-0013: 学習データの統制と opt-in
