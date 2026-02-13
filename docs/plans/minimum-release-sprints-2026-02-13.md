# 最小実装セット（2-3スプリント）/ 2026-02-13

## 公開判定の前提
- 目的: 「新規案件見積り + 既存案件の追加工数/追加料金」を顧客提示できる最小機能を本番公開する
- 判定: 重要P0を優先して `Go/No-Go` を毎日更新する

## Sprint R0（即日〜2日）: 公開ブロッカー除去

| 実行順 | Ticket | Priority | 内容 | 受け入れ条件 | 状態 |
|---:|---|---:|---|---|---|
| 1 | REL-SEC-001 | P0 | Day1 security hardening migration を本番適用 | RLS Disabledエラーが解消される | **Done (本日適用済み)** |
| 2 | REL-DATA-001 | P0 | xAI失敗/クォータ時の前回確定値フォールバック + 鮮度警告 | 見積APIが `warning` 付きで fallbackし処理継続 | **In Progress (実装済み・PR反映待ち)** |
| 3 | REL-DATA-002 | P0 | evidence appendixにwarningを保持し、risk flag連動 | fallback時に `market_evidence_fallback_used` が付与される | **In Progress (実装済み・PR反映待ち)** |
| 4 | REL-QA-001 | P0 | fallbackロジックのユニットテスト追加 | 正常/再利用/再利用不可ケースが通る | **In Progress (実装済み・PR反映待ち)** |
| 5 | REL-CI-001 | P0 | develop/mainに `quality-gate` 必須化（branch protection） | 直接pushでmain/develop更新不可 | Todo |

## Sprint R1（3-5日）: 顧客提出可能化

| 実行順 | Ticket | Priority | 内容 | 受け入れ条件 | 状態 |
|---:|---|---:|---|---|---|
| 1 | REL-OUT-001 | P0 | 変更見積り差分レポート（工数/金額/納期）出力API | CHG-105を顧客提出粒度で満たす | Todo |
| 2 | REL-OUT-002 | P0 | 顧客向け見積PDF出力（本文+根拠付録） | OUT-101最小版を提供 | Todo |
| 3 | REL-OPS-001 | P0 | APIクォータ80/95%通知（Slack/メール） | DATA-109-T3達成 | Todo |
| 4 | REL-SEC-002 | P0 | permissive RLS policy見直し（anon insert制限） | security advisor の critical/warnを削減 | Todo |
| 5 | REL-E2E-001 | P0 | 主要業務フローE2E（見積生成→承認→変更見積） | 3本以上のE2EがCI green | Todo |

## Sprint R2（5-10日）: 公開後運用安定化

| 実行順 | Ticket | Priority | 内容 | 受け入れ条件 | 状態 |
|---:|---|---:|---|---|---|
| 1 | REL-DATA-003 | P1 | BLS/e-Stat/OECDコネクタを段階導入 | 客観数値ソース多様化 | Todo |
| 2 | REL-OUT-003 | P1 | 経営ダッシュボード（粗利率/単価/KPI） | OUT-102の初版リリース | Todo |
| 3 | REL-REQ-001 | P1 | 要件品質ゲート（テンプレ/スコア/トレース） | REQ-101〜103の最小実装 | Todo |
| 4 | REL-ML-001 | P2 | 見積精度改善ループ | OUT-104の基盤を追加 | Todo |

## 本日時点で着手済み（このPRで進行）
- REL-DATA-001: `src/lib/market/evidence-fallback.ts` を追加
- REL-DATA-002: `src/app/api/estimates/route.ts`, `src/app/api/change-requests/[id]/estimate/route.ts` を更新
- REL-QA-001: `src/lib/market/__tests__/evidence-fallback.test.ts` を追加

## 直近のGo/No-Go判断条件（本日版）
- Go条件（最低）
  1. REL-SEC-001, REL-DATA-001, REL-DATA-002, REL-QA-001 が main 反映
  2. CI quality-gate が green
  3. Clerk / xAI / Claude / Supabase の本番ENVが正
- No-Go条件
  1. 顧客向け提出物（PDF/差分レポート）が未整備
  2. 主要フローE2E未整備
