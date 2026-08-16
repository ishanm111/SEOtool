import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient } from '../lib/resolve-client'
import {
  candidateSiteUrls,
  defaultDateRange,
  fetchQueries,
  listSites,
} from '../engines/search-console'
import { loadEnv } from '../lib/env'
import { arg } from '../lib/args'

loadEnv()

/**
 * Pulls the real search queries for a client's site.
 *
 *   npx tsx src/scripts/fetch-search-console.ts --client=1
 *   npx tsx src/scripts/fetch-search-console.ts --client=1 --days=180
 */

async function main() {
  const db = openDb()
  const client = resolveClient(db)

  const available = await listSites()
  if (available.length === 0) {
    console.log('This Google account has no Search Console properties.')
    console.log('Add and verify the site at search.google.com/search-console first.')
    return
  }

  // Match the client's domain against what the account can actually read,
  // rather than assuming which property form the owner set up.
  const owned = new Set(available.map((s) => s.siteUrl))
  const siteUrl =
    arg('site') ?? candidateSiteUrls(client.domain, client.homepageUrl).find((c) => owned.has(c))

  if (!siteUrl) {
    console.log(`No Search Console property matches ${client.domain}.`)
    console.log('\nProperties this account can read:')
    for (const s of available) console.log(`  ${s.siteUrl}  (${s.permissionLevel})`)
    console.log('\nPick one explicitly with --site=<exact value above>')
    return
  }

  const { startDate, endDate } = defaultDateRange(Number(arg('days') ?? 90))
  console.log(`fetching ${siteUrl}`)
  console.log(`  ${startDate} to ${endDate}\n`)

  const rows = await fetchQueries(siteUrl, { startDate, endDate, limit: 1000 })
  if (rows.length === 0) {
    console.log('No query data returned. Either the property is new, or the site gets no impressions yet.')
    return
  }

  db.delete(schema.searchQueries).where(eq(schema.searchQueries.clientId, client.id)).run()
  db.insert(schema.searchQueries)
    .values(
      rows.map((r) => ({
        clientId: client.id,
        query: r.query,
        page: r.page,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
        startDate,
        endDate,
      })),
    )
    .run()

  const totalClicks = rows.reduce((a, r) => a + r.clicks, 0)
  const totalImpressions = rows.reduce((a, r) => a + r.impressions, 0)

  console.log(`stored ${rows.length} queries`)
  console.log(`  ${totalImpressions.toLocaleString()} impressions, ${totalClicks.toLocaleString()} clicks\n`)

  console.log('=== TOP QUERIES BY IMPRESSIONS ===')
  for (const r of [...rows].sort((a, b) => b.impressions - a.impressions).slice(0, 12)) {
    console.log(
      `  ${String(r.impressions).padStart(6)} impr  ${String(r.clicks).padStart(4)} clicks  ` +
        `pos ${r.position.toFixed(1).padStart(5)}  ${r.query}`,
    )
  }

  /**
   * The most actionable slice: terms the site is already shown for but barely
   * clicked. These are pages one rewrite away from traffic, and no keyword-volume
   * estimate can tell you which they are.
   */
  const nearMisses = rows
    .filter((r) => r.impressions >= 20 && r.position > 5 && r.position <= 20 && r.clicks <= 1)
    .sort((a, b) => b.impressions - a.impressions)

  if (nearMisses.length > 0) {
    console.log('\n=== ALREADY SHOWN, BARELY CLICKED ===')
    console.log('(ranked 5-20 with real impressions — the cheapest wins available)')
    for (const r of nearMisses.slice(0, 10)) {
      console.log(`  ${String(r.impressions).padStart(6)} impr  pos ${r.position.toFixed(1).padStart(5)}  ${r.query}`)
    }
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
