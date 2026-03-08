# ADR-0005: Linear と GitHub Issues の責務分割

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v1 では Linear を一元的なタスク管理ツールとして使用している。v2 では GitHub Projects & Issues も並行して運用し、リポジトリとの密な連携を実現したい。

ただし、2 つのカンバンシステムを無秩序に使うと二重管理になり、データの不整合が発生する。

## 決定

Linear をビジネスレイヤーの SSOT、GitHub Issues & Projects を技術レイヤーの SSOT とし、同期方向を Linear → GitHub の一方向参照に限定する。

### 責務分割

#### Linear（ビジネスレイヤー SSOT）

管理対象:

- 案件単位の Project
- フェーズ単位の Cycle
- ビジネス要件レベルの Issue（顧客要求、仕様変更、承認事項）

利用者:

- 顧客（将来の SaaS ポータル経由）
- 営業
- PM

連携:

- Slack / Discord への通知
- BenevolentDirector の Handoff Context から自動生成

#### GitHub Issues & Projects（技術レイヤー SSOT）

管理対象:

- 実装タスク（PR 紐付き）
- バグトラッキング（技術的な詳細）
- コードレビュータスク
- CI/CD ステータス

利用者:

- エンジニア
- テックリード

連携:

- PR との自動リンク（`closes #123`）
- CI/CD パイプラインとの連携
- GitHub Projects でのスプリントボード

### 同期方向

```text
Linear Issue
  ├─ description に GitHub Issue / PR リンクを記載
  └─ ステータスは GitHub 側の完了をトリガーに更新

GitHub Issue / PR
  ├─ description に Linear Issue ID を記載
  └─ close 時に Webhook → Linear ステータス更新

同期方向: Linear → GitHub（参照）、GitHub → Linear（ステータス更新のみ）
SSOT: ビジネス判断 = Linear、実装事実 = GitHub
```

### Webhook フロー

```text
GitHub Issue closed / PR merged
  → GitHub Webhook
  → control-api (Go)
  → Linear API: Issue ステータスを「Done」に更新
  → Pub/Sub: ProjectOutcomeRecorded イベント発行
  → BigQuery: 実績データ蓄積
```

### BenevolentDirector からの自動生成フロー

```text
Proposal 承認 (ApprovalDecision)
  → Handoff Context
  → Linear: Project + Cycle + Issue 生成
  → GitHub: Repository + Project + Issue 生成（技術タスク分解）
  → 各 Linear Issue に対応する GitHub Issue リンクを付与
```

## 理由

### 二重管理の回避

SSOT を明確に分けることで、「どこを見ればいいか」が役割ごとに一意に決まる。

### リポジトリとの密結合

GitHub Issues は PR、CI/CD、コードレビューと直接連携できる。Linear にはこの機能がない。

### Operational Intelligence への貢献

GitHub Events（コミット、PR、Issue）と Linear Events（ステータス変更）の両方を BigQuery に流すことで、ビジネス進捗と技術進捗の相関分析が可能になる。

## 結果

### 良い結果

- 各利用者が自分の SSOT だけを見ればよい
- GitHub の CI/CD 連携を最大限活用できる
- BigQuery でビジネス × 技術の横断分析ができる

### 悪い結果

- Webhook による同期の信頼性担保が必要（リトライ、冪等性）
- Linear と GitHub の両方に Issue を作成するため、Handoff の処理が増える
- 同期遅延が発生した場合にステータス不整合が一時的に起きる

## 代替案

### 代替案 A: Linear のみに統一

却下理由:

- GitHub PR との自動連携（closes #xxx）が使えない
- エンジニアのワークフローが Linear に依存し、IDE / CLI からの操作性が下がる

### 代替案 B: GitHub Issues のみに統一

却下理由:

- ビジネスレベルの Issue 管理（顧客向け可視化、承認フロー）が GitHub Issues では弱い
- Linear の Cycle / Project 管理機能がなくなる

### 代替案 C: 双方向同期

却下理由:

- 双方向同期は競合解決が複雑になり、データ不整合のリスクが高い
- 一方向（GitHub → Linear のステータス更新のみ）に限定することで複雑性を抑える
