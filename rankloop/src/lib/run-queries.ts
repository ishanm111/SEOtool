import 'server-only'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { isAnswer, mentionsClient } from '../analysis/parse'
import { hydrateClient, type Client } from './client'
import { isLive, parseStepKeys } from './pipeline'
import { reconcileStaleRuns } from './runner'

/**
 * Reads for the run console and the client list.
 *
 * Every read reconciles first: a row left saying "running" by a server that has
 * since restarted is corrected before it can be rendered, rather than being
 * shown as live work that will never finish.
 */

export type RunRow = {
  id: number
  clientId: number
  clientName: string
  clientDomain: string
  label: string
  status: string
  stepKeys: string[]
  error: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date | null
  stepsDone: number
  stepsTotal: number
  currentStep: string | null
}

function decorate(
  run: typeof schema.pipelineRuns.$inferSelect,
  clientsById: Map<number, { name: string; domain: string }>,
  steps: (typeof schema.pipelineSteps.$inferSelect)[],
): RunRow {
  const mine = steps.filter((s) => s.runId === run.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const client = clientsById.get(run.clientId)
  return {
    id: run.id,
    clientId: run.clientId,
    clientName: client?.name ?? `client #${run.clientId}`,
    clientDomain: client?.domain ?? '',
    label: run.label,
    status: run.status,
    stepKeys: parseStepKeys(run.stepKeys),
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    stepsDone: mine.filter((s) => s.status === 'done').length,
    stepsTotal: mine.length,
    currentStep:
      mine.find((s) => s.status === 'running' || s.status === 'waiting')?.stepKey ?? null,
  }
}

function clientIndex() {
  const rows = db.select().from(schema.clients).all()
  return new Map(rows.map((c) => [c.id, { name: c.name, domain: c.domain }]))
}

export function listRuns(clientId?: number, limit = 40): RunRow[] {
  reconcileStaleRuns()
  const base = db.select().from(schema.pipelineRuns).orderBy(desc(schema.pipelineRuns.id)).all()
  const runs = (clientId ? base.filter((r) => r.clientId === clientId) : base).slice(0, limit)
  if (runs.length === 0) return []
  const steps = db
    .select()
    .from(schema.pipelineSteps)
    .where(inArray(schema.pipelineSteps.runId, runs.map((r) => r.id)))
    .all()
  const clients = clientIndex()
  return runs.map((r) => decorate(r, clients, steps))
}

export type RunDetail = RunRow & {
  steps: {
    id: number
    stepKey: string
    status: string
    log: string
    exitCode: number | null
    startedAt: Date | null
    finishedAt: Date | null
  }[]
}

export function getRunDetail(id: number): RunDetail | null {
  reconcileStaleRuns()
  const run = db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, id)).all()[0]
  if (!run) return null
  const steps = db
    .select()
    .from(schema.pipelineSteps)
    .where(eq(schema.pipelineSteps.runId, id))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)
  return {
    ...decorate(run, clientIndex(), steps),
    steps: steps.map((s) => ({
      id: s.id,
      stepKey: s.stepKey,
      status: s.status,
      log: s.log,
      exitCode: s.exitCode,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    })),
  }
}

/**
 * One line per client for the client list: enough to decide who needs a run
 * next without opening any of them.
 */
export type ClientCard = {
  client: Client
  locations: string[]
  pageCount: number
  promptCount: number
  answerCount: number
  namedCount: number
  criticalFindings: number
  findingCount: number
  recommendationCount: number
  appliedFixes: number
  competitorCount: number
  /** Runs ever started for this client — shown before deleting them. */
  runCount: number
  hasCredentials: boolean
  lastRun: RunRow | null
  activeRun: RunRow | null
}

export function listClientCards(): ClientCard[] {
  reconcileStaleRuns()
  const clientRows = db.select().from(schema.clients).all().filter((c) => c.isActive)
  if (clientRows.length === 0) return []

  const ids = clientRows.map((c) => c.id)
  const locations = db.select().from(schema.locations).where(inArray(schema.locations.clientId, ids)).all()
  const pages = db.select().from(schema.pages).where(inArray(schema.pages.clientId, ids)).all()
  const prompts = db.select().from(schema.prompts).where(inArray(schema.prompts.clientId, ids)).all()
  const findings = db.select().from(schema.findings).where(inArray(schema.findings.clientId, ids)).all()
  const recs = db
    .select()
    .from(schema.recommendations)
    .where(inArray(schema.recommendations.clientId, ids))
    .all()
  const competitors = db
    .select()
    .from(schema.competitors)
    .where(inArray(schema.competitors.clientId, ids))
    .all()
  const creds = db
    .select()
    .from(schema.siteCredentials)
    .where(inArray(schema.siteCredentials.clientId, ids))
    .all()
  const applied = db
    .select()
    .from(schema.fixApplications)
    .where(inArray(schema.fixApplications.clientId, ids))
    .all()
    .filter((f) => f.status === 'applied')

  const promptIds = prompts.map((p) => p.id)
  const runRows = promptIds.length
    ? db.select().from(schema.runs).where(inArray(schema.runs.promptId, promptIds)).all()
    : []
  const promptClient = new Map(prompts.map((p) => [p.id, p.clientId]))

  const allRuns = listRuns(undefined, 500)

  return clientRows.map((row) => {
    const client = hydrateClient(row)
    const answers = runRows.filter((r) => promptClient.get(r.promptId) === client.id && isAnswer(r))
    const clientRuns = allRuns.filter((r) => r.clientId === client.id)
    return {
      client,
      locations: locations.filter((l) => l.clientId === client.id && l.isActive).map((l) => l.name),
      pageCount: pages.filter((p) => p.clientId === client.id).length,
      promptCount: prompts.filter((p) => p.clientId === client.id).length,
      answerCount: answers.length,
      namedCount: answers.filter((r) => mentionsClient(r.answerText, client)).length,
      criticalFindings: findings.filter((f) => f.clientId === client.id && f.severity === 'critical')
        .length,
      findingCount: findings.filter((f) => f.clientId === client.id).length,
      recommendationCount: recs.filter((r) => r.clientId === client.id).length,
      appliedFixes: applied.filter((f) => f.clientId === client.id).length,
      competitorCount: competitors.filter((c) => c.clientId === client.id).length,
      runCount: clientRuns.length,
      hasCredentials: creds.some((c) => c.clientId === client.id && c.status !== 'failed'),
      lastRun: clientRuns[0] ?? null,
      activeRun: clientRuns.find((r) => isLive(r.status)) ?? null,
    }
  })
}

export function getClientCard(clientId: number): ClientCard | null {
  return listClientCards().find((c) => c.client.id === clientId) ?? null
}
