# ADR-0009: ドメインイベントと Webhook は冪等かつ再実行可能にする

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 は Pub/Sub によるイベント駆動と、GitHub / Linear / Slack など外部 SaaS の Webhook を前提にしている。

ただし、これらは以下の性質を持つ。

- Pub/Sub は at-least-once delivery
- GitHub / Linear Webhook は再送される
- ネットワーク失敗時に同じイベントが複数回届く
- 外部 API 更新が途中で失敗すると部分反映が起こる

この状態で冪等性を定義しないと、以下の事故が起こる。

- Linear Issue が二重作成される
- GitHub Issue close で Linear が何度も更新される
- BigQuery 集計が重複する
- replay 時に副作用が再発生する

## 決定

イベントと Webhook は、保存・配送・消費の全段階で冪等にする。

### 1. Outbox パターン

`control-api` から発行するドメインイベントは、業務テーブル更新と同一トランザクションで `outbox_events` に保存する。

```text
business state update
  + outbox_events insert
  = same transaction
```

別プロセスが `outbox_events` を Pub/Sub に配送する。

### 2. Event Envelope を固定する

すべてのイベントは以下の共通 envelope を持つ。

```text
event_id
event_type
tenant_id
aggregate_type
aggregate_id
aggregate_version
idempotency_key
correlation_id
causation_id
occurred_at
producer
payload
```

### 3. Consumer 側の重複排除

各 consumer は `processed_events` テーブルを持つ。

一意キー:

```text
(consumer_name, event_id)
```

処理順序の判定には `aggregate_version` を使い、古いイベントは無視できるようにする。

### 4. Webhook Receipt の保存

外部 Webhook は処理前に必ず receipt を保存する。

```text
InboundWebhookReceipt
├─ provider
├─ delivery_id
├─ tenant_id?            # 解決できる場合のみ
├─ payload_sha256
├─ signature_verified_at
├─ first_received_at
├─ last_received_at
├─ process_status
├─ replay_count
└─ raw_payload_ref
```

制約:

- `(provider, delivery_id)` を一意にする
- 署名検証に失敗した payload は処理しない

### 5. Retry と DLQ

Pub/Sub subscription は retry と dead-letter topic を設定する。

失敗時の流れ:

1. 一時失敗は自動 retry
2. 上限超過で DLQ
3. 管理画面または運用ジョブで replay

### 6. 外部同期のループ防止

Linear / GitHub 同期には `source_system` と `source_event_id` を保存する。

例:

- BenevolentDirector が作成した GitHub Issue に `bd_source_event_id` を残す
- 同じ ID を持つ Webhook が戻ってきたら自己反射として再作成しない

### 7. 冪等 API

外部副作用を持つ API は `idempotency_key` を必須にする。

対象:

- Linear handoff
- GitHub issue generation
- replay endpoints

### 8. Replay 方針

replay は raw payload または outbox record から行えるようにする。

条件:

- 再実行者を監査ログに残す
- replay の対象期間と件数を制限する
- 副作用 API は idempotency key を再利用する

## 理由

### 二重作成防止

イベントが再送されても、業務オブジェクトが増殖しない。

### 障害復旧

手動 replay が可能になると、運用時の回復性が高い。

### 監査可能性

どの Webhook がいつ届き、何回再送され、どう処理されたか追える。

## 結果

### 良い結果

- Pub/Sub と Webhook の現実的な配送特性に耐えられる
- DLQ から安全に回復できる
- Linear / GitHub 二重同期事故を減らせる

### 悪い結果

- receipt / outbox / processed_events の管理が増える
- event envelope 設計を先に固定する必要がある
- replay 用 UI / 運用手順が必要になる

## 代替案

### 代替案 A: Webhook をその場で処理し、保存しない

却下理由:

- 再送と重複に弱い
- 障害解析が困難
- replay できない

### 代替案 B: 外部サービスが exactly-once を保証している前提で進める

却下理由:

- 現実の配送特性と一致しない
- 実装時の事故率が高い

## 関連 ADR

- ADR-0005: Linear / GitHub の責務分割を前提とする
- ADR-0007: event envelope に `tenant_id` を必須にする
- ADR-0010: raw payload の保持期間を定義する
