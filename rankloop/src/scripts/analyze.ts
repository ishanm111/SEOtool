import { eq, inArray } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { extractMentions, mentionsClient } from '../analysis/parse'
import { buildFindings, type MarketRate } from '../analysis/findings'
import { groupByMarket, marketKeyOf } from '../lib/markets'
import { JUNK_CITATION_DOMAINS } from '../config'

function main() {
  const db = openDb()
  const client = resolveClient(db)
  const locations = clientLocations(db, client.id)

  const pages = db.select().from(schema.pages).where(eq(schema.pages.clientId, client.id)).all()
  const pageIds = pages.map((p) => p.id)
  const paragraphs =
    pageIds.length > 0
      ? db.select().from(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).all()
      : []

  const prompts = db.select().from(schema.prompts).where(eq(schema.prompts.clientId, client.id)).all()
  const promptIds = prompts.map((p) => p.id)
  const runs =
    promptIds.length > 0
      ? db.select().from(schema.runs).where(inArray(schema.runs.promptId, promptIds)).all()
      : []
  const runIds = runs.map((r) => r.id)

  // Drop map-widget and engine-furniture links that are not real citations.
  if (runIds.length > 0) {
    const junk = db
      .select()
      .from(schema.citations)
      .where(inArray(schema.citations.runId, runIds))
      .all()
      .filter((c) => JUNK_CITATION_DOMAINS.test(c.domain))
    for (const c of junk) db.delete(schema.citations).where(eq(schema.citations.id, c.id)).run()
    if (junk.length > 0) console.log(`purged ${junk.length} junk citations (map widgets, engine nav)\n`)
  }

  // Re-parse every answer from scratch so a parser fix applies retroactively.
  if (runIds.length > 0) {
    db.delete(schema.mentions).where(inArray(schema.mentions.runId, runIds)).run()
  }

  let named = 0
  const okRuns = runs.filter((r) => r.ok && r.answerText.trim())
  const competitorCounts = new Map<string, number>()

  /**
   * Which market each answer belongs to.
   *
   * An answer is about the place its question named, so the chain is
   * run -> prompt -> location -> market. Answers from a question with no place
   * in it (an ecommerce set, or a generic question) belong to no market and are
   * counted only in the overall rate.
   */
  const markets = groupByMarket(locations)
  const marketKeyByLocation = new Map(locations.map((l) => [l.id, marketKeyOf(l)]))
  const promptById = new Map(prompts.map((p) => [p.id, p]))
  const tally = new Map<string, { named: number; total: number }>()
  for (const m of markets) tally.set(m.key, { named: 0, total: 0 })

  for (const run of okRuns) {
    const found = extractMentions(run.answerText, client)
    if (found.length > 0) {
      db.insert(schema.mentions).values(found.map((m) => ({ runId: run.id, ...m }))).run()
    }
    const isNamed = mentionsClient(run.answerText, client)
    if (isNamed) named++

    const locationId = promptById.get(run.promptId)?.locationId
    const key = locationId == null ? undefined : marketKeyByLocation.get(locationId)
    const row = key ? tally.get(key) : undefined
    if (row) {
      row.total++
      if (isNamed) row.named++
    }

    for (const m of found) {
      if (!m.isClient) competitorCounts.set(m.businessName, (competitorCounts.get(m.businessName) ?? 0) + 1)
    }
  }

  const marketRates: MarketRate[] = markets.map((m) => ({
    label: m.label,
    named: tally.get(m.key)?.named ?? 0,
    total: tally.get(m.key)?.total ?? 0,
    locations: m.locations.map((l) => l.name),
  }))

  if (marketRates.length > 1) {
    console.log('visibility by market:')
    for (const m of marketRates) {
      const pct = m.total > 0 ? `${Math.round((m.named / m.total) * 100)}%` : 'not measured'
      console.log(`  ${m.label.padEnd(22)} ${m.named}/${m.total}  ${pct}`)
    }
    console.log('')
  }

  /**
   * Fold Google's map pack into the competitive bar.
   *
   * The bar was built for hand entry because ratings and review counts were the
   * one thing that needed a paid API. The browser Google pass captures them for
   * free, so they are promoted here automatically.
   *
   * Hand-entered rows always win: a person who typed a number looked at it, and
   * an automated capture must never quietly overwrite that.
   */
  const manualBar = db
    .select()
    .from(schema.competitiveBar)
    .where(eq(schema.competitiveBar.clientId, client.id))
    .all()
    .filter((r) => r.source === 'manual')

  if (manualBar.length === 0) {
    const best = new Map<string, { rating: number | null; reviewCount: number }>()
    for (const run of runs.filter((r) => r.engine === 'google_aio' && r.ok && r.rawPayload)) {
      let pack: { title: string; rating: number | null; ratingCount: number | null }[] = []
      try {
        pack = JSON.parse(run.rawPayload!).localPack ?? []
      } catch {
        continue
      }
      for (const e of pack) {
        if (!e.ratingCount || !e.title) continue
        const prev = best.get(e.title)
        if (!prev || e.ratingCount > prev.reviewCount) {
          best.set(e.title, { rating: e.rating, reviewCount: e.ratingCount })
        }
      }
    }

    const ranked = [...best.entries()]
      .filter(([name]) => !client.aliases.some((a) => name.toLowerCase().includes(a)))
      .sort((a, b) => b[1].reviewCount - a[1].reviewCount)
      .slice(0, 3)

    if (ranked.length > 0) {
      db.delete(schema.competitiveBar).where(eq(schema.competitiveBar.clientId, client.id)).run()
      db.insert(schema.competitiveBar)
        .values(
          ranked.map(([businessName, v], i) => ({
            clientId: client.id,
            locationId: null,
            rank: i + 1,
            businessName,
            rating: v.rating,
            reviewCount: v.reviewCount,
            source: 'google_browser',
          })),
        )
        .run()
      console.log(`competitive bar filled from Google: ${ranked.map(([n, v]) => `${n} (${v.reviewCount})`).join(', ')}\n`)
    }
  }

  // Rebuild the fix list for this client only.
  db.delete(schema.findings).where(eq(schema.findings.clientId, client.id)).run()

  const competitors = db
    .select()
    .from(schema.competitors)
    .where(eq(schema.competitors.clientId, client.id))
    .all()
  const competitiveBar = db
    .select()
    .from(schema.competitiveBar)
    .where(eq(schema.competitiveBar.clientId, client.id))
    .all()

  const findings = buildFindings({
    client,
    locations,
    pages,
    paragraphs,
    runs,
    clientMentionRate: { named, total: okRuns.length },
    marketRates,
    competitors,
    competitiveBar,
  })

  if (findings.length > 0) {
    db.insert(schema.findings)
      .values(
        findings.map((f) => ({
          clientId: client.id,
          targetType: f.targetType,
          targetId: f.targetId ?? null,
          category: f.category,
          severity: f.severity,
          issue: f.issue,
          currentText: f.currentText ?? null,
          proposedText: f.proposedText ?? null,
          evidence: f.evidence ?? null,
        })),
      )
      .run()
  }

  // ── Report
  const pct = okRuns.length > 0 ? Math.round((named / okRuns.length) * 100) : 0
  console.log(`=== AI VISIBILITY — ${client.name} ===`)
  console.log(`named in ${named} of ${okRuns.length} answers (${pct}%)`)
  if (okRuns.length === 0) console.log('(no successful runs yet — run: npx tsx src/scripts/measure.ts)')

  const byEngine = new Map<string, { ok: number; named: number }>()
  for (const r of okRuns) {
    const e = byEngine.get(r.engine) ?? { ok: 0, named: 0 }
    e.ok++
    if (mentionsClient(r.answerText, client)) e.named++
    byEngine.set(r.engine, e)
  }
  for (const [engine, s] of byEngine) console.log(`  ${engine.padEnd(12)} ${s.named}/${s.ok}`)

  if (competitorCounts.size > 0) {
    console.log('\n=== TOP COMPETITORS IN AI ANSWERS ===')
    for (const [name, count] of [...competitorCounts].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  ${String(count).padStart(3)}x  ${name}`)
    }
  }

  console.log(`\n=== FINDINGS (${findings.length}) ===`)
  for (const f of findings.filter((x) => x.targetType !== 'paragraph')) {
    console.log(`\n[${f.severity.toUpperCase()}] ${f.category}`)
    console.log(`  ${f.issue}`)
    if (f.evidence) console.log(`  evidence: ${f.evidence}`)
  }
  const paraFindings = findings.filter((f) => f.targetType === 'paragraph').length
  if (paraFindings > 0) console.log(`\n+ ${paraFindings} paragraph-level fixes (see the dashboard)`)
}

main()
