# ADR-0017: ドメインイベント命名規約を PascalCase から dot.notation へ段階移行する

## ステータス

提案

## 日付

2026-03-12

## コンテキスト

ADR-0009 で定義された既存イベントは PascalCase（例: `EstimateRequested`）を使用している。一方、ADR-0015 で導入した Observation Pipeline イベントは dot.notation（例: `conversation.turn.completed`）を採用した。

移行期間中は 2 種の命名規約が共存するため、consumer がイベントタイプを一意に解決できる設計と、段階移行の運用ルールが必要。

## 決定

### 1. go-forward 標準を dot.notation に統一する

- 新規イベントは `domain.entity.action` 形式の dot.notation を必須とする
- 既存 PascalCase イベントは即時リネームせず、段階的に移行する

### 2. 命名変換マップを SSOT として管理する

`packages/domain-events` に `event_type_aliases`（論理名）を管理し、旧名と新名を同一 canonical type へ解決する。

例:

| Legacy (PascalCase) | Canonical (dot.notation) |
|---|---|
| `CaseCreated` | `case.created` |
| `CaseUpdated` | `case.updated` |
| `EstimateRequested` | `estimate.requested` |
| `EstimateCompleted` | `estimate.completed` |
| `ApprovalDecisionMade` | `approval.decision.made` |
| `HandoffInitiated` | `handoff.initiated` |
| `HandoffCompleted` | `handoff.completed` |
| `VelocityMetricRefreshed` | `velocity.metric.refreshed` |
| `MarketEvidenceCollected` | `market.evidence.collected` |
| `ProjectOutcomeRecorded` | `project.outcome.recorded` |

### 3. Consumer のイベントタイプ解決ロジックを標準化する

consumer 実装は以下の順序で event type を解決する:

1. `event_type` が dot.notation の場合はそのまま canonical として処理
2. `event_type` が PascalCase の場合は alias map で canonical へ変換
3. map に存在しない場合は `unknown_event_type` として DLQ へ送る

擬似コード:

```text
canonical = resolve(event.event_type)
if canonical is None:
  emit_dead_letter(reason="unknown_event_type")
  return
dispatch(canonical, event)
```

### 4. Producer の移行期間は dual-publish を許可する

移行対象 producer は期間限定で以下を許可する:

- payload は同一、`event_type` のみ PascalCase / dot.notation を二重 publish
- `idempotency_key` は共通の論理イベント単位で再利用し、重複処理を防止

dual-publish 期間終了後は dot.notation のみ publish する。

### 5. 移行タイムライン

- Phase A (2026-03-12 〜 2026-03-26): alias map 導入、consumer で両形式受理
- Phase B (2026-03-27 〜 2026-04-17): 主要 producer を dual-publish 化、監視で unknown_event_type をゼロ化
- Phase C (2026-04-18 〜 2026-05-08): PascalCase publish 停止、consumer の legacy 分岐を段階削除
- Phase D (2026-05-09 以降): dot.notation 完全移行、運用 runbook から legacy 手順を削除

延期条件:

- `unknown_event_type` が 7 日連続で 0 件を満たさない
- 主要 consumer（control-api / intelligence-worker）の片系で dual-publish 未対応が残る

## 理由

### 互換性を維持しながら標準化できる

即時一括置換は運用リスクが高い。alias map + dual-publish で段階移行すれば、既存 consumer を停止せずに命名統一を進められる。

### 監視可能な移行になる

`unknown_event_type` を明示メトリクス化することで、移行完了判定を定量的に行える。

## 結果

### 良い結果

- 既存 PascalCase イベントとの後方互換を維持
- 新規イベントは dot.notation に統一され、命名の一貫性が向上
- 移行完了条件を日時とメトリクスで定義できる

### 悪い結果

- 一時的に alias map と dual-publish の実装コストが増える
- 移行期間中はイベント数が増え、監視コストが上がる

## 関連 ADR

- ADR-0009: ドメインイベントと Webhook は冪等かつ再実行可能にする
- ADR-0015: Observation Pipeline は非同期 QA 抽出 + 品質スコアリングをドメイン非依存で行う
