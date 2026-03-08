# ADR-0007: テナント分離は Cloud SQL native RLS とアプリ層 RBAC の二重ガードで強制する

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 は SaaS 化を見据えたマルチテナント設計を前提にしている。既存文書では `tenant_id` を全テーブルに持たせ、Go API のリポジトリ層で `WHERE tenant_id = ?` を強制する方針を採っていた。

しかし、アプリ層だけに依存したテナント分離には以下の問題がある。

- クエリ 1 本の書き忘れがそのままクロステナント漏洩につながる
- バッチ、管理画面、運用スクリプトなどでガードが抜けやすい
- コードレビューでは SQL の漏れを機械的に防ぎにくい
- BigQuery、GCS、Webhook 再処理など周辺経路でも統一した境界が必要

Cloud SQL は PostgreSQL を基盤にしており、native Row Level Security を利用できる。v2 のデータ境界はアプリ規律ではなく、データベース側でも強制できる形にするべきである。

## 決定

テナント分離は以下の 3 層で強制する。

1. Cloud SQL native RLS
2. Go API の RBAC / membership 検証
3. BigQuery / GCS / イベントのテナント属性付与

### 1. Cloud SQL native RLS

`tenant_id` を持つ全テーブルに対して、以下を必須にする。

- `tenant_id UUID NOT NULL`
- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY`
- テナント境界を含む一意制約、または複合インデックス

RLS ポリシーの基本形:

```sql
CREATE POLICY tenant_isolation_policy ON cases
USING (
  tenant_id = current_setting('app.tenant_id', true)::uuid
)
WITH CHECK (
  tenant_id = current_setting('app.tenant_id', true)::uuid
)
```

### 2. Go API の RBAC / membership 検証

Go API は以下を行う。

- JWT を検証する
- ユーザーの所属テナントとロールを解決する
- DB トランザクション開始時に `SET LOCAL app.tenant_id = '...'` を設定する
- 追加の権限制御を RBAC で行う

ロールは `owner`, `admin`, `manager`, `member`, `viewer` を維持するが、RLS はロールではなくテナント境界を担う。

### 3. 例外ロール

クロステナント処理が必要なケースは限定し、専用ロールに閉じ込める。

- `app_user`
  - 通常 API 用
  - BYPASSRLS を持たない
- `job_worker`
  - 非同期ジョブ用
  - 原則として BYPASSRLS を持たない
  - テナント単位ジョブは必ず `app.tenant_id` を設定する
- `maintenance_admin`
  - マイグレーション、監査、障害対応用
  - BYPASSRLS を許可するが、本番常用しない

### 4. BigQuery / GCS / イベント

Cloud SQL 以外も同じ境界に従う。

- BigQuery: 全テーブルに `tenant_id` を持たせる
- BigQuery: authorized views または row access policies で閲覧を制限する
- GCS: `tenant_id/` プレフィックス単位でオブジェクトを分離する
- Domain Event: event envelope に `tenant_id` を必須にする

### 5. テストと運用ガード

以下を必須にする。

- テナント越境アクセスの integration test
- SQL helper を通さない生クエリの lint / code review ルール
- `maintenance_admin` の利用監査ログ
- RLS 無効テーブル一覧の明示管理

## 理由

### 漏洩耐性

アプリ層の実装ミスがあっても、DB が最後の防波堤になる。

### 境界の一貫性

Cloud SQL、BigQuery、GCS、イベントすべてで `tenant_id` を境界キーに揃えられる。

### 将来拡張

RLS を前提にしておけば、後から一部テナントの専用 DB 化やデータ分離を進めやすい。

## 結果

### 良い結果

- クロステナント漏洩リスクを大きく下げられる
- 実装者ごとの差を DB 側で吸収できる
- 監査時に「どこで境界を守っているか」を説明しやすい

### 悪い結果

- SQL と migration の設計がやや複雑になる
- RLS 前提のテストを継続的に整備する必要がある
- 集計や管理系ジョブで例外ロール設計が必要になる

## 代替案

### 代替案 A: アプリ層の `WHERE tenant_id = ?` のみで運用する

却下理由:

- 実装ミスに弱い
- 運用スクリプトやバッチでガードが抜けやすい
- 「ガードレール」としては不十分

### 代替案 B: 初期からテナントごとに DB を完全分離する

却下理由:

- 初期段階では運用コストが高すぎる
- v2 の初期速度を落とす
- まずは共有 DB + 強制境界で十分

## 関連 ADR

- ADR-0003: Cloud SQL への移行方針を定義
- ADR-0009: イベント / Webhook の `tenant_id` と冪等性を定義
- ADR-0010: データ保持とアクセス統制を定義
