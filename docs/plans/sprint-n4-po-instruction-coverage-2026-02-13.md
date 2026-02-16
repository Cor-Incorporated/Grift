# Sprint N+4 Day1: PO非構造指示カバレッジ調査（2026-02-13）

## 1. 結論

- 現行実装は「通常の1案件1意図のヒアリング」には対応可能。
- ただし、POからの非構造指示（曖昧バグ報告/多重依頼/スコープ漂流）を **自動で抜け漏れなく要件化するには不十分**。
- 現在の実運用カバレッジ目安: **40%前後（Partial）**。

## 2. ケース別評価

| ケース | 現在の判定 | 現在できること | 足りないこと |
|---|---|---|---|
| スレッド1: 曖昧バグ報告 | Partial | `bug_report` 用のカテゴリ質問、会話完了後のレポート生成、ZIP/PDF/画像添付、GitHub URL解析 | 再現条件・日時・発生チャネル・証跡の必須化、未充足時の確定ブロック |
| スレッド2: さみだれ式チャット爆撃 | Not Ready | 変更要求は単票で登録可能（categoryあり）、有償/無償判定ルールあり | 1メッセージ内の複数意図分解、意図別ルーティング（バグ/機能/運用/請求）、優先順位自動化 |
| スレッド3: スコープ溶解 + 突然の期限変更 | Partial | 変更要求見積り、承認ゲート、見積バージョン記録 | 初回要件との差分検出、納期現実性チェック、移行イベント（撮影など）衝突検知 |

## 3. 根拠（実装確認）

- 対話ヒアリングは `ProjectType` 固定で進む: `src/app/api/conversations/route.ts`
- `bug_report` の必須カテゴリ定義はある: `src/lib/ai/system-prompts.ts`
- ただし会話入力は `project_id + content` のみ: `src/lib/utils/validation.ts`
- 変更要求の登録は単一カテゴリ1件ずつ: `src/app/api/change-requests/route.ts`
- 添付解析（ZIP/PDF/画像/Repository URL）は実装済み: `src/components/chat/chat-input.tsx`, `src/app/api/files/route.ts`, `src/app/api/source-analysis/repository/route.ts`, `src/lib/source-analysis/jobs.ts`
- 変更見積りの承認ゲートは実装済み: `src/app/api/change-requests/[id]/estimate/route.ts`, `src/app/api/estimates/route.ts`

## 4. 追加すべき機能（次スプリント実行順）

| 実行順 | Ticket | Priority | Summary | 受け入れ条件（AC） |
|---:|---|---:|---|---|
| 1 | INTAKE-201 | P0 | 非構造メッセージ意図分解 | 1入力から複数意図（bug/feature/ops/billing/account）を抽出してJSON化 |
| 2 | INTAKE-202 | P0 | 要件不足スコアリング | bugは再現手順・環境・期待/実際・影響・証跡を充足率で判定 |
| 3 | INTAKE-203 | P0 | 不足項目フォローアップ質問生成 | 未充足項目のみを1問ずつ自動質問し、充足まで確定不可 |
| 4 | INTAKE-204 | P0 | 自動チケット分割登録 | 分解結果を `change_requests` へ複数起票し、意図別に状態管理 |
| 5 | INTAKE-205 | P0 | スコープ差分検出 | 初回仕様と変更指示を比較し、影響範囲/追加工数対象を明示 |
| 6 | INTAKE-206 | P0 | 納期衝突アラート | 指定納期と推定工数・既存イベントを照合し、衝突時に承認必須化 |
| 7 | INTAKE-207 | P1 | DM/雑談由来の証跡正規化 | 受信元チャネル、時刻、発言者、添付有無を証跡として保存 |
| 8 | GOV-101-FIX | P0 | Admin画面の厳格化 | `/admin` は admin ロールのみ許可（sales/devはAPI単位で許可） |
| 9 | QA-INTAKE-301 | P0 | 非構造入力E2E | 3スレッド相当のfixtureで分解・不足抽出・見積反映を自動検証 |

## 5. 最小実装のDay配分（N+4）

- Day1: INTAKE-201/202（意図分解 + 不足スコアリング）
- Day2: INTAKE-203/204（不足質問ループ + 自動チケット分割）
- Day3: INTAKE-205/206（スコープ差分 + 納期衝突）
- Day4: GOV-101-FIX + QA-INTAKE-301（権限制御とE2E）

## 6. 追加推奨ENV（必要になった時点で）

- `PO_INTAKE_MODEL`（意図分解専用モデル）
- `PO_INTAKE_CONFIDENCE_THRESHOLD`（分解結果の採用閾値）
- `PO_REQUIREMENT_MIN_COMPLETENESS`（確定許可の最低充足率）
- `PO_DEADLINE_RISK_THRESHOLD_HOURS`（納期衝突判定閾値）
