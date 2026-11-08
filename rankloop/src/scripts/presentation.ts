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
import { arg, flag } from '../lib/args'
import { loadEnv } from '../lib/env'

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
  const pages = db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.clientId, client.id))
    .all()
    .slice(0, Number.isFinite(limit) ? limit : 25)

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
  const homepage = client.homepageUrl.replace(/\/$/, '')

  for (const row of pages) {
    const page = await context.newPage()
    try {
      const vitals = await measure(row.url, page)
      const isHomepage = row.url.replace(/\/$/, '') === homepage
      const results = presentationFindings(vitals, row.id, isHomepage)
      found.push(...results)
      console.log(`  ${row.slug || '/'}  ${results.length} finding${results.length === 1 ? '' : 's'}`)
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
  console.log(`\nSee them on the Findings screen.`)
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
