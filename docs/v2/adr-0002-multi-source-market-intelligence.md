# ADR-0002: マルチソース市場調査アーキテクチャ

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v1 では市場調査を xAI Grok の web_search 単独に依存している。citation-aware な信頼度スコアリング（0-95%）やソース権威ボーナス（日経、Gartner 等）は実装済みだが、単一プロバイダへの依存は以下の問題を生む。

- 根拠の多角性が不足し、顧客への説得力が弱い
- プロバイダ障害時のフォールバックがない
- 検索結果のバイアスを検出できない

v2 では Grok に加えて Brave Search API、Perplexity API、Gemini API が利用可能である。

## 決定

4 プロバイダを並列に使い、Evidence Aggregator でクロスバリデーションする。

### プロバイダ別役割

| Provider | 強み | v2 での役割 |
|----------|------|------------|
| Grok (xAI) | X / web 検索、トレンド感知 | リアルタイム市場動向、SNS 反応 |
| Brave Search | 独自インデックス、プライバシー重視 | 技術ブログ、開発者コミュニティの相場感 |
| Perplexity | 構造化回答、引用精度が高い | 公式レポート、統計データの抽出 |
| Gemini | Google 検索 grounding、大規模コンテキスト | 企業情報、決算、業界レポートの深掘り |

### アーキテクチャ

```text
Market Intelligence Orchestrator (Python Worker)
├─ 並列リクエスト
│   ├─ Grok: web_search + x_search
│   ├─ Brave: brave_web_search
│   ├─ Perplexity: structured query
│   └─ Gemini: grounded search
│
├─ EvidenceFragment 生成（プロバイダ別）
│   ├─ 工数レンジ
│   ├─ 単価レンジ
│   ├─ チーム規模
│   ├─ 期間
│   ├─ citations[]
│   └─ provider_confidence
│
└─ Evidence Aggregator
    ├─ ソース間クロスバリデーション
    ├─ 合意度ベースの信頼度スコアリング
    ├─ 矛盾検出
    └─ AggregatedEvidence 生成
```

### クロスバリデーションルール

- 3 ソース以上で合意（工数レンジの重複あり） → confidence: high
- 2 ソース合意 + 1 矛盾 → confidence: medium + 矛盾フラグ付与
- 合意なし → confidence: low + 人間レビュー必須フラグ

### 合意判定

工数レンジの合意は、各プロバイダの提示レンジに 30% 以上の重複がある場合に「合意」とする。

```text
Grok:       [200h -------- 400h]
Perplexity:      [280h ------ 450h]
→ 重複: [280h -- 400h] = 120h / 250h = 48% → 合意

Brave:  [100h -- 180h]
Gemini:                    [500h -- 800h]
→ 重複: なし → 矛盾
```

### Evidence Aggregator の位置づけ

Evidence Aggregator は Domain Service として実装する。特定の Bounded Context に属さず、Market Benchmark Context から呼び出される横断ロジックである。

### Value Object 設計

```text
EvidenceFragment (Value Object)
├─ provider: Provider
├─ hourly_rate_range: Range
├─ total_hours_range: Range
├─ team_size_range: Range
├─ duration_range: Range
├─ citations: Citation[]
├─ provider_confidence: float (0-1)
├─ retrieved_at: datetime
└─ raw_response: string

AggregatedEvidence (Value Object)
├─ fragments: EvidenceFragment[]
├─ consensus_hours_range: Range
├─ consensus_rate_range: Range
├─ overall_confidence: ConfidenceLevel (high/medium/low)
├─ contradictions: Contradiction[]
├─ requires_human_review: boolean
└─ aggregated_at: datetime
```

## 理由

### 説得力

複数の独立ソースから同じ結論に至ることで、顧客への提示に根拠が増える。

### 耐障害性

1 プロバイダが停止しても、残りで最低限の Evidence を生成できる。

### バイアス検出

プロバイダ間の矛盾を明示することで、誤った相場観に基づく見積を防ぐ。

## 結果

### 良い結果

- 市場エビデンスの信頼性が構造的に向上する
- 顧客への Three-Way Proposal で「複数ソース検証済み」と明示できる
- プロバイダ障害に対する耐性が上がる

### 悪い結果

- 4 プロバイダ分の API コストが発生する
- レイテンシが最も遅いプロバイダに律速される（並列実行で緩和）
- プロバイダ間で矛盾が多い場合、人間レビューの頻度が上がる

## 代替案

### 代替案 A: Grok 単独の改善（v1 の延長）

却下理由:

- 単一ソースでは説得力の天井がある
- プロバイダ障害時のフォールバックがない

### 代替案 B: 2 プロバイダに限定

却下理由:

- クロスバリデーションの信頼性が下がる（2 者間では矛盾時に判定不能）
- 最低 3 ソースで多数決が必要

## BigQuery フィードバック

プロバイダ別の Evidence 品質を BigQuery に蓄積し、重み付けを自動調整する。

蓄積対象:

- プロバイダ別の citation 数
- 見積採用後の実績との乖離率
- 顧客からの信頼度フィードバック（将来）

調整:

- 実績との乖離が小さいプロバイダの重みを上げる
- 特定業界で精度が高いプロバイダを優先ルーティングする
