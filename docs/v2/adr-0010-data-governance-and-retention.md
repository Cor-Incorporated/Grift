# ADR-0010: データガバナンス、保持期間、外部送信ポリシーを定義する

## ステータス

提案

## 日付

2026-03-08

## コンテキスト

v2 は以下の機密性の高いデータを扱う。

- 顧客との会話ログ
- 顧客資料（PDF / ZIP / URL 抽出結果）
- GitHub 実績データ
- 見積、提案、承認履歴
- Slack / Discord 要約
- LLM への prompt / response

既存文書では「要約のみ」「クラウドには必要最小限を送る」という方針はあるが、保持期間、削除フロー、閲覧権限、外部送信条件までは固定されていない。

この状態では以下の問題が残る。

- 実装者ごとにログ保存量がぶれる
- Slack / Discord 連携時に過剰取得が起こる
- テナント削除時の消し残しが起こる
- クラウド LLM へ送ってよいデータの境界が曖昧になる

## 決定

v2 ではデータ分類、保持期間、外部送信条件を明示的に定義する。

### 1. データ分類

4 つの分類を使う。

#### Restricted

- 顧客資料の原本
- 生の会話ログ
- private repository 由来の詳細データ
- 個人情報
- 未公開要件

#### Confidential

- Requirement Artifact
- Estimate
- ApprovalDecision
- VelocityMetric の集約値

#### Internal Analytics

- 匿名化または要約済みの分析データ
- BigQuery の集計結果

#### Public

- 公開ドキュメント
- マーケティング資料

### 2. 外部送信ポリシー

- Restricted データは原則ローカル LLM を優先する
- クラウド LLM に送る前に、要約、抜粋、redaction を行う
- Slack / Discord の raw message body は BigQuery に送らない
- 外部送信の可否は tenant ごとのポリシー設定で制御する

redaction 対象:

- メールアドレス
- 電話番号
- API キー / secret らしき文字列
- 個人名、会社名など tenant が指定する固有表現

### 3. 保持期間

初期ポリシーは以下。

| データ | 保持期間 | 備考 |
|-------|---------|------|
| inbound webhook raw payload | 90 日 | replay と障害調査用 |
| redacted prompt / response logs | 30 日 | デバッグ用、Restricted は保存しない |
| 顧客資料原本 | 案件終了後 24 か月 | legal hold があれば延長 |
| chunk / embedding | 元データ削除後 7 日以内に purge | backfill 中は二重保持あり |
| Requirement Artifact / Estimate / Approval | 最終更新後 24 か月 | 契約や請求要件で延長可 |
| BigQuery raw operational events | 400 日 | 分析用 |
| BigQuery aggregated analytics | 24 か月 | tenant 単位で削除可能 |
| audit logs | 24 か月 | 監査用 |

### 4. アクセス制御

- Restricted へのアクセスは最小権限
- サポート担当は Restricted を既定で見られない
- break-glass アクセスは期限付きかつ監査ログ必須
- 資料ダウンロードと raw payload 閲覧は個別に監査する
- cross-tenant analytics dataset と training corpus は内部の限定ロールだけが閲覧可能

### 5. 連携コネクタの既定値

- Slack / Discord 連携は tenant admin の明示的 opt-in があるまで無効
- 取得対象チャンネルは allowlist 制
- 既定では summary / signal だけを保存する

### 6. 分析 / 学習 opt-in

tenant 設定として以下を分離する。

- `analytics_opt_in`
  - 匿名化済み cross-tenant benchmark 生成への利用可否
- `training_opt_in`
  - redaction / normalization 済みデータの model eval / training 利用可否

既定値:

- `analytics_opt_in = false`
- `training_opt_in = false`

ルール:

- analytics への同意は training への同意を意味しない
- training 利用は別の明示同意が必要
- customer-facing benchmark は `analytics_opt_in` tenant 由来の匿名集計だけを使う
- training corpus は `training_opt_in` を満たしたデータのみ対象にする

### 7. 削除とエクスポート

tenant 単位で以下をサポートする。

- エクスポート
  - Requirement Artifact
  - Estimate
  - Approval
  - Handoff data
- 削除
  - Cloud SQL
  - GCS
  - vector data
  - BigQuery raw / aggregate
  - training corpus snapshot
  - lineage / tombstone registry

削除要求を受けた場合、関連 vector と BigQuery データも追随削除対象に含める。

学習済み dataset version に含まれていた場合は tombstone を記録し、次回以降の学習から除外する。

### 8. Legal Hold

法務または契約上の要件がある場合は `legal_hold` フラグで自動削除を停止できるようにする。

## 理由

### 機密性

ローカル LLM を使うだけでは不十分で、保存と送信のルールも必要である。

### 運用の一貫性

保持期間が固定されていれば、ログや BigQuery テーブルが無秩序に増えない。

### 顧客説明

「何をどこまで保存し、どこまで外部送信するか」を説明しやすくなる。

## 結果

### 良い結果

- データ最小化の方針が実装に落ちる
- tenant 削除や監査への対応がしやすくなる
- Slack / Discord 連携の境界が明確になる
- analytics と training の同意境界が明確になる

### 悪い結果

- redaction と purge の実装コストが増える
- 例外処理として legal hold を考慮する必要がある
- 保持期間ルールの運用監視が必要になる
- training corpus の lineage 管理が必要になる

## 代替案

### 代替案 A: 詳細ルールを定めず、実装チームの判断に任せる

却下理由:

- 実装者ごとの差が大きくなる
- 後から統制するコストが高い
- 監査と顧客説明が難しい

### 代替案 B: raw data を一切保存しない

却下理由:

- replay と障害調査ができない
- 運用面で復旧性が落ちる

## 関連 ADR

- ADR-0001: ローカル LLM とクラウド LLM の責務境界
- ADR-0007: tenant 境界の強制方法
- ADR-0008: embedding / vector データの寿命管理
- ADR-0009: webhook raw payload の保存と replay
- ADR-0012: Cross-Tenant Anonymous Intelligence
- ADR-0013: 学習データの統制と opt-in
