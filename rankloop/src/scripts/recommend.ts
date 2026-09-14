import { eq, inArray } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { buildRecommendations, countPlaceholders, summarise, type GoogleTermRow } from '../recommend'
import { arg } from '../lib/args'
import { loadFacts } from '../lib/facts'
import { isNavigational, isOnTopic, topicWords } from '../research/relevance'

/**
 * Produces the deliverable: what to change, page by page.
 *
 *   npx tsx src/scripts/recommend.ts --client=1
 *   npx tsx src/scripts/recommend.ts --client=1 --show=new_page
 *   npx tsx src/scripts/recommend.ts --client=1 --show=blog_post
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

  // The intake answers are what turn a blocked recommendation into a
  // publishable one, so they are loaded on every build rather than optionally.
  const facts = loadFacts(db, client.id)

  /**
   * The keyword pool behind the blog posts.
   *
   * Both are optional and both are read the same way for every client: Search
   * Console is empty unless the property is verifiably owned, and the question
   * set is empty until a run has generated one. A client missing either still
   * gets a full fix list — the pool simply falls back to what the business says
   * it does.
   */
  const searchQueries = db
    .select()
    .from(schema.searchQueries)
    .where(eq(schema.searchQueries.clientId, client.id))
    .all()
  const promptRows = db
    .select()
    .from(schema.prompts)
    .where(eq(schema.prompts.clientId, client.id))
    .all()
    .filter((p) => p.isActive)

  /**
   * What Google showed for the research searches — its "People also ask"
   * questions, completions and related searches. One row per appearance, so a
   * question Google raised under several searches weighs more.
   */
  const googleTerms: GoogleTermRow[] = []
  const parseList = (raw: string): string[] => {
    try {
      const v = JSON.parse(raw)
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  const snapshots = db
    .select()
    .from(schema.serpSnapshots)
    .where(eq(schema.serpSnapshots.clientId, client.id))
    .all()
    .filter((s) => s.ok)
  // Off-topic drift and searches for a named rival never become a post.
  const topic = topicWords(client)
  const businessNames = snapshots.flatMap((s) => {
    try {
      return (JSON.parse(s.localPack) as { title: string }[]).map((e) => e.title)
    } catch {
      return []
    }
  })
  const keep = (text: string) =>
    isOnTopic(text, topic) && !isNavigational(text, businessNames) &&
    !client.aliases.some((a) => text.toLowerCase().includes(a))
  for (const snap of snapshots) {
    for (const text of parseList(snap.peopleAlsoAsk).filter(keep)) googleTerms.push({ text, kind: 'people_also_ask' })
    for (const text of parseList(snap.relatedSearches).filter(keep)) googleTerms.push({ text, kind: 'related' })
    for (const text of parseList(snap.suggestions).filter(keep)) googleTerms.push({ text, kind: 'suggestion' })
  }

  const recs = buildRecommendations({
    client,
    locations,
    pages,
    paragraphs,
    facts,
    searchQueries,
    prompts: promptRows,
    googleTerms,
  })
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
