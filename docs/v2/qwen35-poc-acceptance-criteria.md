# Qwen3.5 PoC 合格基準

最終更新: 2026-03-08

## 1. 目的

`Qwen3.5-9B` を GKE + vLLM + `llm-gateway` で動かし、v2 のローカル知能層として採用できるかを定量的に判定する。

## 2. 対象

今回の PoC 対象は以下に限定する。

- モデル: `Qwen3.5-9B`
- 配置: GKE + vLLM
- 契約: `llm-gateway` の OpenAI 互換 API
- タスク:
  - intent classification
  - 不足情報抽出
  - 顧客資料の内部要約
  - 次質問候補生成

今回の PoC 対象外:

- `35B-A3B` の本番採用判断
- multimodal 本番運用
- fine-tuning
- 顧客向け最終提案文の生成

## 3. 評価データセット

最低限、以下を準備する。

- 100 件のヒアリング開始文
- 50 件の会話途中 transcript
- 30 件の PDF / URL 要約課題
- 20 件の NG サンプル

各データには以下の正解ラベルを付ける。

- intent
- 欠損情報スロット
- 要約の必須観点
- 外部送信可否

## 4. 合格ライン

### 精度

- intent classification accuracy: `>= 0.90`
- 不足情報抽出 recall: `>= 0.85`
- requirement slot extraction F1: `>= 0.80`
- NG サンプルでの誤承認率: `<= 0.05`

### レイテンシ

- classify / next-question の p95: `<= 3.0s`
- 要約の p95: `<= 6.0s`
- `llm-gateway` の 5 並列時エラー率: `< 1%`

### 運用

- 24 時間 soak で致命的クラッシュ 0 件
- `llm-gateway` からの health probe 失敗率 `< 0.5%`
- fallback 発生時にクラウド LLM への切替が 100% 成功

### コスト

- 対象タスク 1 件あたりの推定コストがクラウド比較基準の `<= 40%`
- GPU 稼働率は sustained で `40% - 85%` に収まる

### セキュリティ

- Restricted データの外部送信 0 件
- prompt / response log で機密本文が平文保存されない
- external fallback 前に redaction が実行される

## 5. 失格条件

以下のいずれかに当てはまれば PoC は不合格。

- intent accuracy が `0.90` を下回る
- p95 latency が 2 日連続で閾値超過
- 外部送信禁止データが 1 件でもクラウドへ送られる
- duplicate request で non-idempotent な副作用が発生する
- 24 時間 soak で手動復旧が必要な障害が出る

## 6. 記録すべき成果物

- benchmark 実行条件
- モデル名 / 量子化条件 / GPU 構成
- サンプル数
- 指標ごとの実測値
- 失敗ケース上位 10 件
- cloud baseline 比較
- 採用 / 不採用の判断

## 7. Phase 2 完了条件

Phase 2 を完了とみなすには以下が必要。

1. `llm-gateway` 経由で `Qwen3.5-9B` を呼べる
2. 本文書の合格ラインをすべて満たす
3. benchmark 結果を `docs/` 配下に保存する
4. `35B-A3B` へ進むか、9B の役割を固定するかを ADR に反映する
