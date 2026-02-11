# The Benevolent Dictator 要件定義書 v1.0

## 1. プロダクトビジョン
複数顧客の依頼を、AI執事が「一問一答」で完璧な仕様書（Markdown）に磨き上げ、管理者の過去実績（GitHub）と市場相場（Grok）を掛け合わせた「反論不能の見積り」を自動生成する、高効率案件管理システム。

## 2. ワークフロー：聖域の構築
1. **対話フェーズ**: 執事（Claude 4.6）によるアキネーター形式の一問一答。曖昧さを排除するまで管理者に通知は飛ばない。
2. **解析フェーズ**: 
   - 顧客が提出した資料（画像、PDF、zip）をサンドボックスで解析。
   - GitHub Org連携により、過去の類似実装コードとPRを自動参照。
3. **市場調査フェーズ**: Grok APIによりSNS上の最新トレンド（単価・地雷技術）をリアルタイム取得。
4. **見積り生成**: 「市場平均より高い時給だが、実績に基づく圧倒的短納期により、トータルコストは安い」という勝てる見積りを自動算出。

## 3. 主要システム要件
- **Frontend**: Next.js 15 + shadcn/ui (アキネーターUI実装)。
- **Backend**: Supabase (PostgreSQL + pgvector + Edge Functions)。
- **AI**: Claude 4.6 Opus (要約・詰問・解析) + xAI Grok (市場/SNS調査)。
- **Integration**: GitHub App (Multi-Org対応)。

## 4. 価格算出アルゴリズム
- **公式**: $Estimate = (Your Actual Hours) \times (Market Hourly Rate \times Multiplier)$
- **根拠提示**: 「市場の総コスト」vs「自社の総コスト（高単価・短納期）」の対比レポート出力。

## 5. アウトプット形式
- 管理者へ：そのまま実装可能な Markdown 形式の要件定義書。
- 顧客へ：執事による丁寧な詰問、および市場根拠に基づいた納得感のある見積り。