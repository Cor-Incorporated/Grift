# Demo Readiness Audit / 2026-02-13

## 結論

- 判定: **登壇デモは実施可能（条件付き GO）**
- 条件:
  1. デモ開始前に `/admin/intake` で 3 ケース一括起票を実行
  2. 「登壇デモ準備ゲート」が `READY` であること
  3. PR の `quality-gate` が green であること

## 監査対象と結果

| 項目 | 状態 | 根拠 |
|---|---|---|
| Adminアクセス制御 | OK | `src/app/admin/layout.tsx` で `admin` ロール以外を `/dashboard` にリダイレクト |
| 非構造文の意図分解 | OK | `POST /api/intake/parse` (`src/app/api/intake/parse/route.ts`) |
| 分割起票（ingest） | OK | `POST /api/intake/ingest` |
| デモケース単体起票 | OK | `POST /api/intake/demo-run` |
| デモケース一括起票（UI） | OK | `src/components/admin/intake-workspace.tsx` (`runDemoBatch`) |
| デモ成否履歴（成功/失敗） | OK | `intake_demo_runs.payload` に status/error を保存 |
| 登壇準備ゲート表示 | OK | `demo-readiness` 判定 + UIカード表示 |
| 添付受領（ZIP/PDF/画像） | OK | `POST /api/files`（25MB, MIME制限あり） |
| リポジトリURL解析受付 | OK | `POST /api/source-analysis/repository` |
| Ready Packet 表示 | OK | `GET /api/change-requests/:id/ready-packet` |
| ローカルテスト | OK | `type-check`, `lint`, `test`, `test:e2e` green |
| PR CI quality-gate | OK | PR #14 で `quality-gate` pass |

## 重要な制約（登壇前に共有すべき事項）

1. 業務フロー全体の E2E 自動テストは不足（現状はホーム画面中心の smoke）
2. 顧客向け PDF 出力・差分見積り提出フォーマットは未完成
3. dependency-review は機能フラグ次第で skip
4. Slack/Stripe 連携は仕様上スコープ外

## 登壇時の推奨運用

1. 開始5分前に 3 ケース一括起票を実行して `READY` を確認
2. `READY` でない場合は履歴の `error` を見て当該ケースのみ再実行
3. デモ本編は以下順序に固定  
   `入力(自由文) -> 分解 -> キュー化 -> Ready Packet -> 概算 -> 次アクション`

## 次スプリントで最優先にすべき追加（P0）

1. 業務フローE2E（intake -> ingest -> estimate -> taskize）を Playwright で追加
2. デモデータ初期化・再投入のワンコマンド化
3. 顧客提示用の最小出力フォーマット（PDFまたは固定テンプレ）を実装
