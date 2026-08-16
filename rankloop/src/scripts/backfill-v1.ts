import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * One-time migration from the single-client phase-one database into the
 * multi-client schema. Reads data-v1-backup.db and a client JSON file, writes
 * everything into data.db as client #1.
 *
 * Delete this script once it has run — it exists only so that the measured
 * results from phase one (AI answers, screenshots, findings, competitor crawls)
 * survive the refactor.
 *
 *   npx tsx src/scripts/backfill-v1.ts clients/<client>.json
 */

const OLD_DB = process.env.RANKLOOP_OLD_DB ?? 'data-v1-backup.db'
const NEW_DB = process.env.RANKLOOP_DB ?? 'data.db'

type ClientFile = {
  name: string
  domain: string
  homepageUrl: string
  businessType: string
  platform: string
  apiBase: string | null
  aliases: string[]
  phones: string[]
  primaryPhone: string | null
  gbpUrl: string | null
  gbpRating: number | null
  gbpReviewCount: number | null
  gbpHasWebsite: boolean | null
  gbpServiceArea: string | null
  offerings: string[]
  wrongGeoTerms: string[]
  locations: { name: string; region: string; metro: string; dataforseoLocation: string }[]
  manualCompetitors?: { name: string; domain: string }[]
}

/** Same structural rule the live crawler uses — no hardcoded chain names. */
const isNational = (pageCount: number, cityPageCount: number) =>
  pageCount >= 1000 || cityPageCount >= 100

function main() {
  const clientPath = process.argv[2]
  if (!clientPath) throw new Error('usage: tsx src/scripts/backfill-v1.ts <client.json>')
  if (!fs.existsSync(OLD_DB)) throw new Error(`no backup found at ${OLD_DB}`)

  const c = JSON.parse(fs.readFileSync(path.resolve(clientPath), 'utf8')) as ClientFile
  const old = new Database(OLD_DB, { readonly: true })
  const db = new Database(NEW_DB)
  db.pragma('journal_mode = WAL')

  const existing = db.prepare('select id from clients where domain = ?').get(c.domain) as { id: number } | undefined
  if (existing) {
    console.log(`client ${c.domain} already exists (id ${existing.id}) — nothing to do`)
    return
  }

  const run = db.transaction(() => {
    // ── client
    const clientId = Number(
      db
        .prepare(
          `insert into clients (name, domain, homepage_url, business_type, platform, api_base,
             aliases, phones, primary_phone, gbp_url, gbp_rating, gbp_review_count,
             gbp_has_website, gbp_service_area, offerings, wrong_geo_terms, is_active, created_at)
           values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,unixepoch())`,
        )
        .run(
          c.name, c.domain, c.homepageUrl, c.businessType, c.platform, c.apiBase,
          JSON.stringify(c.aliases), JSON.stringify(c.phones), c.primaryPhone,
          c.gbpUrl, c.gbpRating, c.gbpReviewCount,
          c.gbpHasWebsite === null ? null : c.gbpHasWebsite ? 1 : 0,
          c.gbpServiceArea, JSON.stringify(c.offerings), JSON.stringify(c.wrongGeoTerms),
        ).lastInsertRowid,
    )

    // ── locations, mapping old city ids to new location ids
    const oldCities = old.prepare('select * from cities order by id').all() as Record<string, unknown>[]
    const cityIdMap = new Map<number, number>()
    for (const loc of c.locations) {
      const id = Number(
        db
          .prepare(
            `insert into locations (client_id, name, region, metro, dataforseo_location, is_active)
             values (?,?,?,?,?,1)`,
          )
          .run(clientId, loc.name, loc.region, loc.metro, loc.dataforseoLocation).lastInsertRowid,
      )
      const match = oldCities.find((oc) => oc.name === loc.name)
      if (match) cityIdMap.set(Number(match.id), id)
    }

    // ── pages, keeping old ids mapped so paragraphs still attach correctly
    const oldPages = old.prepare('select * from pages order by id').all() as Record<string, unknown>[]
    const pageIdMap = new Map<number, number>()
    for (const p of oldPages) {
      const id = Number(
        db
          .prepare(
            `insert into pages (client_id, external_id, url, slug, title, meta_description, text,
               word_count, schema_types, page_type, geo_refs, wrong_geo_hits, fetched_at)
             values (?,?,?,?,?,?,?,?,?,'page',?,?,?)`,
          )
          .run(
            clientId, p.wp_id === null ? null : String(p.wp_id), p.url, p.slug, p.title,
            p.meta_description, p.text, p.word_count, p.schema_types,
            p.geo_refs, p.wrong_state_hits, p.fetched_at,
          ).lastInsertRowid,
      )
      pageIdMap.set(Number(p.id), id)
    }

    const oldParas = old.prepare('select * from paragraphs order by id').all() as Record<string, unknown>[]
    for (const p of oldParas) {
      const pageId = pageIdMap.get(Number(p.page_id))
      if (!pageId) continue
      db.prepare(
        `insert into paragraphs (page_id, sort_order, heading, text, word_count, stat_count,
           has_citation, superlative_count, readability)
         values (?,?,?,?,?,?,?,?,?)`,
      ).run(
        pageId, p.sort_order, p.heading, p.text, p.word_count, p.stat_count,
        p.has_citation, p.superlative_count, p.readability,
      )
    }

    // ── prompts, then runs and their children
    const oldPrompts = old.prepare('select * from prompts order by id').all() as Record<string, unknown>[]
    const promptIdMap = new Map<number, number>()
    for (const p of oldPrompts) {
      const id = Number(
        db
          .prepare(
            `insert into prompts (client_id, location_id, text, intent, persona, is_core, is_active)
             values (?,?,?,?,?,?,?)`,
          )
          .run(
            clientId, p.city_id === null ? null : (cityIdMap.get(Number(p.city_id)) ?? null),
            p.text, p.intent, p.persona, p.is_core, p.is_active,
          ).lastInsertRowid,
      )
      promptIdMap.set(Number(p.id), id)
    }

    const oldRuns = old.prepare('select * from runs order by id').all() as Record<string, unknown>[]
    const runIdMap = new Map<number, number>()
    for (const r of oldRuns) {
      const promptId = promptIdMap.get(Number(r.prompt_id))
      if (!promptId) continue
      const id = Number(
        db
          .prepare(
            `insert into runs (prompt_id, engine, answer_text, screenshot_path, raw_payload, ok, error, run_at)
             values (?,?,?,?,?,?,?,?)`,
          )
          .run(promptId, r.engine, r.answer_text, r.screenshot_path, r.raw_payload, r.ok, r.error, r.run_at)
          .lastInsertRowid,
      )
      runIdMap.set(Number(r.id), id)
    }

    for (const m of old.prepare('select * from mentions').all() as Record<string, unknown>[]) {
      const runId = runIdMap.get(Number(m.run_id))
      if (!runId) continue
      db.prepare(
        `insert into mentions (run_id, business_name, is_client, position, snippet) values (?,?,?,?,?)`,
      ).run(runId, m.business_name, m.is_client, m.position, m.snippet)
    }

    for (const ct of old.prepare('select * from citations').all() as Record<string, unknown>[]) {
      const runId = runIdMap.get(Number(ct.run_id))
      if (!runId) continue
      db.prepare(
        `insert into citations (run_id, url, domain, is_client_domain, position) values (?,?,?,?,?)`,
      ).run(runId, ct.url, ct.domain, ct.is_client_domain, ct.position)
    }

    // ── findings; paragraph-targeted ones need their target remapped
    for (const f of old.prepare('select * from findings order by id').all() as Record<string, unknown>[]) {
      db.prepare(
        `insert into findings (client_id, target_type, target_id, category, severity, issue,
           current_text, proposed_text, evidence, created_at)
         values (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        clientId, f.target_type, f.target_id, f.category, f.severity, f.issue,
        f.current_text, f.proposed_text, f.evidence, f.created_at,
      )
    }

    // ── competitors; isNational is now stored rather than recomputed each time
    for (const co of old.prepare('select * from competitors order by id').all() as Record<string, unknown>[]) {
      db.prepare(
        `insert into competitors (client_id, domain, name, citation_count, mention_count, page_count,
           city_page_count, city_pages, schema_types, has_local_business, has_faq_schema, faq_block_count,
           avg_readability, stats_per_thousand, superlative_count, sample_word_count, phones,
           discovered_via, is_national, crawled_at, ok, error)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'sitemap',?,?,?,?)`,
      ).run(
        clientId, co.domain, co.name, co.citation_count, co.mention_count, co.page_count,
        co.city_page_count, co.city_pages, co.schema_types, co.has_local_business, co.has_faq_schema,
        co.faq_block_count, co.avg_readability, co.stats_per_thousand, co.superlative_count,
        co.sample_word_count, co.phones,
        isNational(Number(co.page_count), Number(co.city_page_count)) ? 1 : 0,
        co.crawled_at, co.ok, co.error,
      )
    }

    for (const g of old.prepare('select * from generated_pages order by id').all() as Record<string, unknown>[]) {
      db.prepare(
        `insert into generated_pages (client_id, location_id, slug, title, meta_description, h1,
           body_html, schema_json, created_at)
         values (?,?,?,?,?,?,?,?,?)`,
      ).run(
        clientId, g.city_id === null ? null : (cityIdMap.get(Number(g.city_id)) ?? null),
        g.slug, g.title, g.meta_description, g.h1, g.body_html, g.schema_json, g.created_at,
      )
    }

    return clientId
  })

  const clientId = run()

  console.log(`backfilled "${c.name}" as client #${clientId}\n`)
  for (const t of ['locations', 'pages', 'paragraphs', 'prompts', 'runs', 'mentions', 'citations', 'findings', 'competitors', 'generated_pages']) {
    const n = (db.prepare(`select count(*) c from ${t}`).get() as { c: number }).c
    const before = (old.prepare(`select count(*) c from ${t === 'locations' ? 'cities' : t}`).get() as { c: number }).c
    const flag = n === before ? 'ok' : `WAS ${before}`
    console.log(`${String(n).padStart(6)} ${t.padEnd(16)} ${flag}`)
  }

  old.close()
  db.close()
}

main()
