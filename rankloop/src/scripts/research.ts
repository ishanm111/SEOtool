import { and, eq, lt } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { openBrowser, pacingDelay, SHOTS_DIR, browserLabel } from '../engines/browser'
import { readBusinessProfile, researchGoogleSearch } from '../engines/google-research'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { groupByMarket } from '../lib/markets'
import { isClientName, mentionsClient } from '../analysis/parse'
import { arg, flag } from '../lib/args'
import { loadEnv } from '../lib/env'
import { waitIfPaused } from '../lib/pause-gate'
import { normaliseState } from '../onboard/us-states'
import { buildResearchQueries, DEFAULT_RESEARCH_LIMIT, type ResearchQuery } from '../research/queries'

/**
 * Researches a business on Google through a real browser: the searches its
 * customers make, what Google's AI Overview says and cites, who holds the map
 * pack and the top ten, what people ask next, and how fast rivals are gathering
 * reviews.
 *
 *   npm run research -- --client=1
 *   npm run research -- --client=1 --limit=8
 *   npm run research -- --client=1 --ask="is it worth fixing a 10 year old fridge|..."
 *   npm run research -- --client=1 --profiles=0        # searches only, no Maps listings
 *
 * A pass replaces the previous one, but only once it has captured something:
 * a run blocked on its first search leaves the last good research in place.
 */

loadEnv()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const db = openDb()
  const client = resolveClient(db)
  const locations = clientLocations(db, client.id)
  const startedAt = new Date()

  const prompts = db
    .select()
    .from(schema.prompts)
    .where(eq(schema.prompts.clientId, client.id))
    .all()

  const limit = Number(arg('limit') ?? DEFAULT_RESEARCH_LIMIT) || DEFAULT_RESEARCH_LIMIT
  const queries = buildResearchQueries({ client, locations, prompts, limit })

  /** Questions the operator wants put to Google on top of the generated set. */
  const home = groupByMarket(locations)[0]?.anchor
  const extra: ResearchQuery[] = (arg('ask') ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      kind: 'question',
      locationId: home?.id ?? null,
      searchedFrom: home?.dataforseoLocation ?? '',
    }))
  const all = [...extra, ...queries]

  if (all.length === 0) {
    throw new Error('nothing to search — the client has no offerings, no locations and no questions')
  }

  const profileLimit = Math.max(0, Number(arg('profiles') ?? 5) || 0)

  console.log(`researching ${client.name} (${client.domain}) on Google`)
  console.log(`browser: ${browserLabel()}`)
  console.log(`${all.length} searches${profileLimit > 0 ? ` + up to ${profileLimit + 1} Maps listings` : ''}`)
  console.log(`rough estimate: ${Math.round((all.length * 45 + (profileLimit + 1) * 40) / 60)} minutes at human pacing\n`)

  const pipelineRunId = Number(arg('run')) || null
  const context = await openBrowser(flag('headless'))

  let captured = 0
  let blocked = false
  const packCounts = new Map<string, { count: number; locationId: number | null }>()

  try {
    for (let i = 0; i < all.length; i++) {
      await waitIfPaused(pipelineRunId)
      const q = all[i]
      process.stdout.write(`[${i + 1}/${all.length}] ${q.kind.padEnd(8)} ${q.text.slice(0, 64)}... `)

      const shot = `research_c${client.id}_${i + 1}`
      const r = await researchGoogleSearch(context, q.text, q.searchedFrom, shot, SHOTS_DIR)

      const clientInAiOverview = r.aiOverviewText ? mentionsClient(r.aiOverviewText, client) : false
      const clientCitedInAiOverview = r.aiOverviewSources.some((s) => s.domain.includes(client.domain))
      const packIndex = r.localPack.findIndex((p) => isClientName(p.title, client))
      const organicIndex = r.organic.findIndex((o) => o.domain.includes(client.domain))

      db.insert(schema.serpSnapshots)
        .values({
          clientId: client.id,
          locationId: q.locationId,
          query: q.text,
          queryKind: q.kind,
          searchedFrom: q.searchedFrom,
          aiOverviewText: r.aiOverviewText,
          aiOverviewSources: JSON.stringify(r.aiOverviewSources),
          clientInAiOverview,
          clientCitedInAiOverview,
          localPack: JSON.stringify(r.localPack),
          clientPackPosition: packIndex >= 0 ? packIndex + 1 : null,
          organic: JSON.stringify(r.organic),
          clientOrganicPosition: organicIndex >= 0 ? organicIndex + 1 : null,
          peopleAlsoAsk: JSON.stringify(r.peopleAlsoAsk),
          relatedSearches: JSON.stringify(r.relatedSearches),
          suggestions: JSON.stringify(r.suggestions),
          adsCount: r.adsCount,
          screenshotPath: r.screenshotPath ?? null,
          ok: r.ok,
          error: r.error ?? null,
        })
        .run()

      if (!r.ok) {
        console.log(`FAILED — ${r.error}`)
        if (r.blocked) {
          blocked = true
          console.log('  ! Google is blocking this machine — stopping the searches here')
          break
        }
        continue
      }

      captured++
      for (const p of r.localPack) {
        if (isClientName(p.title, client)) continue
        const prev = packCounts.get(p.title)
        packCounts.set(p.title, { count: (prev?.count ?? 0) + 1, locationId: prev?.locationId ?? q.locationId })
      }

      const bits = [
        r.aiOverviewText ? `AIO ${r.aiOverviewSources.length} sources${clientInAiOverview ? ' (CLIENT NAMED)' : ''}` : 'no AIO',
        `pack ${r.localPack.length}${packIndex >= 0 ? ` (client #${packIndex + 1})` : ''}`,
        `organic ${organicIndex >= 0 ? `client #${organicIndex + 1}` : 'client absent'}`,
        `${r.peopleAlsoAsk.length} PAA`,
        `${r.suggestions.length} suggestions`,
        `${r.adsCount} ads`,
      ]
      console.log(bits.join(' · '))

      if (i < all.length - 1) await sleep(pacingDelay(20, 40))
    }

    /**
     * The listings behind the map pack, busiest first, plus the client's own.
     *
     * A rival that held a spot in several searches is the one the client is
     * actually up against; one that appeared once is noise.
     */
    const profiles: { name: string; isClient: boolean; locationId: number | null }[] = []
    if (profileLimit > 0 && !blocked && captured > 0 && locations.length > 0) {
      profiles.push({ name: client.name, isClient: true, locationId: home?.id ?? null })
      for (const [name, v] of [...packCounts].sort((a, b) => b[1].count - a[1].count).slice(0, profileLimit)) {
        profiles.push({ name, isClient: false, locationId: v.locationId })
      }
    }

    const locationById = new Map(locations.map((l) => [l.id, l]))
    for (const [i, p] of profiles.entries()) {
      await waitIfPaused(pipelineRunId)
      const loc = p.locationId != null ? locationById.get(p.locationId) : home
      const where = loc ? `${loc.name} ${normaliseState(loc.region || '') ?? ''}`.trim() : ''
      process.stdout.write(`[listing ${i + 1}/${profiles.length}] ${p.name}${p.isClient ? ' (client)' : ''}... `)

      const r = await readBusinessProfile(context, p.name, where, p.isClient ? client.domain : undefined)
      db.insert(schema.businessProfiles)
        .values({
          clientId: client.id,
          businessName: r.name ?? p.name,
          isClient: p.isClient,
          searchedAs: `${p.name} ${where}`.trim(),
          rating: r.rating,
          reviewCount: r.reviewCount,
          category: r.category,
          website: r.website,
          hasHours: r.hasHours,
          unclaimed: r.unclaimed,
          reviewsLast30Days: r.reviewsLast30Days,
          newestReviewDays: r.newestReviewDays,
          reviewsSampled: r.reviewsSampled,
          ok: r.ok,
          error: r.error ?? null,
        })
        .run()

      console.log(
        r.ok
          ? `${r.rating ?? '?'}★ (${r.reviewCount ?? '?'}) · ${r.reviewsLast30Days ?? '?'} reviews in 30 days${r.unclaimed ? ' · UNCLAIMED' : ''}`
          : `skipped — ${r.error}`,
      )
      if (i < profiles.length - 1) await sleep(pacingDelay(15, 30))
    }
  } finally {
    await context.close().catch(() => {})
  }

  if (captured === 0) {
    // Leave the previous research in place: a blocked pass is not a finding.
    db.delete(schema.serpSnapshots)
      .where(and(eq(schema.serpSnapshots.clientId, client.id), eq(schema.serpSnapshots.ok, false)))
      .run()
    console.log('\nNothing was captured, so the previous research (if any) was kept.')
    process.exit(1)
  }

  db.delete(schema.serpSnapshots)
    .where(and(eq(schema.serpSnapshots.clientId, client.id), lt(schema.serpSnapshots.capturedAt, startedAt)))
    .run()
  db.delete(schema.businessProfiles)
    .where(and(eq(schema.businessProfiles.clientId, client.id), lt(schema.businessProfiles.capturedAt, startedAt)))
    .run()

  const rows = db.select().from(schema.serpSnapshots).where(eq(schema.serpSnapshots.clientId, client.id)).all()
  const ok = rows.filter((r) => r.ok)
  const withAio = ok.filter((r) => r.aiOverviewText)
  console.log('\n=== GOOGLE RESEARCH ===')
  console.log(`${ok.length} of ${rows.length} searches captured${blocked ? ' (stopped early: Google blocked)' : ''}`)
  console.log(`AI Overview shown on ${withAio.length}; client named in ${withAio.filter((r) => r.clientInAiOverview).length}, cited in ${withAio.filter((r) => r.clientCitedInAiOverview).length}`)
  console.log(`client in the map pack on ${ok.filter((r) => r.clientPackPosition).length}, in the top 10 on ${ok.filter((r) => r.clientOrganicPosition).length}`)
  console.log('\nNext: npm run analyze -- --client=' + client.id + ' && npm run recommend -- --client=' + client.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
