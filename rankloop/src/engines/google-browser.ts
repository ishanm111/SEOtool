import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import type { LocalPackEntry } from './dataforseo'

/**
 * Reads Google's AI Overview and local map pack through a real browser.
 *
 * A free stand-in for the DataForSEO SERP API, with one real limitation worth
 * stating plainly: results reflect the OPERATOR'S location, not the client's.
 * Naming the city in the query gets most of the way there, but it is not the
 * same as seeing the map pack as somebody in that city sees it. That gap is why
 * the paid API exists, and why this is a single-client solution rather than a
 * general one.
 *
 * Google defends this surface far more aggressively than the chat assistants, so
 * everything here fails loudly rather than returning empty results that would be
 * mistaken for "the client is not mentioned".
 */

export type GoogleBrowserResult = {
  aiOverviewText: string
  localPack: LocalPackEntry[]
  organic: { title: string; url: string; domain: string; position: number }[]
  citations: { url: string; position: number }[]
  screenshotPath?: string
  ok: boolean
  error?: string
  blocked: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Consent walls and bot checks — detected so they are never read as "no results". */
async function detectBlock(page: Page): Promise<string | null> {
  const url = page.url()
  if (/consent\.google|\/sorry\//.test(url)) {
    return url.includes('/sorry/')
      ? 'Google served a bot check (/sorry/). Slow the pacing down or leave it for a while.'
      : 'Google served a consent wall. Accept it once by hand in this profile, then re-run.'
  }
  const body = await page.locator('body').innerText().catch(() => '')
  if (/unusual traffic from your computer network/i.test(body)) {
    return 'Google flagged unusual traffic. Stop for a few hours before trying again.'
  }
  return null
}

/**
 * Everything is read from the page's rendered TEXT rather than its markup.
 *
 * Google's SERP DOM is machine-generated and reshuffled constantly — class names
 * and `jsname` attributes are worthless within weeks. The rendered text is
 * stable: an AI Overview is always introduced by the words "AI Overview", and a
 * map-pack entry is always a name followed by a rating and a count. Those
 * survive redesigns because they are what the page means, not how it is built.
 */
async function pageText(page: Page): Promise<string> {
  // The AI Overview streams in, so wait until the text stops growing.
  const deadline = Date.now() + 20_000
  let last = ''
  let lastChange = Date.now()

  while (Date.now() < deadline) {
    const text = (await page.locator('body').innerText().catch(() => '')) ?? ''
    if (text !== last) {
      last = text
      lastChange = Date.now()
    } else if (last.length > 500 && Date.now() - lastChange > 2500) {
      break
    }
    await sleep(700)
  }
  return last
}

function extractAiOverview(text: string): string {
  const marker = text.indexOf('AI Overview')
  if (marker === -1) return ''

  const after = text.slice(marker + 'AI Overview'.length).replace(/^\s*\n/, '')
  // The overview ends where the next section heading begins.
  const end = after.search(/\n(?:Top |People also ask|Sponsored|Videos|Images|Related searches)/)
  const body = (end > 0 ? after.slice(0, end) : after.slice(0, 1400)).trim()

  // A couple of words is a stray label, not an overview.
  return body.split(/\s+/).length >= 12 ? body : ''
}

/**
 * The map pack, as name / rating / review-count triples.
 *
 * Google's SERP markup is obfuscated and changes constantly, so this reads the
 * rendered TEXT of the local block instead of relying on class names — a rating
 * line looks like "4.8 (212)" whatever the surrounding DOM is called that week.
 */
/**
 * Map-pack entries, which Google renders as three consecutive lines:
 *
 *   Appliance Doctor Inc
 *   4.8
 *   (115)
 *
 * The rating and the count sit on separate lines, so a single-line regex finds
 * nothing — which is exactly how the first attempt returned an empty map pack
 * while the data was plainly on screen.
 */
function extractLocalPack(text: string): LocalPackEntry[] {
  const lines = text.split('\n').map((l) => l.trim())
  const out: LocalPackEntry[] = []

  for (let i = 0; i < lines.length - 2; i++) {
    if (!/^[0-5](?:\.\d)?$/.test(lines[i + 1])) continue
    if (!/^\(\d[\d,]*\)$/.test(lines[i + 2])) continue

    const name = lines[i]
    if (name.length < 3 || name.length > 70) continue
    if (!/^[A-Z0-9]/.test(name)) continue
    if (/^(sponsored|ads?|rating|reviews?|website|directions|top |people also)/i.test(name)) continue
    if (out.some((e) => e.title === name)) continue

    out.push({
      title: name,
      rating: Number(lines[i + 1]),
      ratingCount: Number(lines[i + 2].replace(/[(),]/g, '')),
      url: null,
      position: out.length + 1,
    })
    if (out.length >= 5) break
  }

  return out
}

async function readOrganic(page: Page) {
  const results: { title: string; url: string; domain: string; position: number }[] = []
  const links = page.locator('#search a[href^="http"] h3')
  const n = await links.count().catch(() => 0)

  for (let i = 0; i < Math.min(n, 10); i++) {
    const h3 = links.nth(i)
    const title = (await h3.innerText().catch(() => '')) ?? ''
    const href = await h3
      .locator('xpath=ancestor::a[1]')
      .getAttribute('href')
      .catch(() => null)
    if (!title || !href) continue
    try {
      const domain = new URL(href).hostname.replace(/^www\./, '')
      if (/google\./.test(domain)) continue
      results.push({ title, url: href, domain, position: results.length + 1 })
    } catch {
      // malformed href — skip
    }
  }
  return results
}

export async function askGoogleViaBrowser(
  context: BrowserContext,
  query: string,
  shotName: string,
  shotsDir: string,
): Promise<GoogleBrowserResult> {
  const empty: GoogleBrowserResult = {
    aiOverviewText: '',
    localPack: [],
    organic: [],
    citations: [],
    ok: false,
    blocked: false,
  }

  const page = await context.newPage()
  try {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    await sleep(1800 + Math.random() * 1500)

    const blocked = await detectBlock(page)
    if (blocked) return { ...empty, blocked: true, error: blocked }

    const text = await pageText(page)
    const aiOverviewText = extractAiOverview(text)
    const localPack = extractLocalPack(text)
    const organic = await readOrganic(page)

    const screenshotPath = path.join(shotsDir, `${shotName}.png`)
    await page.screenshot({ path: screenshotPath }).catch(() => {})

    // Nothing at all usually means a layout change or a soft block, not a page
    // with genuinely no results.
    if (!aiOverviewText && localPack.length === 0 && organic.length === 0) {
      return {
        ...empty,
        screenshotPath: path.relative(process.cwd(), screenshotPath),
        error: 'nothing extracted — check the screenshot; Google may have changed layout or soft-blocked',
      }
    }

    return {
      aiOverviewText,
      localPack,
      organic,
      citations: organic.slice(0, 5).map((o, i) => ({ url: o.url, position: i + 1 })),
      screenshotPath: path.relative(process.cwd(), screenshotPath),
      ok: true,
      blocked: false,
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await page.close().catch(() => {})
  }
}
