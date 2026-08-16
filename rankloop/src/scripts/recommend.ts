import { eq, inArray } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { buildRecommendations, countPlaceholders, summarise } from '../recommend'
import { arg } from '../lib/args'

/**
 * Produces the deliverable: what to change, page by page.
 *
 *   npx tsx src/scripts/recommend.ts --client=1
 *   npx tsx src/scripts/recommend.ts --client=1 --show=new_page
 */

function main() {
  const db = openDb()
  const client = resolveClient(db)
  const locations = clientLocations(db, client.id)

  const pages = db.select().from(schema.pages).where(eq(schema.pages.clientId, client.id)).all()
  const pageIds = pages.map((p) => p.id)
  const paragraphs = pageIds.length
    ? db.select().from(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).all()
    : []

  if (pages.length === 0) {
    console.log(`No pages ingested for ${client.name}. Run: npx tsx src/scripts/ingest.ts --client=${client.id}`)
    return
  }

  const recs = buildRecommendations({ client, locations, pages, paragraphs })
  const stats = summarise(recs)

  db.delete(schema.recommendations).where(eq(schema.recommendations.clientId, client.id)).run()
  if (recs.length > 0) {
    db.insert(schema.recommendations)
      .values(
        recs.map((r) => ({
          clientId: client.id,
          pageId: r.pageId,
          kind: r.kind,
          target: r.target,
          currentValue: r.currentValue,
          proposedValue: r.proposedValue,
          reason: r.reason,
          priority: r.priority,
          placeholderCount: countPlaceholders(r.proposedValue),
        })),
      )
      .run()
  }

  console.log(`=== RECOMMENDATIONS — ${client.name} (${client.businessType}) ===`)
  console.log(`${stats.total} changes proposed across ${pages.length} pages`)
  console.log(`  ${stats.byKind.map(([k, n]) => `${k.replace(/_/g, ' ')}: ${n}`).join(' · ')}`)
  console.log(`  ${stats.needingInput} need a fact from the business (${stats.placeholders} placeholders)`)

  const only = arg('show')
  const shown = only ? recs.filter((r) => r.kind === only) : recs.slice(0, 6)

  console.log(`\n${only ? `── ALL ${only.toUpperCase()} ──` : '── TOP 6 BY IMPACT ──'}`)
  for (const r of shown) {
    console.log(`\n[${r.priority}] ${r.kind.replace(/_/g, ' ')} · ${r.target}`)
    console.log(`  why: ${r.reason}`)
    if (r.currentValue) console.log(`  now: ${r.currentValue.slice(0, 150).replace(/\s+/g, ' ')}`)
    const preview = r.proposedValue.slice(0, only ? 1200 : 260).replace(/\n/g, '\n       ')
    console.log(`  new: ${preview}${r.proposedValue.length > (only ? 1200 : 260) ? ' …' : ''}`)
  }

  console.log(`\nAll ${stats.total} are stored — see them in the dashboard, or use --show=<kind>.`)
  console.log('Every [[FILL: …]] is something only the business can confirm. Nothing was invented.')
}

main()
