# ADR-0015: Observation Pipeline は非同期 QA 抽出 + 品質スコアリングをドメイン非依存で行う

## ステータス

提案

## 日付

2026-03-11

## コンテキスト

v2 は Estimation Domain と Research Domain を統合する。両ドメインとも会話から構造化データを抽出する必要があるが、抽出ロジックを会話パスに埋め込むと以下の問題が生じる。

Polls（前身システム）での教訓:

- QAPairManager が会話パスの `create_message` 内で同期実行され、抽出失敗が会話をブロックした
- Structured Output を会話パスで使用し、モデル固有の JSON フィールド漏洩（Gemini, GPT）が発生した
- `asking_question_id` を AI に判断させたが、6 種類の不一致パターンが発生し、コードで毎回上書きする結果になった
- 会話制御とデータ抽出が god usecase（996 行）に結合し、80% のエンジニアリング工数が制御ロジックに消費された

next-gen-research の設計調査から、以下の原則が確認された:

- 会話エンジンは 50-100 行のシンプルな HTTP ラッパーにすべき
- AI はプレーンテキストのみを返し、フロー制御はコード側が System Prompt の動的更新で行う
- Structured Output は Observation 層でのみ使用する
- 抽出は非同期・非ブロッキングで行い、失敗が会話を止めてはならない

GCP Pub/Sub は ordering key によるメッセージ順序保証とメッセージスキーマ検証（Avro / Protocol Buffers）をサポートする（ordering key は同一キー内の順序制御であり、テナント間のデータ分離ではない）。at-least-once delivery と dead letter topic により、抽出失敗メッセージの安全なリトライが可能。（コンシューマー側の冪等処理は ADR-0009 で規定）

## 決定

### 1. Observation Pipeline をドメイン非依存の共通基盤にする

Observation Pipeline は Estimation Domain と Research Domain の両方から会話データを受け取り、統一フォーマットで処理する。ドメイン固有の抽出ロジックは Extractor プラグインとして注入する。

```text
Estimation Chat / Research Interview
        │
        ▼ (Pub/Sub: conversation.turn.completed)
┌──────────────────────────────────────────────────┐
│  Observation Pipeline (intelligence-worker)        │
│                                                    │
│  1. Event 受信（共通エンベロープ）                    │
│  2. Extractor 選択（source_domain に基づく）         │
│  3. QA Pair Extraction（LLM 経由、非同期）           │
│  4. Quality Scoring（confidence / completeness /    │
│     coherence の 3 軸）                             │
│  5. Completeness Check                             │
│  6. 結果を永続化 + 次イベント発火                     │
└──────────────────────────────────────────────────┘
        │
        ▼ (Pub/Sub: observation.qa_pair.extracted)
Feedback Loop / Analysis Engine
```

### 2. 共通イベントスキーマ

#### 入力イベント: conversation.turn.completed

```json
{
  "event_type": "conversation.turn.completed",
  "event_id": "uuid-v4",
  "aggregate_type": "conversation",
  "aggregate_id": "uuid-v4",
  "aggregate_version": 5,
  "idempotency_key": "uuid-v4:5",
  "correlation_id": "uuid-v4",
  "occurred_at": "2026-03-11T10:00:00Z",
  "producer": "control-api",
  "tenant_id": "uuid-v4",
  "source_domain": "estimation",
  "payload": {
    "session_id": "uuid-v4",
    "turn_number": 5,
    "role": "assistant",
    "content": "プレーンテキスト（AI 応答全文）",
    "previous_turns": [
      {"role": "user", "content": "ユーザー発話テキスト", "turn_number": 4}
    ],
    "system_prompt_version": "v3",
    "model_used": "qwen3.5-32b",
    "fallback_used": false
  }
}
```

`previous_turns` は QA ペア抽出に必要な会話コンテキストを提供する。Extractor が単一ターンから QA ペアを構築することはできないため、producer（control-api）が直前のターンを含める責務を持つ。ウィンドウサイズ（含めるターン数）は Extractor ごとに設定可能とし、デフォルトは直前 2-3 ターンとする。

ordering key は `session_id` を使用し、セッション内のターン順序を保証する。テナント単位の直列化はスループットに悪影響（head-of-line blocking）を与えるため避ける。

#### 出力イベント: observation.qa_pair.extracted

```json
{
  "event_type": "observation.qa_pair.extracted",
  "event_id": "uuid-v4",
  "aggregate_type": "observation",
  "aggregate_id": "{{session_id}}",
  "aggregate_version": 5,
  "idempotency_key": "uuid-v4:4-5",
  "correlation_id": "uuid-v4",
  "occurred_at": "2026-03-11T10:00:05Z",
  "producer": "intelligence-worker",
  "tenant_id": "uuid-v4",
  "source_domain": "estimation",
  "training_eligible": true,
  "payload": {
    "session_id": "uuid-v4",
    "turn_range": [4, 5],
    "qa_pair": {
      "question_intent": "技術スタック確認",
      "question_text": "使用しているフレームワークは？",
      "answer_text": "React + Next.js で...",
      "extracted_entities": {
        "frameworks": ["React", "Next.js"],
        "languages": ["TypeScript"]
      }
    },
    "quality": {
      "confidence": 0.87,
      "completeness": 0.6,
      "coherence": 0.92
    },
    "extraction_metadata": {
      "extractor": "EstimationExtractor",
      "model_used": "qwen3.5-7b",
      "latency_ms": 450
    }
  }
}
```

#### Completeness 更新イベント: observation.completeness.updated

```json
{
  "event_type": "observation.completeness.updated",
  "event_id": "uuid-v4",
  "aggregate_type": "observation",
  "aggregate_id": "{{session_id}}",
  "aggregate_version": 5,
  "idempotency_key": "uuid-v4",
  "correlation_id": "uuid-v4",
  "occurred_at": "2026-03-11T10:00:06Z",
  "producer": "intelligence-worker",
  "tenant_id": "uuid-v4",
  "source_domain": "estimation",
  "payload": {
    "session_id": "uuid-v4",
    "checklist": {
      "tech_stack": { "status": "collected", "confidence": 0.87 },
      "budget_range": { "status": "missing", "confidence": 0.0 },
      "deadline": { "status": "partial", "confidence": 0.4 },
      "scope": { "status": "collected", "confidence": 0.75 }
    },
    "overall_completeness": 0.5,
    "suggested_next_topics": ["budget_range", "deadline"]
  }
}
```

注: Observation 出力イベントの `aggregate_id` には `session_id` を使用する。セッションを安定した集約単位とすることで、ADR-0009 の `aggregate_id + aggregate_version` による順序判定と stale-event 検出が正しく機能する。フレッシュ UUID を使用すると、同一セッション内のイベント間でバージョン比較が成立しない。

注: 上記イベント例では `causation_id` を省略している。`causation_id` は Pipeline 内部で自動設定される（入力イベントの `event_id` を後続イベントの `causation_id` に伝播する）。`aggregate_version` は `turn_number`（セッション内で単調増加するターン番号）を設定する。conversation_turns テーブルは append-only でバージョン競合は発生しないが、ADR-0009 がイベント順序判定と stale-event 検出に `aggregate_version` を使用するため、省略すると同一セッションの複数ターンイベントが区別できなくなる。実装時は ADR-0009 の正規エンベロープに完全準拠すること。

イベントエンベロープは ADR-0009 の正規形に準拠する。`idempotency_key` により Pub/Sub の at-least-once 再配信時にコンシューマー側で冪等処理が可能。

#### 2.1 イベント命名規約

本 ADR で導入するイベント名（`conversation.turn.completed`, `observation.qa_pair.extracted`, `observation.completeness.updated`）は、ADR-0009 で定義された既存イベント（`IntakeRequested`, `EstimateGenerated` 等）の PascalCase 命名規約とは異なる dot.notation（`domain.entity.action`）を採用している。

この変更は意図的であり、以下の理由に基づく:

- **階層的名前空間の明確化**: dot.notation により `domain.entity.action` の 3 階層が一目で識別でき、Observation Pipeline のようにドメイン横断でイベントを処理するコンシューマーでのフィルタリング・ルーティングが容易になる
- **業界標準との整合**: CloudEvents specification や OpenTelemetry のイベント命名規約は dot.notation を推奨しており、外部ツール・監視基盤との統合が自然になる
- **後方互換性の維持**: Estimation Domain の既存 PascalCase イベント（`IntakeRequested`, `EstimateGenerated` 等）は変更しない。新規の Observation Pipeline イベントのみ dot.notation を採用する
- **今後の標準**: 新規ドメインイベントは dot.notation を go-forward standard とする

> 命名規約の段階移行方針は ADR-0017 で定義した。マイグレーション期間中は PascalCase と dot.notation が共存するため、コンシューマー側は ADR-0017 の event type 解決ロジックに従う。

### 3. Extractor プラグインインターフェース

Extractor は `intelligence-worker`（Python）内で動作する。インターフェースは `typing.Protocol` で定義し、ドメインごとにプラグインとして実装する。

```python
from typing import Protocol

class Extractor(Protocol):
    def domain(self) -> str: ...
    def context_window_size(self) -> int: ...
    def extract(self, turn: ConversationTurn, previous_turns: list[ConversationTurn]) -> list[QAPair]: ...
    def checklist_items(self) -> list[str]: ...
    def score(self, pairs: list[QAPair]) -> QualityScore: ...
```

初期実装:

- `EstimationExtractor`: 技術要件、予算、納期、スコープを抽出
- `ResearchExtractor`: テーマ回答、感情、インサイトを抽出

Pipeline 本体はドメインを知らない。新しいドメインを追加するときは Extractor を実装するだけ。

抽出 LLM コールは会話に使うモデルとは独立。軽量モデル（`qwen3.5-7b`）で十分な場合が多い。

### 4. 品質スコアリング 3 軸

| 軸 | 定義 | 用途 |
|---|------|------|
| **confidence** (0.0-1.0) | 抽出結果の確信度 | 低ければ再質問トピックを System Prompt に注入 |
| **completeness** (0.0-1.0) | チェックリスト充足率 | セッション完了判定 |
| **coherence** (0.0-1.0) | 前後の回答との一貫性 | 矛盾検出 → フォローアップ質問生成 |

### 5. 会話エンジンとの分離原則

会話パスで禁止する事項:

- Structured Output の使用（JSON mode 含む）
- AI 出力からのフロー制御フィールド抽出（`asking_question_id`, `is_terminating` 等）
- QA Pair の同期抽出

会話パスで許可する事項:

- Observation Pipeline からの completeness 結果を読み取り、System Prompt に反映する
- プレーンテキストの AI 応答をそのまま NDJSON ストリームで返す
- ターン数・時間ベースの安全弁（max turns, 3-strike rule）

### 5.5. 非同期抽出の eventual consistency

Observation Pipeline は非同期で動作するため、次のユーザー発話が抽出完了前に到着するケースがある。

この場合の方針:

- **eventual consistency を受け入れる**: System Prompt への completeness 反映は「利用可能な最新の抽出結果」に基づく。抽出が間に合わない場合は前回の completeness 状態を使用する
- **ブロッキングしない**: 抽出完了を待ってから次ターンを処理することはしない（Polls 教訓: 同期抽出が会話をブロックした）
- **収束を保証する**: セッション内で抽出が完全に追いつかないまま完了するケースは、CompletionTracker の最終評価で catch-up 処理を行う

レイテンシ目標: 抽出完了までの p95 < 5 秒。通常の会話テンポ（10-30 秒/ターン）であれば、次ターンまでに抽出が完了する設計とする。

### 6. フィードバックループ

3 段階のフィードバックループを設計する:

1. **短期（セッション内）**: Quality Score 低下 → suggested_next_topics を System Prompt に注入 → 次ターンで改善
2. **中期（テナント内）**: 過去 N 件のパターン → テナント固有の Prompt テンプレート自動調整
3. **長期（cross-tenant, opt-in）**: 匿名化データ → ローカル LLM の fine-tuning（ADR-0013 の training_opt_in に基づく）

### 7. training_eligible の設定ルール

Observation Pipeline は QA Pair 抽出結果に `training_eligible` フラグを設定する際、テナントの `training_opt_in` 状態（ADR-0013）を必ずチェックする。

- `training_opt_in = true` のテナント → `training_eligible = true` を設定可能
- `training_opt_in = false` のテナント（デフォルト） → `training_eligible` は常に `false`

この制約は Pipeline 内で強制し、Extractor プラグインからは制御できない。

### 8. エラーハンドリング

抽出失敗時は `confidence: 0` で記録し、会話を止めない。リトライは Pub/Sub の再配信 + dead letter topic で行う。

Polls の「6 層防御コード」を繰り返さない。エラー処理は以下のみ:

- 抽出タイムアウト → `confidence: 0` で記録、リトライキューへ
- LLM エラー → dead letter topic へ、アラート発火
- パース不能 → ログ記録、スキップ

## 理由

### Observation 分離の根拠

Polls の god usecase（996 行）は会話制御とデータ抽出の結合が原因。next-gen-research の設計調査で、会話エンジンを 50-100 行に保つには抽出を完全に分離する必要があると確認された。非同期にすることで抽出失敗がユーザー体験に影響しない。

### ドメイン非依存の根拠

Estimation と Research の両ドメインが QA 抽出 → 品質スコアリング → Completeness 追跡の共通パターンを持つ。差異は抽出対象のエンティティとチェックリスト項目のみであり、Extractor プラグインで吸収可能。

### Pub/Sub 採用の根拠

GCP Pub/Sub は ordering key によるメッセージ順序保証、at-least-once delivery、dead letter topic をサポートする。スキーマ検証（Avro / Protocol Buffers）により、イベントフォーマットの不整合を publish 時に検出できる。

### training_eligible フラグの根拠

ADR-0013（Training Data Governance）との整合。抽出結果に `source_domain` と `training_eligible` を初期段階から付与することで、後から Training Data Lake を構築する際にスキーマ変更なしで対応可能。

## 結果

### 良い結果

- 会話エンジンが 50-100 行に保たれる
- 抽出失敗が会話をブロックしない
- 新しいドメイン追加が Extractor 実装のみ
- フィードバックループにより SaaS が自動的に改善される
- Training Data Lake への合流が設計段階で準備される

### 悪い結果

- Pub/Sub 経由の非同期処理により、リアルタイム性が若干犠牲になる（抽出結果が次ターンまでに間に合わない可能性）
- Extractor の品質がドメイン知識に依存し、初期精度は人間によるチューニングが必要
- 3 軸スコアリングの閾値設定に運用データが必要（初期はヒューリスティック）

## 代替案

### 代替案 A: 会話パス内で同期抽出する

却下理由:

- Polls の god usecase の再来
- 抽出失敗が会話をブロックする
- Structured Output がモデル固有の漏洩を引き起こす

### 代替案 B: ドメインごとに独立した Observation Pipeline を持つ

却下理由:

- 共通パターン（QA 抽出、スコアリング、Completeness）の重複実装
- Training Data Lake への合流が複雑になる
- 運用・監視の対象が倍増する

## 関連 ADR

- ADR-0013: 学習データの統制と opt-in を analytics から分離する
- ADR-0014: llm-gateway NDJSON Streaming-First
- ADR-0016: Estimation × Research ドメイン統合

## 一次情報

- Google Cloud Pub/Sub Overview
  - https://cloud.google.com/pubsub/docs/overview
- Google Cloud Pub/Sub Schemas
  - https://cloud.google.com/pubsub/docs/schemas
- NDJSON Specification
  - https://github.com/ndjson/ndjson-spec
- next-gen-research: observation-pipeline.md（内部設計文書）
- next-gen-research: conversation-engine.md（内部設計文書）
- next-gen-research: knowledge-transfer.md（Polls 教訓分析）
