import type { IntakeIntentType } from '@/types/database'

export interface IntakeDemoCase {
  id: string
  title: string
  message: string
  expectedIntentTypes: IntakeIntentType[]
}

export const INTAKE_DEMO_CASES: IntakeDemoCase[] = [
  {
    id: 'thread_bug_report',
    title: 'スレッド1: バグ報告',
    message: `@エンジニア これ、どうなってるん？バグ大量発生中。リリースできないレベル。

@エンジニア ログインも怪しい挙動があります。あと、キャラの口調がおかしいです。`,
    expectedIntentTypes: ['bug_report'],
  },
  {
    id: 'thread_mixed_bomb',
    title: 'スレッド2: さみだれ式チャット爆撃',
    message: `@エンジニア アカウント5件作って！パスワードは適当につけて！

@エンジニア 履歴まとめるフォルダの実装を明日以降で優先して欲しいです。あと、チュートリアル実装の話が出てるんだけど、考えてもらえない？

@エンジニア そういえば！APIの引き落とし口座の問題発生してない？？`,
    expectedIntentTypes: ['account_task', 'feature_addition', 'billing_risk'],
  },
  {
    id: 'thread_scope_melt',
    title: 'スレッド3: スコープ溶解',
    message: `当初依頼「学生向けAIチャットボット」→ 実は教師向けナレッジ共有 → 実はDB基盤が未整備 → 実はシステムが部門ごとに複数存在。納期は3月末のまま変わらず。

@エンジニア prodで今日16時から撮影予定なんだけど…移行タイミングは事前に連絡必要！`,
    expectedIntentTypes: ['scope_change'],
  },
]

export function getIntakeDemoCaseById(id: string): IntakeDemoCase | null {
  return INTAKE_DEMO_CASES.find((item) => item.id === id) ?? null
}

