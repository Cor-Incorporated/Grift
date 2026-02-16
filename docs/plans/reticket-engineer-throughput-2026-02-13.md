# 再チケット化: エンジニア負荷削減プロダクト（2026-02-13）

## 0. 目的（登壇用に明確化）

- 現在の目的を「見積作成支援」から以下へ再定義する。
- **目的:** Slack等の非構造依頼を本Webアプリ経由で構造化し、エンジニアが即着手できる粒度まで自動変換する。
- **成果指標（P0 KPI）**
  - 依頼受領から「着手可能チケット」までの時間: 30分以内（現状比 70%短縮）
  - 追加ヒアリング往復回数: 平均 3往復以下
  - バグ再現情報不足による手戻り率: 50%削減
  - Slack DM由来の漏れタスク件数: 0件

## 1. チケット運用ルール（固定）

1. Type: `Epic / Story / Task / Bug`
2. Priority: `P0（登壇前必須）/ P1（登壇後1スプリント）/ P2（後続）`
3. 共通DoR:
   - 入力チャネル、必須入力、失敗時挙動、監査ログ、権限制御が明記されていること
4. 共通DoD:
   - APIテスト、E2E、監査ログ、ロールテスト、メトリクス計測、運用Runbook更新

## 2. Epic（再編）

| ID | Type | Priority | Summary | Outcome |
|---|---|---:|---|---|
| EPIC-INBOX | Epic | P0 | 非構造依頼インボックス | Slack的な散発依頼を漏れなく正規化する |
| EPIC-REQGATE | Epic | P0 | 要件充足ゲート | 「情報不足チケット」を着手列に流さない |
| EPIC-TRIAGE | Epic | P0 | 優先度・期限・スコープ統制 | 優先順位不明/納期衝突/スコープ漂流を制御 |
| EPIC-HANDOFF | Epic | P0 | エンジニア着手パッケージ | 実装/修正に必要な情報を自動束ねる |
| EPIC-GOV | Epic | P0 | ガバナンスとバイパス防止 | Slack直投げ運用を防ぎ、監査可能にする |
| EPIC-DEMO | Epic | P0 | 登壇デモ品質保証 | 3ケースを再現して成功を示せる状態にする |

## 3. Story（起票用・実行順）

| 実行順 | ID | Epic | Priority | Summary | 受け入れ条件（AC） | Depends |
|---:|---|---|---:|---|---|---|
| 1 | INBOX-101 | EPIC-INBOX | P0 | マルチ意図抽出エンジン | 1メッセージから `bug/feature/account/billing/risk/other` を複数抽出し confidence 付きJSON保存 | - |
| 2 | INBOX-102 | EPIC-INBOX | P0 | 自動チケット分割 | 抽出意図ごとに `change_requests` 等へ分割起票し相互リンク保持 | INBOX-101 |
| 3 | INBOX-103 | EPIC-INBOX | P0 | スレッド由来メタデータ保存 | 発言者・チャネル・時刻・元メッセージID・添付有無を証跡保存 | INBOX-101 |
| 4 | REQGATE-101 | EPIC-REQGATE | P0 | 意図別必須項目マトリクス | bugは再現手順/環境/期待/実際/影響/証跡、featureは目的/受入条件/期限を必須化 | INBOX-102 |
| 5 | REQGATE-102 | EPIC-REQGATE | P0 | 充足率スコアリング | 0-100で算出し閾値未満は `needs_info` 固定、着手列へ遷移不可 | REQGATE-101 |
| 6 | REQGATE-103 | EPIC-REQGATE | P0 | 不足質問オーケストレータ | 不足項目のみ1問ずつ生成し、回答を構造化フィールドへ反映 | REQGATE-102 |
| 7 | REQGATE-104 | EPIC-REQGATE | P1 | 添付解析の要件マッピング | ZIP/PDF/Repo解析結果から必須項目候補を自動補完提案 | REQGATE-101 |
| 8 | TRIAGE-101 | EPIC-TRIAGE | P0 | 優先度自動算定 | 影響範囲×緊急度×期限で `P1..P4` を算出し理由を表示 | REQGATE-102 |
| 9 | TRIAGE-102 | EPIC-TRIAGE | P0 | 納期現実性チェック | 希望納期と推定工数/既存予定を照合し衝突時に警告+承認必須 | TRIAGE-101 |
| 10 | TRIAGE-103 | EPIC-TRIAGE | P0 | スコープ漂流検知 | 初回目的と変更履歴を比較し「目的変更」を自動フラグ化 | INBOX-103 |
| 11 | TRIAGE-104 | EPIC-TRIAGE | P1 | 依頼重複統合 | 類似依頼を自動クラスタし重複チケットを抑制 | INBOX-101 |
| 12 | HANDOFF-101 | EPIC-HANDOFF | P0 | 着手パッケージ生成 | 1クリックで「再現手順/影響範囲/差分見積/根拠URL」を生成 | REQGATE-103, TRIAGE-101 |
| 13 | HANDOFF-102 | EPIC-HANDOFF | P0 | エンジニア優先キュー | `ready_to_start` のみ表示し、優先度・期限・ブロッカーで並び替え | HANDOFF-101 |
| 14 | HANDOFF-103 | EPIC-HANDOFF | P1 | 顧客返信テンプレート | 情報不足時・有償判定時・納期再交渉時の返信案を自動生成 | REQGATE-103, TRIAGE-102 |
| 15 | GOV-101 | EPIC-GOV | P0 | Admin領域の厳格化 | `/admin` は admin のみ許可。sales/dev は許可APIのみに制限 | - |
| 16 | GOV-102 | EPIC-GOV | P0 | バイパス防止（Slack直投げ抑止） | アプリ外依頼を記録し、案件化されるまで `untracked_request` として追跡 | INBOX-103 |
| 17 | GOV-103 | EPIC-GOV | P0 | 監査ログ拡張 | 意図抽出・自動分割・優先度決定・承認操作を改ざん不可で記録 | INBOX-102, TRIAGE-101 |
| 18 | DEMO-101 | EPIC-DEMO | P0 | 3ケースE2Eシナリオ | 3つのSlack風ケースをfixtureで再現し、最終的に着手可能チケット化 | INBOX-102, REQGATE-103, TRIAGE-103, HANDOFF-102 |
| 19 | DEMO-102 | EPIC-DEMO | P0 | KPI可視化パネル | 変換時間・追加質問回数・手戻り率を時系列表示 | HANDOFF-102, GOV-103 |
| 20 | DEMO-103 | EPIC-DEMO | P0 | 登壇デモ手順書 | 5分デモで「入力→分解→補完→着手可能化」を再現可能 | DEMO-101, DEMO-102 |

## 4. Task（Day1で即着手する最小実装）

| ID | Type | Priority | Summary | AC | Depends |
|---|---|---:|---|---|---|
| TASK-INBOX-101-A | Task | P0 | `POST /api/intake/parse` 追加 | 自由文1件から複数intent JSONを返す | INBOX-101 |
| TASK-INBOX-101-B | Task | P0 | intentスキーマ追加 | `intent_type/confidence/source_message_id` をDB保存 | TASK-INBOX-101-A |
| TASK-INBOX-102-A | Task | P0 | 分割起票サービス実装 | parse結果から change request を複数作成 | INBOX-102 |
| TASK-REQGATE-101-A | Task | P0 | 必須項目ルール定義 | intent別 required_fields を設定テーブルで管理 | REQGATE-101 |
| TASK-REQGATE-102-A | Task | P0 | completeness計算関数 | 欠損項目とスコアを返す純関数+テスト | REQGATE-102 |
| TASK-REQGATE-103-A | Task | P0 | follow-up API | 欠損項目だけ質問文を生成し会話に追加 | REQGATE-103 |
| TASK-HANDOFF-101-A | Task | P0 | 着手パッケージAPI | `GET /api/change-requests/:id/ready-packet` を返す | HANDOFF-101 |
| TASK-DEMO-101-A | Task | P0 | E2E fixture 3本追加 | スレッド1-3が all green | DEMO-101 |
| TASK-GOV-101-A | Task | P0 | admin strict guard | `/admin` strict化の回帰テスト追加 | GOV-101 |

## 5. スプリント計画（登壇優先）

- **Sprint N+4 Day1**
  - TASK-INBOX-101-A/B
  - TASK-REQGATE-101-A
  - TASK-REQGATE-102-A
- **Sprint N+4 Day2**
  - TASK-INBOX-102-A
  - TASK-REQGATE-103-A
  - TASK-GOV-101-A
- **Sprint N+4 Day3**
  - TASK-HANDOFF-101-A
  - DEMO-101（E2E 3本）
  - DEMO-102（KPIパネル最小版）
- **Sprint N+4 Day4**
  - DEMO-103（登壇運用リハーサル）
  - バグ修正、CI安定化、品質ゲート最終確認

## 6. 必要ENV（未設定なら追加）

- `PO_INTAKE_MODEL`（意図分解）
- `PO_REQUIREMENT_MODEL`（不足質問生成）
- `PO_INTAKE_CONFIDENCE_THRESHOLD`（自動分割採用閾値）
- `PO_REQUIREMENT_MIN_COMPLETENESS`（着手可否閾値）
- `PO_DEADLINE_RISK_THRESHOLD_HOURS`（期限衝突判定）
- `SLACK_SIGNING_SECRET`（Slack連携を実施する場合）
- `SLACK_BOT_TOKEN`（Slack連携を実施する場合）

## 7. すぐ止めるべき運用（負荷削減のため）

1. DMでの単発依頼を正式依頼として受ける運用
2. 再現手順なしバグ報告を着手列へ入れる運用
3. 目的変更を「同一依頼」として扱い続ける運用
