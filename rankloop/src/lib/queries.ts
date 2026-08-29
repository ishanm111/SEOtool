import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { isAnswer, mentionsClient } from '../analysis/parse'
import { hydrateClient, type Client } from './client'

/**
 * All dashboard reads. Every one is scoped to a single client — nothing here may
 * return rows belonging to a different client, or two clients' numbers would mix
 * silently, which is the worst kind of bug this tool could have.
 */

export function listClients() {
  return db.select().from(schema.clients).all().filter((c) => c.isActive)
}

/** The client currently being viewed. Defaults to the first one added. */
export function getClient(clientId?: number): Client | null {
  const rows = listClients()
  if (rows.length === 0) return null
  const row = clientId ? rows.find((r) => r.id === clientId) : rows[0]
  return row ? hydrateClient(row) : null
}

const pagesFor = (clientId: number) =>
  db.select().from(schema.pages).where(eq(schema.pages.clientId, clientId)).all()

const promptsFor = (clientId: number) =>
  db.select().from(schema.prompts).where(eq(schema.prompts.clientId, clientId)).all()

function runsFor(clientId: number) {
  const ids = promptsFor(clientId).map((p) => p.id)
  return ids.length ? db.select().from(schema.runs).where(inArray(schema.runs.promptId, ids)).all() : []
}

export function getOverview(client: Client) {
  const pages = pagesFor(client.id)
  const pageIds = pages.map((p) => p.id)
  const paragraphs = pageIds.length
    ? db.select().from(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).all()
    : []
  const prompts = promptsFor(client.id)
  const runs = runsFor(client.id)
  const runIds = runs.map((r) => r.id)
  const findings = db.select().from(schema.findings).where(eq(schema.findings.clientId, client.id)).all()

  const okRuns = runs.filter(isAnswer)
  const named = okRuns.filter((r) => mentionsClient(r.answerText, client)).length

  const byEngine = new Map<string, { engine: string; ok: number; failed: number; named: number }>()
  for (const r of runs) {
    const e = byEngine.get(r.engine) ?? { engine: r.engine, ok: 0, failed: 0, named: 0 }
    if (r.ok) {
      e.ok++
      if (mentionsClient(r.answerText, client)) e.named++
    } else e.failed++
    byEngine.set(r.engine, e)
  }

  const mentions = runIds.length
    ? db.select().from(schema.mentions).where(inArray(schema.mentions.runId, runIds)).all()
    : []
  const competitors = new Map<string, number>()
  for (const m of mentions) {
    if (!m.isClient) competitors.set(m.businessName, (competitors.get(m.businessName) ?? 0) + 1)
  }

  const citations = runIds.length
    ? db.select().from(schema.citations).where(inArray(schema.citations.runId, runIds)).all()
    : []
  const domains = new Map<string, number>()
  for (const c of citations) domains.set(c.domain, (domains.get(c.domain) ?? 0) + 1)

  return {
    named,
    totalAnswers: okRuns.length,
    pct: okRuns.length ? Math.round((named / okRuns.length) * 100) : 0,
    engines: [...byEngine.values()],
    competitors: [...competitors].sort((a, b) => b[1] - a[1]).slice(0, 10),
    citedDomains: [...domains].sort((a, b) => b[1] - a[1]).slice(0, 10),
    pageCount: pages.length,
    paragraphCount: paragraphs.length,
    promptCount: prompts.filter((p) => p.isActive).length,
    wrongGeoPages: pages.filter((p) => p.wrongGeoHits > 0).length,
    wrongGeoHits: pages.reduce((a, p) => a + p.wrongGeoHits, 0),
    locationCount: db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.clientId, client.id))
      .all()
      .filter((l) => l.isActive).length,
    criticalCount: findings.filter((f) => f.severity === 'critical').length,
    findingCount: findings.length,
  }
}

export function getPromptGrid(client: Client) {
  const prompts = promptsFor(client.id)
  const locations = db.select().from(schema.locations).where(eq(schema.locations.clientId, client.id)).all()
  const runs = runsFor(client.id)
  const locationById = new Map(locations.map((l) => [l.id, l.name]))
  const engines = [...new Set(runs.map((r) => r.engine))].sort()

  return {
    engines,
    rows: prompts.map((p) => ({
      ...p,
      locationName: p.locationId ? (locationById.get(p.locationId) ?? '') : '',
      runs: Object.fromEntries(
        engines.map((e) => {
          const matches = runs.filter((r) => r.promptId === p.id && r.engine === e)
          const latest = matches[matches.length - 1]
          return [
            e,
            latest
              ? {
                  id: latest.id,
                  ok: latest.ok,
                  named: latest.ok && mentionsClient(latest.answerText, client),
                  error: latest.error,
                }
              : null,
          ]
        }),
      ),
    })),
  }
}

export function getRun(id: number) {
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, id)).all()[0]
  if (!run) return null
  const prompt = db.select().from(schema.prompts).where(eq(schema.prompts.id, run.promptId)).all()[0]
  if (!prompt) return null
  const client = getClient(prompt.clientId)
  if (!client) return null
  return {
    run,
    prompt,
    client,
    mentions: db.select().from(schema.mentions).where(eq(schema.mentions.runId, id)).all(),
    citations: db.select().from(schema.citations).where(eq(schema.citations.runId, id)).all(),
  }
}

export function getFindings(client: Client) {
  const findings = db.select().from(schema.findings).where(eq(schema.findings.clientId, client.id)).all()
  const pages = pagesFor(client.id)
  const pageIds = pages.map((p) => p.id)
  const paragraphs = pageIds.length
    ? db.select().from(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).all()
    : []
  const pageById = new Map(pages.map((p) => [p.id, p]))
  const paraById = new Map(paragraphs.map((p) => [p.id, p]))

  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return findings
    .map((f) => {
      const para = f.targetType === 'paragraph' && f.targetId ? paraById.get(f.targetId) : undefined
      return { ...f, pageSlug: para ? pageById.get(para.pageId)?.slug : undefined }
    })
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
}

/**
 * The deliverable: every proposed change, ranked.
 *
 * Reads the `recommendations` table, which the recommend script writes. The old
 * `generated_pages` table is no longer produced by anything — new pages are now
 * recommendations of kind `new_page`, so they carry a reason and a priority
 * alongside the content.
 */
export function getRecommendations(client: Client, kind?: string) {
  const pages = pagesFor(client.id)
  const pageById = new Map(pages.map((p) => [p.id, p]))

  const rows = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.clientId, client.id))
    .all()
    .sort((a, b) => b.priority - a.priority)

  const byKind = new Map<string, number>()
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1)

  const filtered = kind ? rows.filter((r) => r.kind === kind) : rows
  return {
    rows: filtered.map((r) => ({
      ...r,
      pageSlug: r.pageId ? pageById.get(r.pageId)?.slug : undefined,
    })),
    total: rows.length,
    byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]),
    placeholders: rows.reduce((n, r) => n + r.placeholderCount, 0),
    needingInput: rows.filter((r) => r.placeholderCount > 0).length,
  }
}

export function getSearchQueries(client: Client) {
  const rows = db
    .select()
    .from(schema.searchQueries)
    .where(eq(schema.searchQueries.clientId, client.id))
    .all()

  return {
    rows: rows.sort((a, b) => b.impressions - a.impressions),
    totalClicks: rows.reduce((a, r) => a + r.clicks, 0),
    totalImpressions: rows.reduce((a, r) => a + r.impressions, 0),
    /** Ranked 5-20 with real impressions but almost no clicks: the cheapest wins. */
    nearMisses: rows
      .filter((r) => r.impressions >= 20 && r.position > 5 && r.position <= 20 && r.clicks <= 1)
      .sort((a, b) => b.impressions - a.impressions),
    range: rows[0] ? { start: rows[0].startDate, end: rows[0].endDate } : null,
  }
}

export function getPages(client: Client) {
  return pagesFor(client.id).sort((a, b) => b.wrongGeoHits - a.wrongGeoHits)
}

export function getCompetitors(client: Client) {
  const rows = db
    .select()
    .from(schema.competitors)
    .where(eq(schema.competitors.clientId, client.id))
    .all()
    .map((c) => ({
      ...c,
      cityPagesList: JSON.parse(c.cityPages || '[]') as string[],
      schemaList: JSON.parse(c.schemaTypes || '[]') as string[],
      phoneList: JSON.parse(c.phones || '[]') as string[],
    }))

  const pages = pagesFor(client.id)
  const pageIds = pages.map((p) => p.id)
  const paragraphs = pageIds.length
    ? db.select().from(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).all()
    : []
  const substantial = paragraphs.filter((p) => p.wordCount >= 40)
  const myWords = substantial.reduce((a, p) => a + p.wordCount, 0)
  const schemaTypes = new Set<string>()
  for (const p of pages) (JSON.parse(p.schemaTypes || '[]') as string[]).forEach((t) => schemaTypes.add(t))

  const clientStats = {
    domain: client.domain,
    pageCount: pages.length,
    cityPageCount: 0,
    faqBlockCount: 0,
    statsPerThousand: myWords
      ? Math.round((substantial.reduce((a, p) => a + p.statCount, 0) / myWords) * 1000 * 10) / 10
      : 0,
    avgReadability: substantial.length
      ? Math.round((substantial.reduce((a, p) => a + p.readability, 0) / substantial.length) * 10) / 10
      : 0,
    hasLocalBusiness: [...schemaTypes].some((t) => /LocalBusiness|Service$|Product/i.test(t)),
    superlativeCount: paragraphs.reduce((a, p) => a + p.superlativeCount, 0),
  }

  const locals = rows.filter((c) => c.ok && !c.isNational && c.pageCount > 0)
  const avg = (f: (c: (typeof locals)[number]) => number) =>
    locals.length ? Math.round((locals.reduce((a, c) => a + f(c), 0) / locals.length) * 10) / 10 : 0

  return {
    rows: rows.sort((a, b) => b.citationCount - a.citationCount),
    locals,
    nationals: rows.filter((c) => c.isNational),
    client: clientStats,
    localAvg: {
      pageCount: avg((c) => c.pageCount),
      cityPageCount: avg((c) => c.cityPageCount),
      faqBlockCount: avg((c) => c.faqBlockCount),
      statsPerThousand: avg((c) => c.statsPerThousand),
      avgReadability: avg((c) => c.avgReadability),
      superlativeCount: avg((c) => c.superlativeCount),
      withLocalBusiness: locals.filter((c) => c.hasLocalBusiness).length,
      total: locals.length,
    },
  }
}
