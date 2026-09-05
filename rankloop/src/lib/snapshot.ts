import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { hydrateClient } from './client'
import { isAnswer, mentionsClient } from '../analysis/parse'
import { groupByMarket, marketKeyOf } from './markets'
import { archivedReportFor, reportFileFor } from './report-file'

/**
 * Freezes what a run produced, at the moment it finished.
 *
 * The dashboard is always about now: re-read a site and the page count changes,
 * publish a fix and a finding disappears. Without a snapshot there would be no
 * way to answer the only question that matters over months — is this working —
 * because every past number would have been silently overwritten by the present
 * one.
 *
 * So this is written once per run and never recomputed.
 */
export function captureRunResult(runId: number, clientId: number) {
  const already = db
    .select({ id: schema.runResults.id })
    .from(schema.runResults)
    .where(eq(schema.runResults.runId, runId))
    .all()[0]
  if (already) return

  const row = db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).all()[0]
  if (!row) return
  const client = hydrateClient(row)

  const locations = db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.clientId, clientId))
    .all()
  const pages = db.select().from(schema.pages).where(eq(schema.pages.clientId, clientId)).all()
  const prompts = db.select().from(schema.prompts).where(eq(schema.prompts.clientId, clientId)).all()
  const findings = db.select().from(schema.findings).where(eq(schema.findings.clientId, clientId)).all()
  const recs = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.clientId, clientId))
    .all()
  const competitors = db
    .select()
    .from(schema.competitors)
    .where(eq(schema.competitors.clientId, clientId))
    .all()
  const published = db
    .select()
    .from(schema.fixApplications)
    .where(eq(schema.fixApplications.clientId, clientId))
    .all()
    .filter((f) => f.status === 'applied')

  const promptIds = prompts.map((p) => p.id)
  const runRows = promptIds.length
    ? db.select().from(schema.runs).where(inArray(schema.runs.promptId, promptIds)).all()
    : []

  // Counted the same way the dashboard counts it: an ask that produced no
  // answer is not an answer, so it belongs in neither the numerator nor the
  // denominator.
  const answers = runRows.filter(isAnswer)
  const named = answers.filter((r) => mentionsClient(r.answerText, client))

  const byEngine = new Map<string, { engine: string; answers: number; named: number; failed: number }>()
  for (const r of runRows) {
    const e = byEngine.get(r.engine) ?? { engine: r.engine, answers: 0, named: 0, failed: 0 }
    if (isAnswer(r)) {
      e.answers += 1
      if (mentionsClient(r.answerText, client)) e.named += 1
    } else {
      e.failed += 1
    }
    byEngine.set(r.engine, e)
  }

  /** Each market is its own contest, so they are never averaged together. */
  const promptMarket = new Map(
    prompts.map((p) => {
      const location = locations.find((l) => l.id === p.locationId)
      // An online store's questions carry no location, so they belong to no
      // market rather than being folded into the first one.
      return [p.id, location ? marketKeyOf(location) : '']
    }),
  )
  const byMarket = groupByMarket(locations).map((m) => {
    const inMarket = answers.filter((r) => promptMarket.get(r.promptId) === m.key)
    return {
      label: m.label,
      answers: inMarket.length,
      named: inMarket.filter((r) => mentionsClient(r.answerText, client)).length,
    }
  })

  const mentionCounts = new Map<string, number>()
  const runIds = runRows.map((r) => r.id)
  if (runIds.length > 0) {
    for (const m of db
      .select()
      .from(schema.mentions)
      .where(inArray(schema.mentions.runId, runIds))
      .all()) {
      if (m.isClient) continue
      mentionCounts.set(m.businessName, (mentionCounts.get(m.businessName) ?? 0) + 1)
    }
  }
  const topCompetitors = [...mentionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  /**
   * The report is copied rather than referenced. Generating the next one
   * overwrites the live file, and a history that silently swapped September's
   * audit for December's would be worse than one with no link at all.
   */
  const liveReport = reportFileFor(client.domain)
  let archived: string | null = null
  if (fs.existsSync(liveReport)) {
    try {
      const target = archivedReportFor(runId)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(liveReport, target)
      archived = target
    } catch {
      // A report that cannot be archived must not lose the rest of the
      // snapshot; the row is written without it.
    }
  }

  db.insert(schema.runResults)
    .values({
      runId,
      clientId,
      answersTotal: answers.length,
      answersNamed: named.length,
      namedPct: answers.length ? Math.round((named.length / answers.length) * 1000) / 10 : 0,
      promptsTotal: prompts.length,
      pagesRead: pages.length,
      wrongGeoPages: pages.filter((p) => p.wrongGeoHits > 0).length,
      findingsTotal: findings.length,
      findingsCritical: findings.filter((f) => f.severity === 'critical').length,
      recommendationsTotal: recs.length,
      recommendationsBlocked: recs.filter((r) => r.placeholderCount > 0).length,
      competitorsTotal: competitors.length,
      fixesPublished: published.length,
      gbpRating: client.gbpRating,
      gbpReviewCount: client.gbpReviewCount,
      reportPath: archived,
      byEngine: JSON.stringify([...byEngine.values()]),
      byMarket: JSON.stringify(byMarket),
      topCompetitors: JSON.stringify(topCompetitors),
    })
    .run()
}
