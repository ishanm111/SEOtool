import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import type { LocalPackEntry } from './dataforseo'
import { detectBlock, extractAiOverview, extractLocalPack, pageText, readOrganic } from './google-browser'
import { namesAgree, readPlacePanel, sameSite } from '../onboard/gbp'
import {
  countAds,
  extractPeopleAlsoAsk,
  extractRelatedSearches,
  reviewAges,
  searchUrl,
} from '../research/serp-text'

/**
 * Google research through a real browser: everything the DataForSEO SERP,
 * Keywords and Business Data endpoints were going to be bought for, read off
 * the pages Google shows anyone.
 *
 * | Paid endpoint              | Read here from                                   |
 * |----------------------------|--------------------------------------------------|
 * | AI Overview + references   | the overview block and the links inside it       |
 * | Local pack with ratings    | the map pack's name / rating / (count) lines     |
 * | Organic top 10             | result headings                                  |
 * | People Also Ask            | the "People also ask" block                      |
 * | City-level targeting       | Google's own `uule` location parameter           |
 * | Keyword ideas              | the search box's completions + related searches  |
 * | CPC / competition          | how many "Sponsored" results a search carries    |
 * | Business Data (reviews)    | the Maps listing, reviews sorted newest first    |
 *
 * The one thing with no free equivalent is an absolute monthly search volume.
 * Autocomplete is the honest stand-in — Google only completes to phrases people
 * actually search — and it is labelled as that, never as a number.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** `domain` is blank when the source could not be located; `site` is the name Google gave it. */
export type AiOverviewSource = { url: string; domain: string; site: string; title: string }

export type SerpReading = {
  aiOverviewText: string
  aiOverviewSources: AiOverviewSource[]
  localPack: LocalPackEntry[]
  organic: { title: string; url: string; domain: string; position: number }[]
  peopleAlsoAsk: string[]
  relatedSearches: string[]
  suggestions: string[]
  adsCount: number
  screenshotPath?: string
  ok: boolean
  blocked: boolean
  error?: string
}

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Presses the overview's own "Show more", so the whole answer and every source
 * is on the page. Scoped to the overview block: a bare "Show more" click
 * elsewhere expands a forum thread and changes nothing we read.
 */
async function expandAiOverview(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const heading = [...document.querySelectorAll('h1, h2, div, span')].find(
        (el) => el.childElementCount === 0 && el.textContent?.trim() === 'AI Overview',
      )
      let box: Element | null = heading ?? null
      for (let i = 0; i < 8 && box; i++) box = box.parentElement
      const button = box
        ? [...box.querySelectorAll('[role="button"], button')].find((b) =>
            /^show more$/i.test((b as HTMLElement).innerText?.trim() ?? ''),
          )
        : null
      ;(button as HTMLElement | undefined)?.click()
    })
    .catch(() => {})
  await sleep(1500)
}

/**
 * The links inside the AI Overview — the pages Google's AI chose to trust.
 *
 * Found by climbing from the "AI Overview" heading to the largest block that
 * still contains no ordinary result heading, so the organic top ten is never
 * counted as the overview's sources.
 *
 * Google sends every link through an encrypted "/goto" redirect, so the href
 * does not say where a source goes. Its accessible label does say what it is
 * ("Mr. Appliance - Appliance Repair Services In Richmond, VA"), and the same
 * page almost always appears among the organic results, which print their
 * address. The domain is taken from that match and left blank when there is
 * none — a source named but not located, never a guessed domain.
 */
async function readAiOverviewSources(
  page: Page,
  organic: { title: string; domain: string; siteName?: string }[],
): Promise<AiOverviewSource[]> {
  const raw = await page
    .evaluate(() => {
      const heading = [...document.querySelectorAll('h1, h2, div, span')].find(
        (el) => el.childElementCount === 0 && el.textContent?.trim() === 'AI Overview',
      )
      if (!heading) return []
      let box: Element = heading
      while (box.parentElement && box.parentElement !== document.body) {
        const parent = box.parentElement
        if (parent.querySelector('a h3')) break
        if ((parent as HTMLElement).innerText.length > 12000) break
        box = parent
      }
      return [...box.querySelectorAll('a[href]')].map((a) => ({
        url: (a as HTMLAnchorElement).href,
        label: a.getAttribute('aria-label') || '',
      }))
    })
    .catch(() => [] as { url: string; label: string }[])

  const norm = (t: string) => t.toLowerCase().replace(/\.{3}|…/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const out: AiOverviewSource[] = []
  for (const r of raw) {
    const direct = domainOf(r.url)
    const viaGoogle = !direct || /(^|\.)google\./.test(direct)
    if (viaGoogle && !/\/(goto|url)\?/.test(r.url)) continue // maps, directions, policies
    if (!viaGoogle && /gstatic\.com|googleusercontent\.com/.test(direct)) continue

    /**
     * Two label shapes: a source card reads "Site - Title. Related results",
     * an inline link reads "Title - Site. Opens in new tab."
     */
    const siteFirst = /Related results\.?$/i.test(r.label)
    const label = r.label.replace(/\.\s*(Opens in (a )?new tab|Related results)\.?$/i, '').replace(/\s*\(\+\d+\)/, '').trim()
    if (!label || /^(website|directions|call)$/i.test(label)) continue
    const parts = label.split(' - ')
    const site = parts.length > 1 ? (siteFirst ? parts[0] : parts[parts.length - 1]) : ''
    const title = parts.length > 1 ? (siteFirst ? parts.slice(1) : parts.slice(0, -1)).join(' - ') : label

    let domain = viaGoogle ? '' : direct
    if (!domain) {
      const t = norm(title)
      const hit = organic.find((o) => {
        const ot = norm(o.title)
        return ot.length > 8 && (ot.startsWith(t) || t.startsWith(ot))
      })
      const bySite = site ? organic.find((o) => o.siteName && norm(o.siteName) === norm(site)) : undefined
      domain = hit?.domain ?? bySite?.domain ?? ''
    }
    if (out.some((o) => norm(o.title) === norm(title))) continue
    out.push({ url: viaGoogle ? '' : r.url.split('#:~:text=')[0], domain, site, title: title.slice(0, 160) })
  }
  return out.slice(0, 20)
}

/**
 * What Google's search box completes a phrase to.
 *
 * Typed at a human cadence into the box on the results page already open, so
 * it costs no extra page load. A long conversational question rarely completes,
 * so it falls back to its first five words — which is how the question was
 * typed by the person who asked it, before they finished.
 */
async function readSuggestions(page: Page, query: string): Promise<string[]> {
  const attempt = async (phrase: string) => {
    const box = page.locator('textarea[name="q"], input[name="q"]').first()
    if ((await box.count()) === 0) return []
    await box.click({ timeout: 5000 }).catch(() => {})
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.press('Backspace')
    await box.pressSequentially(phrase, { delay: 35 + Math.random() * 40 })
    await sleep(1600)
    const options = await page
      .locator('[role="listbox"] [role="option"]')
      .evaluateAll((els) => els.map((e) => ((e as HTMLElement).innerText || '').split('\n')[0].trim()))
      .catch(() => [] as string[])
    await page.keyboard.press('Escape').catch(() => {})
    return options
  }

  let found = await attempt(query)
  const words = query.split(/\s+/)
  if (found.length === 0 && words.length > 5) found = await attempt(words.slice(0, 5).join(' '))

  const out: string[] = []
  for (const s of found) {
    if (s.length < 3 || s.length > 120) continue
    if (/^(remove|delete|report inappropriate)/i.test(s)) continue
    if (!out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s)
  }
  return out.slice(0, 10)
}

export async function researchGoogleSearch(
  context: BrowserContext,
  query: string,
  searchedFrom: string,
  shotName: string,
  shotsDir: string,
): Promise<SerpReading> {
  const empty: SerpReading = {
    aiOverviewText: '',
    aiOverviewSources: [],
    localPack: [],
    organic: [],
    peopleAlsoAsk: [],
    relatedSearches: [],
    suggestions: [],
    adsCount: 0,
    ok: false,
    blocked: false,
  }

  const page = await context.newPage()
  try {
    await page.goto(searchUrl(query, searchedFrom), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(1800 + Math.random() * 1500)

    const blocked = await detectBlock(page)
    if (blocked) return { ...empty, blocked: true, error: blocked }

    // Settle first: the overview streams in, and its button only exists once it has.
    await pageText(page)
    // "See results closer to you?" covers the overview; the pinned location already does that job.
    const notNow = page.locator('button:has-text("Not now"), [role="button"]:has-text("Not now")').first()
    if (await notNow.isVisible().catch(() => false)) await notNow.click().catch(() => {})
    await expandAiOverview(page)
    const text = await pageText(page)

    const screenshotPath = path.join(shotsDir, `${shotName}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

    const aiOverviewText = extractAiOverview(text)
    const organic = await readOrganic(page)
    const reading: SerpReading = {
      aiOverviewText,
      aiOverviewSources: aiOverviewText ? await readAiOverviewSources(page, organic) : [],
      localPack: extractLocalPack(text),
      organic,
      peopleAlsoAsk: extractPeopleAlsoAsk(text),
      relatedSearches: extractRelatedSearches(text),
      adsCount: countAds(text),
      suggestions: [],
      screenshotPath: path.relative(process.cwd(), screenshotPath),
      ok: true,
      blocked: false,
    }

    // Nothing at all is a layout change or a soft block, never "no results".
    if (!reading.aiOverviewText && reading.localPack.length === 0 && reading.organic.length === 0) {
      return {
        ...empty,
        screenshotPath: reading.screenshotPath,
        error: 'nothing extracted — check the screenshot; Google may have changed layout or soft-blocked',
      }
    }

    reading.suggestions = await readSuggestions(page, query)
    return reading
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await page.close().catch(() => {})
  }
}

export type ProfileReading = {
  name: string | null
  rating: number | null
  reviewCount: number | null
  category: string | null
  website: string | null
  hasHours: boolean | null
  unclaimed: boolean | null
  reviewsLast30Days: number | null
  newestReviewDays: number | null
  reviewsSampled: number
  ok: boolean
  error?: string
}

/**
 * Sorts the open listing's reviews newest-first and reads their dates.
 *
 * Only a newest-first read says anything about pace. Maps defaults to "most
 * relevant", which surfaces years-old reviews, and counting those as recent
 * activity would tell a client a dormant rival is racing ahead. So if the sort
 * cannot be confirmed, nothing is returned.
 */
async function readReviewPace(page: Page): Promise<{ ages: number[] } | null> {
  const tab = page.locator('button[role="tab"][aria-label*="Reviews" i]').first()
  if ((await tab.count().catch(() => 0)) === 0) return null
  await tab.click({ timeout: 5000 }).catch(() => {})
  await sleep(2000)

  const sort = page.locator('button[aria-label*="Sort reviews" i], button[aria-label="Most relevant"]').first()
  if ((await sort.count().catch(() => 0)) === 0) return null

  /**
   * A signed-out browser is shown "Sign-in to get the best of Google Maps" the
   * moment it sorts. Dismissed once and tried again; a profile signed into
   * Google (the default Chrome profile) never sees it.
   */
  const newest = page
    .locator('[role="menuitemradio"], [role="menuitem"], [role="option"]')
    .filter({ hasText: /^\s*Newest\s*$/ })
    .first()
  for (let attempt = 0; attempt < 2; attempt++) {
    await sort.click({ timeout: 5000 }).catch(() => {})
    await sleep(1200)
    if (await newest.isVisible().catch(() => false)) break
    const dismiss = page.getByRole('button', { name: /^Dismiss$/ }).first()
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click().catch(() => {})
    await sleep(800)
  }
  if (!(await newest.isVisible().catch(() => false))) return null
  await newest.click({ timeout: 5000 }).catch(() => {})
  await sleep(2200)

  // The panel lazy-loads ten at a time; a few scrolls reach a month for most businesses.
  await page.mouse.move(220, 620)
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 2400)
    await sleep(900)
  }

  const text = await page.locator('body').innerText().catch(() => '')
  return { ages: reviewAges(text) }
}

/**
 * A public Maps listing, found by searching for the business in its town.
 *
 * Accepted only when the listing is verifiably the one asked for: its website
 * is the client's own domain, or its name agrees with the name Google's map
 * pack gave. A similar name in the next county is the failure this guards.
 */
export async function readBusinessProfile(
  context: BrowserContext,
  name: string,
  where: string,
  expectDomain?: string,
): Promise<ProfileReading> {
  const empty: ProfileReading = {
    name: null,
    rating: null,
    reviewCount: null,
    category: null,
    website: null,
    hasHours: null,
    unclaimed: null,
    reviewsLast30Days: null,
    newestReviewDays: null,
    reviewsSampled: 0,
    ok: false,
  }

  const page = await context.newPage()
  try {
    const search = `${name}${where ? ` ${where}` : ''}`
    await page.goto(
      `https://www.google.com/maps/search/${encodeURIComponent(search)}?hl=en&gl=us`,
      { waitUntil: 'domcontentloaded', timeout: 45_000 },
    )
    await sleep(3000 + Math.random() * 1500)

    // A list of candidates: open the one whose name matches, never simply the first.
    if ((await page.locator('[role="feed"]').count().catch(() => 0)) > 0) {
      const labels = await page
        .locator('[role="feed"] a[aria-label]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
        .catch(() => [] as string[])
      const index = labels.findIndex((l) => namesAgree(l, name))
      if (index === -1) {
        return { ...empty, error: `Maps listed businesses for "${search}" but none named like "${name}".` }
      }
      await page.locator('[role="feed"] a[aria-label]').nth(index).click({ timeout: 8000 })
      await page.waitForURL(/\/maps\/place\//, { timeout: 15_000 }).catch(() => {})
      /**
       * The results list stays open beside the listing after a click, and the
       * panel reader rightly refuses to read anything while a list is on screen.
       * Loading the listing's own address gives it the page on its own.
       */
      const feature = page.url().match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)
      const placeName = page.url().match(/\/maps\/place\/([^/]+)/)
      if (feature && placeName) {
        // The listing's own address, without the search it was found through.
        await page.goto(
          `https://www.google.com/maps/place/${placeName[1]}/data=!4m2!3m1!1s${feature[1]}?hl=en&gl=us`,
          { waitUntil: 'domcontentloaded', timeout: 45_000 },
        )
      }
      await sleep(2500)
    }

    const panel = await readPlacePanel(page, 20_000)
    if (panel.isResultsList || !panel.name) {
      return { ...empty, error: `No single listing opened for "${search}".` }
    }
    const verified = sameSite(panel.website, expectDomain) || namesAgree(panel.name, name)
    if (!verified) {
      return {
        ...empty,
        name: panel.name,
        error: `Maps opened "${panel.name}", which does not match "${name}" — not used.`,
      }
    }

    const body = await page.locator('body').innerText().catch(() => '')
    const unclaimed = /\b(Own this business\?|Claim this business)\b/i.test(body)

    const pace = await readReviewPace(page)
    const ages = pace?.ages ?? []
    const paceRead = pace !== null && (ages.length > 0 || panel.reviewCount === 0)

    return {
      name: panel.name,
      rating: panel.rating,
      reviewCount: panel.reviewCount,
      category: panel.category,
      website: panel.website,
      hasHours: panel.hours !== null ? true : null,
      unclaimed,
      // Strictly under 30: "a month ago" reads as 30 and spans four to seven weeks.
      reviewsLast30Days: paceRead ? ages.filter((d) => d < 30).length : null,
      newestReviewDays: paceRead && ages.length > 0 ? ages[0] : null,
      reviewsSampled: paceRead ? ages.length : 0,
      ok: true,
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await page.close().catch(() => {})
  }
}
