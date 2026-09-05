import 'server-only'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { parseStepKeys, type StepKey } from './pipeline'
import { reconcileStaleRuns } from './runner'

/**
 * Every run a client has had, with what it measured and how that compares to
 * the run before it.
 *
 * The comparison is the point. A single number says nothing — "named in 4 of
 * 128 answers" is only good news next to the 0 it was last month, and only bad
 * news next to a 30. So each row carries the difference from the previous run
 * rather than leaving it to be worked out by eye.
 */

export type EngineResult = { engine: string; answers: number; named: number; failed: number }
export type MarketResult = { label: string; answers: number; named: number }
export type CompetitorResult = { name: string; count: number }

export type HistoryEntry = {
  runId: number
  clientId: number
  clientName: string
  label: string
  status: string
  stepKeys: StepKey[]
  error: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date | null
  stepsDone: number
  stepsTotal: number
  /** Null when a run ended before anything could be recorded. */
  result: {
    capturedAt: Date | null
    answersTotal: number
    answersNamed: number
    namedPct: number
    promptsTotal: number
    pagesRead: number
    wrongGeoPages: number
    findingsTotal: number
    findingsCritical: number
    recommendationsTotal: number
    recommendationsBlocked: number
    competitorsTotal: number
    fixesPublished: number
    gbpRating: number | null
    gbpReviewCount: number | null
    hasReport: boolean
    byEngine: EngineResult[]
    byMarket: MarketResult[]
    topCompetitors: CompetitorResult[]
  } | null
  /** Movement against the previous run that recorded a result. Null for the first. */
  change: {
    namedPct: number
    findingsCritical: number
    recommendationsTotal: number
    fixesPublished: number
    pagesRead: number
  } | null
}

const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function listHistory(clientId: number): HistoryEntry[] {
  reconcileStaleRuns()

  const runs = db
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.clientId, clientId))
    .orderBy(desc(schema.pipelineRuns.id))
    .all()
  if (runs.length === 0) return []

  const runIds = runs.map((r) => r.id)
  const steps = db
    .select()
    .from(schema.pipelineSteps)
    .where(inArray(schema.pipelineSteps.runId, runIds))
    .all()
  const results = db
    .select()
    .from(schema.runResults)
    .where(inArray(schema.runResults.runId, runIds))
    .all()
  const resultByRun = new Map(results.map((r) => [r.runId, r]))
  const clientName =
    db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).all()[0]?.name ?? ''

  const entries: HistoryEntry[] = runs.map((run) => {
    const mine = steps.filter((s) => s.runId === run.id)
    const r = resultByRun.get(run.id)
    return {
      runId: run.id,
      clientId: run.clientId,
      clientName,
      label: run.label,
      status: run.status,
      stepKeys: parseStepKeys(run.stepKeys),
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
      stepsDone: mine.filter((s) => s.status === 'done').length,
      stepsTotal: mine.length,
      result: r
        ? {
            capturedAt: r.capturedAt,
            answersTotal: r.answersTotal,
            answersNamed: r.answersNamed,
            namedPct: r.namedPct,
            promptsTotal: r.promptsTotal,
            pagesRead: r.pagesRead,
            wrongGeoPages: r.wrongGeoPages,
            findingsTotal: r.findingsTotal,
            findingsCritical: r.findingsCritical,
            recommendationsTotal: r.recommendationsTotal,
            recommendationsBlocked: r.recommendationsBlocked,
            competitorsTotal: r.competitorsTotal,
            fixesPublished: r.fixesPublished,
            gbpRating: r.gbpRating,
            gbpReviewCount: r.gbpReviewCount,
            hasReport: Boolean(r.reportPath),
            byEngine: parse<EngineResult[]>(r.byEngine, []),
            byMarket: parse<MarketResult[]>(r.byMarket, []),
            topCompetitors: parse<CompetitorResult[]>(r.topCompetitors, []),
          }
        : null,
      change: null,
    }
  })

  /**
   * Compared against the previous run that actually recorded something, not
   * simply the previous row. A run that fell over before its first step would
   * otherwise show every number as a drop to zero.
   */
  for (let i = 0; i < entries.length; i++) {
    const current = entries[i].result
    if (!current) continue
    const earlier = entries.slice(i + 1).find((e) => e.result)?.result
    if (!earlier) continue
    entries[i].change = {
      namedPct: Math.round((current.namedPct - earlier.namedPct) * 10) / 10,
      findingsCritical: current.findingsCritical - earlier.findingsCritical,
      recommendationsTotal: current.recommendationsTotal - earlier.recommendationsTotal,
      fixesPublished: current.fixesPublished - earlier.fixesPublished,
      pagesRead: current.pagesRead - earlier.pagesRead,
    }
  }

  return entries
}

/** The published-change log: every edit this tool wrote to the live site. */
export function listChangeLog(clientId: number) {
  const rows = db
    .select()
    .from(schema.fixApplications)
    .where(eq(schema.fixApplications.clientId, clientId))
    .orderBy(desc(schema.fixApplications.id))
    .all()
    .slice(0, 50)

  return rows.map((r) => ({
    id: r.id,
    appliedAt: r.appliedAt,
    targetUrl: r.targetUrl,
    field: r.field,
    status: r.status,
    error: r.error,
    previousValue: r.previousValue,
    appliedValue: r.appliedValue,
  }))
}
