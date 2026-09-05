import { chromium } from 'playwright'

/**
 * Reads a Google Business Profile from its public Maps page.
 *
 * A profile page is assembled in the browser — a plain fetch returns the Maps
 * shell and nothing about the business — so this drives a real headless browser.
 * It is deliberately a separate browser from the measurement profile: reading a
 * public listing needs no login, and borrowing the signed-in profile would mean
 * a client's rating could not be read while a measurement run was going.
 *
 * Everything it returns is a suggestion. The operator sees each value in an
 * editable field before it is saved, because Maps changes its markup without
 * warning and a silently-wrong review count is worse than an empty one.
 */

export type GbpReading = {
  url: string
  name: string | null
  rating: number | null
  reviewCount: number | null
  category: string | null
  address: string | null
  /** Present when the listing is a service-area business rather than a shopfront. */
  serviceArea: string | null
  website: string | null
  phone: string | null
  /** What could not be read, in words an operator can act on. */
  warnings: string[]
}

const empty = (url: string, warning: string): GbpReading => ({
  url,
  name: null,
  rating: null,
  reviewCount: null,
  category: null,
  address: null,
  serviceArea: null,
  website: null,
  phone: null,
  warnings: [warning],
})

/** Maps writes numbers with the viewer's separators; only en-US is requested. */
function toNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function looksLikeGoogleProfile(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return /(^|\.)google\.[a-z.]+$/.test(host) || host === 'maps.app.goo.gl' || host === 'goo.gl'
  } catch {
    return false
  }
}

export async function readGoogleProfile(rawUrl: string, timeoutMs = 30_000): Promise<GbpReading> {
  const url = rawUrl.trim()
  if (!url) return empty(url, 'No Google profile link was given.')
  if (!looksLikeGoogleProfile(url)) {
    return empty(url, 'That link is not a Google Maps or Google Business Profile address.')
  }

  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch {
    return empty(
      url,
      'The bundled browser is not installed, so the profile could not be read. Run `npx playwright install chromium`, or type the rating and review count in by hand.',
    )
  }

  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    })
    const page = await context.newPage()

    // hl/gl pin the page to English and US formatting, so "1,234 reviews"
    // parses the same way wherever the operator happens to be.
    const target = new URL(url)
    target.searchParams.set('hl', 'en')
    target.searchParams.set('gl', 'us')

    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs })

    // Outside the US, Maps shows a consent wall before anything else.
    const consent = page.locator('button:has-text("Accept all"), button:has-text("Reject all")')
    if (await consent.first().isVisible().catch(() => false)) {
      await consent.first().click().catch(() => {})
    }

    await page.waitForSelector('h1', { timeout: timeoutMs }).catch(() => {})
    // The rating block renders after the heading; a short settle is cheaper
    // than a selector that Maps may rename next month.
    await page.waitForTimeout(1500)

    const warnings: string[] = []

    const name = (await page.locator('h1').first().textContent().catch(() => null))?.trim() || null

    /**
     * The rating comes from the star image's accessibility label rather than a
     * class name. Maps renames its classes constantly; the label has survived
     * every change seen so far, because screen readers depend on it.
     */
    const starLabels = await page
      .locator('[aria-label*="star" i]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
      .catch(() => [] as string[])
    // Maps renders an empty "stars" container alongside the real one, so the
    // first match is not necessarily the one carrying the number.
    const rating = toNumber(
      starLabels.map((l) => l.match(/([\d.]+)\s*stars?/i)?.[1]).find(Boolean),
    )

    /**
     * The review count is read where it appears, and left null where it does
     * not. Maps serves a reduced panel to an automated browser and frequently
     * omits the count entirely — so this asks the operator for it rather than
     * inventing one. A made-up review count would flow straight into the
     * competitive comparison and change what the client is told to do.
     */
    const reviewLabel = await page
      .locator('[aria-label*="review" i]')
      .first()
      .getAttribute('aria-label')
      .catch(() => null)
    const headerText =
      (await page.locator('h1').first().locator('xpath=../..').innerText().catch(() => '')) || ''
    const reviewCount =
      toNumber(reviewLabel?.match(/([\d,]+)\s*reviews?/i)?.[1]) ??
      toNumber(headerText.match(/\(([\d,]{2,})\)/)?.[1])

    if (rating === null) warnings.push('No star rating was visible on the profile.')
    if (reviewCount === null) {
      warnings.push(
        'Google did not serve the review count to an automated read. Open the profile and type it in below — the competitive comparison uses it.',
      )
    }

    const textOf = async (selector: string) => {
      const el = page.locator(selector).first()
      if ((await el.count()) === 0) return null
      const label = await el.getAttribute('aria-label').catch(() => null)
      const text = label ?? (await el.textContent().catch(() => null))
      return (
        text
          ?.replace(/^(Address|Phone|Website|Copy address|Copy phone number):?\s*/i, '')
          .trim() || null
      )
    }

    const address = await textOf('[data-item-id="address"]')
    const phone = await textOf('[data-item-id^="phone"]')
    const website = await page
      .locator('a[data-item-id="authority"]')
      .first()
      .getAttribute('href')
      .catch(() => null)

    // The header reads: name, rating, then the primary category.
    const category =
      headerText
        .split('\n')
        .map((l) => l.replace(/[^\p{L}\p{N})]+$/u, '').trim())
        .find((l) => l && l !== name && !/^[\d.]+$/.test(l) && !/^\(/.test(l)) ?? null

    /**
     * A business that travels to its customers has no street address; Maps shows
     * the area it covers instead. Which of the two it is decides whether a
     * missing address is a finding or simply how that business works.
     */
    const serviceAreaEl = page.locator('[aria-label*="Service area" i]').first()
    const serviceArea =
      (await serviceAreaEl.count().catch(() => 0)) > 0
        ? (await serviceAreaEl.getAttribute('aria-label').catch(() => null))
            ?.replace(/Service area:?/i, '')
            .trim() || null
        : null

    if (!name) {
      warnings.push(
        'No business name was found on that page — check the link points at one profile rather than a list of results.',
      )
    }

    await context.close()
    return { url, name, rating, reviewCount, category, address, serviceArea, website, phone, warnings }
  } catch (err) {
    return empty(url, `The profile could not be read: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await browser.close().catch(() => {})
  }
}
