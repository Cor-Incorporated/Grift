import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/ai/anthropic'
import { queryGrok } from '@/lib/ai/grok'
import type { ProjectType, EstimateMode } from '@/types/database'

function getEstimateMode(projectType: ProjectType): EstimateMode {
  switch (projectType) {
    case 'new_project':
      return 'market_comparison'
    case 'bug_report':
    case 'fix_request':
      return 'hours_only'
    case 'feature_addition':
      return 'hybrid'
  }
}

async function estimateHours(
  specMarkdown: string,
  projectType: ProjectType
): Promise<{
  investigation: number
  implementation: number
  testing: number
  buffer: number
  total: number
  breakdown: string
}> {
  const prompt = `あなたはシニアソフトウェアエンジニアです。以下の仕様書を読み、工数を見積もってください。

案件タイプ: ${projectType}

各フェーズの時間（時間単位）をJSON形式で返してください：
\`\`\`json
{
  "investigation": 調査・分析時間,
  "implementation": 実装時間,
  "testing": テスト時間,
  "buffer": バッファ時間,
  "total": 合計時間,
  "breakdown": "Markdown形式の工数内訳説明"
}
\`\`\`

バッファ率の目安:
- bug_report: 20-30%
- fix_request: 10-20%
- feature_addition: 15-25%
- new_project: 15-25%`

  const response = await sendMessage(prompt, [
    { role: 'user', content: specMarkdown },
  ])

  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1])
  }
  return JSON.parse(response)
}

async function getMarketData(techStack: string) {
  try {
    const response = await queryGrok(
      `あなたは IT 市場調査のスペシャリストです。技術トレンドと単価相場の情報を提供してください。`,
      `以下の技術スタックについて、日本市場での開発単価相場、トレンド情報を教えてください。
JSON形式で回答してください:
\`\`\`json
{
  "market_hourly_rate": 時給の市場平均(円),
  "market_rate_range": { "min": 最低時給, "max": 最高時給 },
  "market_estimated_hours_multiplier": 一般的な工数の倍率(実力者比),
  "trends": ["トレンド1", "トレンド2"],
  "risks": ["リスク1", "リスク2"],
  "summary": "市場概況のサマリー"
}
\`\`\`

技術スタック: ${techStack}`
    )

    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1])
    }
    return JSON.parse(response)
  } catch (error) {
    return {
      market_hourly_rate: 8000,
      market_rate_range: { min: 5000, max: 15000 },
      market_estimated_hours_multiplier: 2.0,
      trends: [],
      risks: [],
      summary: '市場データの取得に失敗しました。デフォルト値を使用しています。',
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { project_id, your_hourly_rate, multiplier = 1.5 } = body

    if (!project_id || !your_hourly_rate) {
      return NextResponse.json(
        { success: false, error: 'project_id と your_hourly_rate は必須です' },
        { status: 400 }
      )
    }

    const supabase = await createServiceRoleClient()

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', project_id)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: '案件が見つかりません' },
        { status: 404 }
      )
    }

    if (!project.spec_markdown) {
      return NextResponse.json(
        { success: false, error: '仕様書が生成されていません' },
        { status: 400 }
      )
    }

    const estimateMode = getEstimateMode(project.type as ProjectType)
    const hours = await estimateHours(
      project.spec_markdown,
      project.type as ProjectType
    )

    let marketData = null
    let comparisonReport = null
    let totalMarketCost = null

    if (estimateMode === 'market_comparison' || estimateMode === 'hybrid') {
      marketData = await getMarketData(project.spec_markdown.slice(0, 2000))

      const marketHours = hours.total * (marketData.market_estimated_hours_multiplier ?? 2.0)
      totalMarketCost = marketData.market_hourly_rate * marketHours

      const yourTotalCost = your_hourly_rate * hours.total

      comparisonReport = `# 市場比較レポート

## あなたの見積り
- 時給: ¥${your_hourly_rate.toLocaleString()}
- 推定工数: ${hours.total}時間
- **合計: ¥${yourTotalCost.toLocaleString()}**

## 市場平均の見積り
- 市場平均時給: ¥${marketData.market_hourly_rate.toLocaleString()}
- 市場推定工数: ${marketHours}時間（一般的なエンジニアの場合）
- **合計: ¥${totalMarketCost.toLocaleString()}**

## コスト比較
- **差額: ¥${(totalMarketCost - yourTotalCost).toLocaleString()}**
- **削減率: ${Math.round(((totalMarketCost - yourTotalCost) / totalMarketCost) * 100)}%**

> 高い時給単価でも、実績に基づく圧倒的な開発速度により、
> トータルコストでは市場平均を大幅に下回ります。

## 市場概況
${marketData.summary}
`
    }

    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .insert({
        project_id,
        estimate_mode: estimateMode,
        your_hourly_rate,
        your_estimated_hours: hours.total,
        hours_investigation: hours.investigation,
        hours_implementation: hours.implementation,
        hours_testing: hours.testing,
        hours_buffer: hours.buffer,
        hours_breakdown_report: hours.breakdown,
        market_hourly_rate: marketData?.market_hourly_rate ?? null,
        market_estimated_hours: marketData
          ? hours.total * (marketData.market_estimated_hours_multiplier ?? 2.0)
          : null,
        multiplier,
        total_market_cost: totalMarketCost,
        comparison_report: comparisonReport,
        grok_market_data: marketData,
        similar_projects: null,
      })
      .select()
      .single()

    if (estimateError) {
      return NextResponse.json(
        { success: false, error: '見積りの保存に失敗しました' },
        { status: 500 }
      )
    }

    await supabase
      .from('projects')
      .update({ status: 'estimating' })
      .eq('id', project_id)

    return NextResponse.json({
      success: true,
      data: estimate,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'サーバーエラー'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
