import { LinearClient } from '@linear/sdk'
import { z } from 'zod'

const linearConfigSchema = z.object({
  apiKey: z.string().min(1, 'LINEAR_API_KEY is required'),
})

export function createLinearClient(): LinearClient {
  const config = linearConfigSchema.parse({
    apiKey: process.env.LINEAR_API_KEY,
  })
  return new LinearClient({ apiKey: config.apiKey })
}

export function getDefaultTeamId(): string {
  const teamId = process.env.LINEAR_DEFAULT_TEAM_ID
  if (!teamId) {
    throw new Error('LINEAR_DEFAULT_TEAM_ID is not configured')
  }
  return teamId
}

export async function getLinearTeams() {
  const client = createLinearClient()
  const teams = await client.teams()
  return teams.nodes.map((team) => ({
    id: team.id,
    name: team.name,
    key: team.key,
  }))
}

export async function createLinearProject(input: {
  name: string
  description?: string
  teamIds: string[]
}) {
  const client = createLinearClient()
  const project = await client.createProject({
    name: input.name,
    description: input.description,
    teamIds: input.teamIds,
  })

  const created = await project.project
  if (!created) {
    throw new Error('Failed to create Linear project')
  }

  return {
    id: created.id,
    name: created.name,
    url: created.url,
  }
}

export async function createLinearCycle(input: {
  teamId: string
  name: string
  startsAt: Date
  endsAt: Date
}) {
  const client = createLinearClient()
  const cycle = await client.createCycle({
    teamId: input.teamId,
    name: input.name,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  })

  const created = await cycle.cycle
  if (!created) {
    throw new Error('Failed to create Linear cycle')
  }

  return {
    id: created.id,
    name: created.name,
    number: created.number,
  }
}

export async function createLinearIssue(input: {
  teamId: string
  title: string
  description?: string
  priority?: number
  projectId?: string
  cycleId?: string
  estimate?: number
}) {
  const client = createLinearClient()
  const issue = await client.createIssue({
    teamId: input.teamId,
    title: input.title,
    description: input.description,
    priority: input.priority,
    projectId: input.projectId,
    cycleId: input.cycleId,
    estimate: input.estimate,
  })

  const created = await issue.issue
  if (!created) {
    throw new Error('Failed to create Linear issue')
  }

  return {
    id: created.id,
    identifier: created.identifier,
    url: created.url,
    title: created.title,
  }
}
