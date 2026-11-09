import { chromium } from 'playwright'
import { eq, inArray } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient } from '../lib/resolve-client'
import {
  COLLECT_SCRIPT,
  LEVER_NOTE,
  PRESENTATION_CATEGORIES,
  presentationFindings,
  type PageVitals,
} from '../analysis/presentation'
import {
  PRESENTATION_KINDS,
  presentationRecommendations,
  type DestinationPage,
} from '../recommend/presentation'
import { countPlaceholders, type Recommendation } from '../recommend'
import { arg, flag } from '../lib/args'
import { loadEnv } from '../lib/env'
import { waitIfPaused } from '../lib/pause-gate'

/**
 * Audits how a client's pages are built and presented, not what they say.
 *
 *   npm run presentation -- --client=5
 *   npm run presentation -- --client=5 --limit=10 --headed
 *
 * A separate pass from `analyze` because it needs a real browser: colours,
 * type sizes, tap targets and layout shift do not exist until CSS has been
 * applied and the page has painted. Nothing here can be read off stored HTML,
 * which is why the ingest step cannot do it.
 *
 * Runs at phone width on purpose. Google indexes the mobile rendering, so a
 * desktop measurement would pass pages that are unusable on the device most
 * local searches happen on.
 */

const MOBILE = { width: 390, height: 844 }

async function measure(url: string, page: import('playwright').Page): Promise<PageVitals> {
  /**
   * Core Web Vitals are reported by the browser through PerformanceObserver and
   * only while the page is live, so the observers are installed before
   * navigation and read afterwards. Reading them from `performance.getEntries`
   * after the fact misses layout shifts entirely.
   */
  await page.addInitScript(() => {
    const w = window as unknown as { __vitals: { lcp: number | null; cls: number } }
    w.__vitals = { lcp: null, cls: 0 }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__vitals.lcp = entry.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
          if (!shift.hadRecentInput) w.__vitals.cls += shift.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {
      // Firefox and Safari do not implement these. Chromium does, which is what
      // this runs in, and which is also what Google measures with.
    }
  })

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 })

  // Lazy-loaded hero images and late-injected banners are the two biggest
  // sources of layout shift, and neither has happened at networkidle.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)

  const collected = (await page.evaluate(COLLECT_SCRIPT)) as Omit<PageVitals, 'url' | 'lcpMs' | 'cls'>
  const vitals = (await page.evaluate(
    () => (window as unknown as { __vitals: { lcp: number | null; cls: number } }).__vitals,
  )) as { lcp: number | null; cls: number }

  return {
    url,
    lcpMs: vitals?.lcp ?? null,
    cls: vitals?.cls ?? null,
    ...collected,
  }
}

async function main() {
  loadEnv()
  const db = openDb()
  const client = resolveClient(db)

  const limit = Number(arg('limit') ?? 25)
  const allPages = db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.clientId, client.id))
    .all()
  const pages = allPages.slice(0, Number.isFinite(limit) ? limit : 25)

  /**
   * Every page of the site, not only the ones being audited.
   *
   * This is what lets a "Read more" be renamed after the page it actually
   * points at. A link's destination is often a page further down the list than
   * the audit reaches, and naming it from a guess is the one thing this is not
   * allowed to do.
   */
  const destinations: DestinationPage[] = allPages.map((p) => ({ url: p.url, title: p.title }))

  if (pages.length === 0) {
    console.log(`No pages ingested for ${client.name}. Run: npm run ingest -- --client=${client.id}`)
    return
  }

  console.log(`Auditing ${pages.length} pages for ${client.name} at ${MOBILE.width}px wide.\n`)

  const browser = await chromium.launch({ headless: !flag('headed') })
  const context = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  })

  const found: ReturnType<typeof presentationFindings> = []
  const proposed: Recommendation[] = []
  const homepage = client.homepageUrl.replace(/\/$/, '')

  /** The console's run id, absent when this was started by hand. */
  const pipelineRunId = Number(arg('run')) || null

  for (const row of pages) {
    // Held between pages, so a pause never leaves a page half measured.
    await waitIfPaused(pipelineRunId)

    const page = await context.newPage()
    try {
      const vitals = await measure(row.url, page)
      const isHomepage = row.url.replace(/\/$/, '') === homepage
      const results = presentationFindings(vitals, row.id, isHomepage)
      found.push(...results)
      const changes = presentationRecommendations(vitals, { id: row.id, url: row.url }, destinations)
      proposed.push(...changes)
      console.log(
        `  ${row.slug || '/'}  ${results.length} finding${results.length === 1 ? '' : 's'}` +
          `, ${changes.length} change${changes.length === 1 ? '' : 's'} to publish`,
      )
    } catch (err) {
      // One unreachable page is not a reason to lose the other twenty-four.
      console.log(`  ${row.slug || '/'}  could not be read: ${err instanceof Error ? err.message : err}`)
    } finally {
      await page.close()
    }
  }

  await context.close()
  await browser.close()

  // Only this module's own categories, so a presentation pass never deletes a
  // finding that `analyze` produced.
  const existing = db
    .select({ id: schema.findings.id, category: schema.findings.category })
    .from(schema.findings)
    .where(eq(schema.findings.clientId, client.id))
    .all()
    .filter((f) => (PRESENTATION_CATEGORIES as readonly string[]).includes(f.category))
    .map((f) => f.id)

  if (existing.length > 0) {
    db.delete(schema.findings).where(inArray(schema.findings.id, existing)).run()
  }

  for (const f of found) {
    db.insert(schema.findings)
      .values({
        clientId: client.id,
        targetType: f.targetType,
        targetId: f.targetId ?? null,
        category: f.category,
        severity: f.severity,
        issue: f.issue,
        currentText: f.currentText ?? null,
        proposedText: f.proposedText ?? null,
        // The lever rides along in the evidence so the findings screen can say
        // plainly which of these move a ranking and which only move a visitor.
        evidence: [f.evidence, LEVER_NOTE[f.lever]].filter(Boolean).join(' '),
      })
      .run()
  }

  /**
   * The same ownership rule as the findings above, in the other direction.
   *
   * `recommend` clears a client's recommendations before rebuilding them and
   * knows nothing about these four kinds, so each pass deletes only what it
   * wrote. Without that, whichever ran second would silently wipe the other's
   * work and an operator would watch half the fix list disappear.
   */
  const ownKinds = PRESENTATION_KINDS as readonly string[]
  const staleRecs = db
    .select({ id: schema.recommendations.id, kind: schema.recommendations.kind })
    .from(schema.recommendations)
    .where(eq(schema.recommendations.clientId, client.id))
    .all()
    .filter((r) => ownKinds.includes(r.kind))
    .map((r) => r.id)

  if (staleRecs.length > 0) {
    db.delete(schema.recommendations).where(inArray(schema.recommendations.id, staleRecs)).run()
  }

  /**
   * One row per thing to change, not one per page it shows up on.
   *
   * A site's logo, its footer badges and its missing viewport tag are in the
   * theme, so every page carries the same fault and the audit finds it again on
   * each. Twenty-five identical rows is the same job twenty-five times, and it
   * would bury the handful of changes that really are page by page.
   *
   * So the rows are collapsed by what they point at, the survivor keeps the
   * first page it was seen on, and anything found more than once says how many
   * pages carry it — because that count is what tells an operator to fix it in
   * the theme rather than on a page.
   */
  /**
   * What makes two of these the same job.
   *
   * An image or a link is the same one wherever it turns up, so those collapse
   * on what they point at. The viewport tag is one tag in one <head>, so every
   * page's copy of it is the same job too. A missing <h1> is not: that is a
   * different heading on every page, even where two pages would be given the
   * same words.
   */
  const sameJob = (r: Recommendation) =>
    r.locator
      ? `${r.kind}|${r.locator}`
      : r.kind === 'viewport'
        ? 'viewport'
        : `${r.kind}|${r.pageId}`

  const seen = new Map<string, { rec: Recommendation; pages: number }>()
  for (const r of proposed) {
    const key = sameJob(r)
    const existing = seen.get(key)
    if (existing) existing.pages += 1
    else seen.set(key, { rec: r, pages: 1 })
  }

  const alsoOn = (pages: number) =>
    pages > 2
      ? `The same one is on ${pages} of the pages audited, so it is almost certainly in the ` +
        `theme rather than on any single page — changed there, it is fixed on all of them.`
      : 'The same one is on two of the pages audited, so it has to be changed on both.'

  const toWrite = [...seen.values()].map(({ rec, pages }) =>
    pages === 1 ? rec : { ...rec, reason: `${rec.reason} ${alsoOn(pages)}` },
  )

  for (const r of toWrite) {
    db.insert(schema.recommendations)
      .values({
        clientId: client.id,
        pageId: r.pageId,
        kind: r.kind,
        target: r.target,
        locator: r.locator ?? null,
        currentValue: r.currentValue,
        proposedValue: r.proposedValue,
        reason: r.reason,
        priority: r.priority,
        placeholderCount: countPlaceholders(r.proposedValue),
      })
      .run()
  }

  const bySeverity = found.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1
    return acc
  }, {})
  const byLever = found.reduce<Record<string, number>>((acc, f) => {
    acc[f.lever] = (acc[f.lever] ?? 0) + 1
    return acc
  }, {})

  console.log(`\n${found.length} findings written.`)
  console.log(
    `  by severity: ${Object.entries(bySeverity).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`,
  )
  console.log(
    `  by lever:    ${Object.entries(byLever).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`,
  )
  const blocked = toWrite.filter((r) => countPlaceholders(r.proposedValue) > 0).length
  const byKind = toWrite.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1
    return acc
  }, {})

  console.log(
    `\n${toWrite.length} change${toWrite.length === 1 ? '' : 's'} written to the fix list.`,
  )
  console.log(
    `  by kind:     ${Object.entries(byKind).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ') || 'none'}`,
  )
  console.log(
    `  ${blocked} need a word from the business — nothing was invented to fill them.`,
  )

  console.log(`\nSee the findings on the Findings screen, and the changes on Recommendations.`)
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
