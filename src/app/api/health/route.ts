import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  version: string
  checks: {
    database: {
      status: 'up' | 'down'
      latency_ms: number
    }
    clerk: {
      status: 'up' | 'down'
    }
    anthropic: {
      status: 'configured' | 'missing'
    }
    xai: {
      status: 'configured' | 'missing'
    }
    linear: {
      status: 'configured' | 'missing'
    }
  }
  uptime_seconds: number
}

const moduleStartTime = Date.now()

export async function GET(): Promise<NextResponse<HealthCheck>> {
  const timestamp = new Date().toISOString()
  const uptime_seconds = Math.floor((Date.now() - moduleStartTime) / 1000)

  let dbStatus: 'up' | 'down' = 'down'
  let dbLatency = 0

  try {
    const startTime = Date.now()
    const supabase = await createServiceRoleClient()

    const { error } = await supabase
      .from('projects')
      .select('1', { count: 'exact', head: true })

    const latency = Date.now() - startTime
    dbStatus = error ? 'down' : 'up'
    dbLatency = latency
  } catch {
    dbStatus = 'down'
    dbLatency = -1
  }

  const checks: HealthCheck['checks'] = {
    database: {
      status: dbStatus,
      latency_ms: dbLatency,
    },
    clerk: {
      status: process.env.CLERK_SECRET_KEY ? 'up' : 'down',
    },
    anthropic: {
      status: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
    },
    xai: {
      status: process.env.XAI_API_KEY ? 'configured' : 'missing',
    },
    linear: {
      status: process.env.LINEAR_API_KEY ? 'configured' : 'missing',
    },
  }

  const criticalDown = checks.database.status === 'down'
  const allConfigured = [
    checks.anthropic.status === 'configured',
    checks.xai.status === 'configured',
    checks.clerk.status === 'up',
  ].every(Boolean)

  const status: 'healthy' | 'degraded' | 'unhealthy' = criticalDown
    ? 'unhealthy'
    : allConfigured
      ? 'healthy'
      : 'degraded'

  const response: HealthCheck = {
    status,
    timestamp,
    version: process.env.npm_package_version || '0.1.0',
    checks,
    uptime_seconds,
  }

  return NextResponse.json(response, {
    status: status === 'unhealthy' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-cache, no-store',
      'Content-Type': 'application/json',
    },
  })
}
