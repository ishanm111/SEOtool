import { eq, inArray } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { isNationalChain, matchNameToDomain, profileCompetitor } from '../analysis/competitors'
import { countStats, countSuperlatives, wordCount } from '../ingest/score'
import { NOT_A_DIRECT_COMPETITOR } from '../config'
import { arg } from '../lib/args'
import { waitIfPaused } from '../lib/pause-gate'

/**
 * Crawls every domain the AI engines cited for this client, plus any resolved by
 * hand with --add, and measures them on the same scale as the client's own site.
 *
 * Businesses AI names in prose but never links cannot be found automatically —
 * pass those in:
 *   npx tsx src/scripts/mine-competitors.ts --add=example.com,another.com
 */

function clientProfile(db: ReturnType<typeof openDb>, clientId: number) {
  const pages = db.select().from(schema.pages).where(eq(schema.pages.clientId, clientId)).all()
  const pageIds = pages.map((p) => p.id)
  const paragraphs =
    pageIds.length > 0
      ? db.select().from(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).all()
      : []

  const allText = pages.map((p) => p.text).join(' ')
  const words = wordCount(allText)
  const substantial = paragraphs.filter((p) => p.wordCount >= 40)
  const schemaTypes = new Set<string>()
  for (const p of pages) (JSON.parse(p.schemaTypes || '[]') as string[]).forEach((t) => schemaTypes.add(t))

  return {
    pageCount: pages.length,
    hasLocalBusiness: [...schemaTypes].some((t) => /LocalBusiness|Service$/i.test(t)),
    statsPerThousand: words ? Math.round((countStats(allText) / words) * 1000 * 10) / 10 : 0,
    superlativeCount: countSuperlatives(allText),
    avgReadability: substantial.length
      ? Math.round((substantial.reduce((a, p) => a + p.readability, 0) / substantial.length) * 10) / 10
      : 0,
  }
}

async function main() {
  const db = openDb()
  const client = resolveClient(db)
  const locationNames = clientLocations(db, client.id).map((l) => l.name)

  const prompts = db.select().from(schema.prompts).where(eq(schema.prompts.clientId, client.id)).all()
  const promptIds = prompts.map((p) => p.id)
  const runs =
    promptIds.length > 0
      ? db.select().from(schema.runs).where(inArray(schema.runs.promptId, promptIds)).all()
      : []
  const runIds = runs.map((r) => r.id)

  const citations =
    runIds.length > 0
      ? db.select().from(schema.citations).where(inArray(schema.citations.runId, runIds)).all()
      : []
  const mentions =
    runIds.length > 0
      ? db.select().from(schema.mentions).where(inArray(schema.mentions.runId, runIds)).all()
      : []

  const byDomain = new Map<string, { citationCount: number }>()
  for (const c of citations) {
    if (c.isClientDomain || NOT_A_DIRECT_COMPETITOR.test(c.domain)) continue
    byDomain.set(c.domain, { citationCount: (byDomain.get(c.domain)?.citationCount ?? 0) + 1 })
  }

  /**
   * Hand-added competitors, optionally with the name AI uses for them:
   *   --add=example.com,cwrepair.com=Clearwater Appliance Repair
   *
   * The name matters when a domain is an acronym or abbreviation. "cwrepair.com"
   * cannot be matched to "Clearwater Appliance Repair" by any string rule, so
   * without an explicit mapping the business stays listed as having no site even
   * after its site has been crawled.
   */
  const manualNames = new Map<string, string>()
  const manual = (arg('add') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [domain, name] = entry.split('=')
      if (name) manualNames.set(domain.trim(), name.trim())
      return domain.trim()
    })
  for (const d of manual) if (!byDomain.has(d)) byDomain.set(d, { citationCount: 0 })

  const nameCounts = new Map<string, number>()
  for (const m of mentions) {
    if (!m.isClient) nameCounts.set(m.businessName, (nameCounts.get(m.businessName) ?? 0) + 1)
  }

  const targets = [...byDomain.entries()].sort((a, b) => b[1].citationCount - a[1].citationCount)
  if (targets.length === 0) {
    console.log('no competitor domains found — run measure.ts first, or pass --add=domain.com')
    return
  }
  console.log(
    `profiling ${targets.length} domains for ${client.name} ` +
      `(${targets.length - manual.length} cited by AI, ${manual.length} added by hand)\n`,
  )

  db.delete(schema.competitors).where(eq(schema.competitors.clientId, client.id)).run()

  /** The console's run id, absent when this was started by hand. */
  const pipelineRunId = Number(arg('run')) || null

  for (const [domain, { citationCount }] of targets) {
    // Held between competitors, never in the middle of crawling one.
    await waitIfPaused(pipelineRunId)

    process.stdout.write(`  ${domain.padEnd(34)} `)
    const p = await profileCompetitor(domain, locationNames)

    /**
     * The name the engines wrote for this domain, so citations and mentions
     * describe one business rather than two half-counted ones. A name typed in
     * by hand with --add always wins: somebody looked.
     */
    let matchedName = manualNames.get(domain) ?? ''
    let mentionCount = matchedName ? (nameCounts.get(matchedName) ?? 0) : 0

    if (!matchedName) {
      const hit = matchNameToDomain(domain, nameCounts)
      if (hit) {
        matchedName = hit.name
        mentionCount = hit.mentions
      }
    }

    const national = isNationalChain(p)

    db.insert(schema.competitors)
      .values({
        clientId: client.id,
        domain,
        name: matchedName,
        citationCount,
        mentionCount,
        pageCount: p.pageCount,
        cityPageCount: p.cityPageCount,
        cityPages: JSON.stringify(p.cityPages),
        schemaTypes: JSON.stringify(p.schemaTypes),
        hasLocalBusiness: p.hasLocalBusiness,
        hasFaqSchema: p.hasFaqSchema,
        faqBlockCount: p.faqBlockCount,
        avgReadability: p.avgReadability,
        statsPerThousand: p.statsPerThousand,
        superlativeCount: p.superlativeCount,
        sampleWordCount: p.sampleWordCount,
        phones: JSON.stringify(p.phones),
        discoveredVia: p.discoveredVia,
        isNational: national,
        ok: p.ok,
        error: p.error ?? null,
      })
      .run()

    const via = p.discoveredVia === 'homepage-links' ? ' (no sitemap — homepage links only)' : ''
    const tag = national ? ' [national chain]' : ''
    console.log(
      p.ok
        ? `${p.pageCount} pages, ${p.cityPageCount} location, ${p.faqBlockCount} FAQs, schema:${p.hasLocalBusiness ? 'Y' : 'N'}${via}${tag}`
        : `FAILED — ${p.error}`,
    )
  }

  // ── The comparison.
  const me = clientProfile(db, client.id)
  const all = db.select().from(schema.competitors).where(eq(schema.competitors.clientId, client.id)).all().filter((c) => c.ok)
  const locals = all.filter((c) => !c.isNational && c.pageCount > 0)
  const nationals = all.filter((c) => c.isNational)

  const avg = (f: (c: (typeof all)[number]) => number) =>
    locals.length ? Math.round((locals.reduce((a, c) => a + f(c), 0) / locals.length) * 10) / 10 : 0

  console.log(`\n=== THE GAP (vs ${locals.length} local rivals) ===`)
  const rows: Array<[string, string | number, string | number]> = [
    ['Total pages', me.pageCount, avg((c) => c.pageCount)],
    ['Location pages', 0, avg((c) => c.cityPageCount)],
    ['FAQ blocks', 0, avg((c) => c.faqBlockCount)],
    ['Business schema', me.hasLocalBusiness ? 'yes' : 'NO', `${locals.filter((c) => c.hasLocalBusiness).length}/${locals.length}`],
    ['Stats per 1,000 words', me.statsPerThousand, avg((c) => c.statsPerThousand)],
    ['Reading ease', me.avgReadability, avg((c) => c.avgReadability)],
    ['Superlatives', me.superlativeCount, avg((c) => c.superlativeCount)],
  ]
  console.log(`${'metric'.padEnd(24)} ${'client'.padStart(10)}   ${'local rivals'.padStart(16)}`)
  for (const [label, mine, theirs] of rows) {
    console.log(`${label.padEnd(24)} ${String(mine).padStart(10)}   ${String(theirs).padStart(16)}`)
  }

  if (nationals.length > 0) {
    console.log(
      `\n(excluded as national chains: ${nationals.map((n) => `${n.domain} — ${n.pageCount.toLocaleString()} pages`).join(', ')})`,
    )
  }

  const leaders = locals.filter((c) => c.cityPageCount > 0).sort((a, b) => b.cityPageCount - a.cityPageCount)
  if (leaders.length > 0) {
    console.log('\n=== LOCATION PAGES ===')
    for (const c of leaders) {
      const pct = c.pageCount ? Math.round((c.cityPageCount / c.pageCount) * 100) : 0
      console.log(`  ${c.domain.padEnd(34)} ${String(c.cityPageCount).padStart(3)} of ${String(c.pageCount).padEnd(5)} (${pct}%)`)
    }
    console.log(`  ${client.domain.padEnd(34)}   0 of ${String(me.pageCount).padEnd(5)} (0%)  <-- the client`)
  }

  const unresolved = [...nameCounts.entries()]
    .filter(([, n]) => n >= 2)
    .filter(([name]) => !all.some((r) => r.name === name))
    .sort((a, b) => b[1] - a[1])
  if (unresolved.length > 0) {
    console.log('\n=== NAMED BY AI, NO SITE FOUND ===')
    for (const [name, n] of unresolved.slice(0, 8)) console.log(`  ${String(n).padStart(2)}x  ${name}`)
    console.log('\n  Add any you can find with --add=domain.com')
    console.log('  A business with no website that still outranks the client is itself a finding:')
    console.log('  its profile and reviews are doing all the work.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
