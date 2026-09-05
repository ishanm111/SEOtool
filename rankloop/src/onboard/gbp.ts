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
  /** The week's opening hours, only when all seven days were served. */
  hours: string | null
  /** The price bracket Maps displays, when it displays one. */
  priceLevel: string | null
  /**
   * Whether the Maps listing itself was actually opened and read.
   *
   * False means every null above is "not looked at", not "looked at and
   * absent". The difference matters: "no website on the listing" is a finding
   * that changes what the client is told to do, and reporting it because a
   * share link went to Search instead would be inventing it.
   */
  readListing: boolean
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
  hours: null,
  priceLevel: null,
  readListing: false,
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

/**
 * The hosts Google hands out when somebody presses Share.
 *
 * There is more than one, and which one you get depends on where you pressed
 * it: Maps gives `maps.app.goo.gl`, the listing in Search gives `share.google`,
 * and both are the same listing. Rejecting either of them tells an operator
 * their perfectly good link is wrong.
 */
const GOOGLE_SHORTENERS = new Set(['share.google', 'maps.app.goo.gl', 'goo.gl', 'g.co'])

export function looksLikeGoogleProfile(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    // `google.com` and friends, plus `share.google` — where google is the TLD
    // itself and the earlier "google-dot-something" test never matched.
    return (
      GOOGLE_SHORTENERS.has(host) ||
      host === 'google' ||
      /(^|\.)google\.[a-z.]+$/.test(host) ||
      host.endsWith('.share.google')
    )
  } catch {
    return false
  }
}

const isShortened = (url: URL) =>
  GOOGLE_SHORTENERS.has(url.hostname.replace(/^www\./, ''))

type Resolved = {
  /** Where the link actually goes. */
  url: string
  /** The listing's own name, when the destination carries one. */
  name: string | null
  /** True when it landed on a Maps place rather than a search results page. */
  isPlace: boolean
}

/**
 * Follows a shortened Google link to whatever it really points at.
 *
 * Done with a plain fetch rather than the browser: it is one request, and it
 * decides which page the browser should open, so paying for a browser launch
 * before knowing that would be wasteful.
 *
 * A share link from Maps lands on a Maps place. A share link copied from a
 * listing in Google Search lands on a Search results URL instead — which
 * carries the business's exact name in `q`, and that is worth having even
 * though the page itself cannot be read.
 */
async function resolveProfileUrl(raw: string): Promise<Resolved> {
  const initial = new URL(raw)
  if (!isShortened(initial)) {
    return { url: raw, name: null, isPlace: initial.pathname.includes('/maps/place/') }
  }

  const res = await fetch(raw, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    },
  })

  const final = new URL(res.url)
  return {
    url: res.url,
    name: final.searchParams.get('q'),
    isPlace: final.pathname.includes('/maps/place/'),
  }
}

/** Loose enough for punctuation and suffixes, strict enough to catch a different business. */
function namesAgree(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true

  // Otherwise most of the words have to be shared, which rules out the
  // similarly-named rivals a name search turns up.
  const xs = new Set(x.split(' ').filter((w) => w.length > 2))
  const ys = new Set(y.split(' ').filter((w) => w.length > 2))
  if (xs.size === 0 || ys.size === 0) return false
  const shared = [...xs].filter((w) => ys.has(w)).length
  return shared / Math.min(xs.size, ys.size) >= 0.75
}

export type ReadOptions = {
  timeoutMs?: number
  /**
   * The domain of the site being audited.
   *
   * Given one, a share link that lands on Google Search can still reach the
   * listing: Maps is searched for the name Google itself returned, and the
   * result is accepted only if the listing links to this exact domain. That is
   * a verifiable match rather than a guess, which is what the earlier refusal
   * to name-search was protecting against — three similarly-named businesses
   * in another state, one of them silently attached to a client.
   */
  expectDomain?: string
}

/** Whether a website found on a listing belongs to the site being audited. */
function sameSite(website: string | null, domain: string | undefined): boolean {
  if (!website || !domain) return false
  try {
    const host = new URL(website).hostname.replace(/^www\./, '')
    const target = domain.replace(/^www\./, '')
    return host === target || host.endsWith(`.${target}`) || target.endsWith(`.${host}`)
  } catch {
    return false
  }
}

/** Monday first, because that is how opening hours are read and written. */
const WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

type PanelReading = {
  name: string | null
  rating: number | null
  reviewCount: number | null
  category: string | null
  address: string | null
  serviceArea: string | null
  website: string | null
  phone: string | null
  hours: string | null
  priceLevel: string | null
  /** Maps answered with a list of businesses rather than one listing. */
  isResultsList: boolean
  warnings: string[]
}

type HourRow = { day: string; times: string; provisional: boolean }

/** The hours table as it stands right now, without pressing anything. */
async function readHourRows(page: import('playwright').Page): Promise<HourRow[]> {
  return page
    .locator('table tr')
    .evaluateAll((trs) =>
      trs
        .map((tr) => {
          const cells = tr.querySelectorAll('td')
          if (cells.length < 2) return null
          const day = (cells[0] as HTMLElement).innerText.replace(/\(.*?\)/g, '').trim()
          const times = (cells[1] as HTMLElement).innerText.trim().replace(/\s+/g, ' ')
          const provisional = /might differ/i.test((tr as HTMLElement).innerText)
          return { day, times, provisional }
        })
        .filter((r): r is HourRow => r !== null),
    )
    .catch(() => [] as HourRow[])
}

/** How many of the seven days a read actually produced. */
function countDays(rows: HourRow[]): number {
  return new Set(
    rows
      .filter((r) => r.times && WEEK.includes(r.day as (typeof WEEK)[number]))
      .map((r) => r.day),
  ).size
}

/**
 * Everything readable off an open Maps place panel.
 *
 * Split out because it is now reached two ways — a link straight to the place,
 * and a name search verified against the client's own domain — and the two must
 * read a listing identically or the same business would be described
 * differently depending on which link an operator happened to paste.
 */
async function readPlacePanel(
  page: import('playwright').Page,
  timeoutMs: number,
): Promise<PanelReading> {
  const warnings: string[] = []

  await page.waitForSelector('h1', { timeout: timeoutMs }).catch(() => {})
  // The rating block renders after the heading; a short settle is cheaper
  // than a selector that Maps may rename next month.
  await page.waitForTimeout(1500)

  const name = (await page.locator('h1').first().textContent().catch(() => null))?.trim() || null

  /**
   * Maps answers an ambiguous place link with a list of candidates rather than
   * a page, and the top of that list is regularly a different business in a
   * different state. Nothing is read from a list: a rating taken from the
   * wrong listing would flow into the competitive comparison and change what
   * the client is told to do.
   */
  const isResultsList =
    (await page.locator('[role="feed"]').count().catch(() => 0)) > 0 || name === 'Results'
  if (isResultsList) {
    return {
      name,
      rating: null,
      reviewCount: null,
      category: null,
      address: null,
      serviceArea: null,
      website: null,
      phone: null,
      hours: null,
      priceLevel: null,
      isResultsList: true,
      warnings,
    }
  }

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

  /**
   * The opening-hours table, which Maps serves as one row per day.
   *
   * A holiday row carries "Hours might differ" and is dropped: recording a
   * business as closed because the read happened on Labor Day would put a
   * wrong fact on their website.
   */
  /**
   * The opening-hours table, one row per day.
   *
   * Read before anything is pressed. Maps sometimes renders the week already
   * open and sometimes collapsed behind "Show open hours for the week", and the
   * control is a toggle — pressing it on a panel that was already open closes
   * it and leaves the read with today's row alone, which is how six days went
   * missing. So the control is only used when the week is not there already,
   * and the better of the two reads wins.
   */
  let rows = await readHourRows(page)
  if (countDays(rows) < WEEK.length) {
    const weekToggle = page.locator('[aria-label*="open hours for the week" i]').first()
    if ((await weekToggle.count().catch(() => 0)) > 0) {
      await weekToggle.click().catch(() => {})
      await page.waitForTimeout(1200)
      const expanded = await readHourRows(page)
      if (countDays(expanded) > countDays(rows)) rows = expanded
    }
  }

  const byDay = new Map<string, string>()
  const provisional: string[] = []
  for (const row of rows) {
    if (!WEEK.includes(row.day as (typeof WEEK)[number]) || !row.times) continue
    if (row.provisional) {
      provisional.push(row.day)
      continue
    }
    byDay.set(row.day, row.times)
  }

  const week = WEEK.filter((d) => byDay.has(d))
  let hours: string | null = null
  if (week.length === WEEK.length) {
    hours = week.map((d) => `${d} ${byDay.get(d)}`).join(', ')
  } else if (week.length > 0) {
    /**
     * A partial week is not written down. Maps regularly serves an automated
     * read today's row alone, and an operator handed "Saturday 10 AM–9 PM" in
     * a box labelled "opening hours" would publish one day as if it were all
     * seven.
     */
    warnings.push(
      `Google served only ${week.length} of the seven days of opening hours, so the answer was left blank rather than written down as if it were the whole week. What it did serve: ` +
        `${week.map((d) => `${d} ${byDay.get(d)}`).join(', ')}.`,
    )
  }
  if (provisional.length > 0) {
    warnings.push(
      `${provisional.join(' and ')} showed holiday hours ("might differ"), so ${provisional.length > 1 ? 'those days were' : 'that day was'} left out.`,
    )
  }

  /**
   * The price bracket, when Maps shows one. It is usually withheld from an
   * automated read, and nothing is inferred from the category when it is:
   * a bracket is a claim about a business, not a description of its trade.
   */
  const priceLevel =
    headerText
      .split(/[\n·]/)
      .map((part) => part.trim())
      .find((part) => /^\$+$/.test(part) && part.length <= 4) ?? null

  if (!name) {
    warnings.push(
      'No business name was found on that page — check the link points at one profile rather than a list of results.',
    )
  }

  return {
    name,
    rating,
    reviewCount,
    category,
    address,
    serviceArea,
    website,
    phone,
    hours,
    priceLevel,
    isResultsList: false,
    warnings,
  }
}

/** What a Search link yields on its own: the name Google holds, and nothing else. */
function nameOnly(url: string, name: string | null, extra: string[]): GbpReading {
  return {
    url,
    name,
    rating: null,
    reviewCount: null,
    category: null,
    address: null,
    serviceArea: null,
    website: null,
    phone: null,
    hours: null,
    priceLevel: null,
    readListing: false,
    warnings: [
      name
        ? `This link opens Google Search rather than a Maps listing, so only the name — "${name}" — could be read from it.`
        : 'This link opens Google Search rather than a Maps listing, so nothing could be read from it.',
      ...extra,
      'For the rating and review count, open the business in Google Maps, press Share there, and paste that link instead. Or type both in below.',
    ],
  }
}

export async function readGoogleProfile(
  rawUrl: string,
  opts: ReadOptions = {},
): Promise<GbpReading> {
  const { timeoutMs = 30_000, expectDomain } = opts
  const url = rawUrl.trim()
  if (!url) return empty(url, 'No Google profile link was given.')
  if (!looksLikeGoogleProfile(url)) {
    return empty(url, 'That link is not a Google Maps or Google Business Profile address.')
  }

  /**
   * A shortened link has to be followed before anything else, because where it
   * lands decides what can be read. Maps share links land on a place page;
   * links shared from a listing in Google Search land on a Search results URL,
   * which Google serves a robot check for rather than a page.
   */
  let resolved: Resolved
  try {
    resolved = await resolveProfileUrl(url)
  } catch (err) {
    return empty(
      url,
      `That link could not be followed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  /**
   * A Search link with no name, or with no site to check a listing against, is
   * as far as this goes. Searching Maps for a name and taking whatever comes
   * back is how a client ends up with a rival's rating attached to them.
   */
  if (!resolved.isPlace && (!resolved.name || !expectDomain)) {
    return nameOnly(url, resolved.name, [])
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
    // parses the same way wherever the operator happens to be. Applied to the
    // resolved address, never the short one — query parameters on a shortener
    // are not carried through the redirect.
    const target = resolved.isPlace
      ? new URL(resolved.url)
      : new URL(`https://www.google.com/maps/search/${encodeURIComponent(resolved.name ?? '')}`)
    target.searchParams.set('hl', 'en')
    target.searchParams.set('gl', 'us')

    /**
     * Maps is opened once before the listing is.
     *
     * A session that arrives cold at a place page is served a reduced panel:
     * one day of opening hours instead of seven, and a control that claims to
     * show the week but does nothing. One prior navigation is enough for the
     * full panel, and two seconds is a cheap price for six days of hours.
     */
    await page
      .goto('https://www.google.com/maps/?hl=en&gl=us', {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      })
      .catch(() => {})
    await page.waitForTimeout(1200)

    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs })

    // Outside the US, Maps shows a consent wall before anything else.
    const consent = page.locator('button:has-text("Accept all"), button:has-text("Reject all")')
    if (await consent.first().isVisible().catch(() => false)) {
      await consent.first().click().catch(() => {})
    }

    let panel = await readPlacePanel(page, timeoutMs)

    /**
     * One second look at the same listing, when the first came back without a
     * week of hours.
     *
     * Google serves the first arrival at a listing a reduced panel — today's
     * row, and a control for the week that does nothing — and serves the whole
     * thing on the next navigation to the same address. Landing on a place
     * through a search is the common case here, so without this the hours are
     * lost for exactly the links operators actually paste.
     */
    if (!panel.isResultsList && panel.hours === null && page.url().includes('/maps/place/')) {
      const again = page.url()
      await page.goto(again, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {})
      const second = await readPlacePanel(page, timeoutMs)
      if (!second.isResultsList && second.name) {
        panel = {
          ...panel,
          ...second,
          // Anything the fuller read failed to see is kept from the first,
          // rather than being lost to a panel that rendered differently.
          rating: second.rating ?? panel.rating,
          reviewCount: second.reviewCount ?? panel.reviewCount,
          address: second.address ?? panel.address,
          phone: second.phone ?? panel.phone,
          website: second.website ?? panel.website,
          category: second.category ?? panel.category,
          serviceArea: second.serviceArea ?? panel.serviceArea,
          hours: second.hours ?? panel.hours,
          priceLevel: second.priceLevel ?? panel.priceLevel,
          // The second read's account of what it could not see is the current
          // one; the first read's warnings described a panel now superseded.
          warnings: second.warnings,
        }
      }
    }

    if (panel.isResultsList) {
      await context.close()
      if (!resolved.isPlace) {
        return nameOnly(url, resolved.name, [
          `Searching Maps for "${resolved.name}" returned a list of businesses rather than one listing, so nothing was read from it.`,
        ])
      }
      return {
        ...empty(url, 'That link opens a list of businesses rather than one listing.'),
        name: resolved.name,
        warnings: [
          'That link opens a list of businesses rather than one listing, so nothing was read from it — the top of such a list is often a different business entirely.',
          'Open the exact listing in Google Maps, press Share, and paste that link. Or type the rating and review count in below.',
        ],
      }
    }

    /**
     * A listing reached by searching for a name is only accepted when it links
     * to the site being audited. The name alone is not enough — that is how a
     * business three states away with the same name gets attached to a client —
     * and a domain on the listing is something Google was told by the owner.
     */
    if (!resolved.isPlace && !sameSite(panel.website, expectDomain)) {
      await context.close()
      return nameOnly(url, resolved.name, [
        panel.website
          ? `Maps was searched for "${resolved.name}" and found a listing, but it links to ${panel.website} rather than ${expectDomain}, so it was not used — it is probably a different business with the same name.`
          : `Maps was searched for "${resolved.name}" and found a listing with no website on it, so there was no way to confirm it is this business. Nothing was read from it.`,
      ])
    }

    const warnings = [...panel.warnings]

    /**
     * When the short link told us the name, the page has to agree with it.
     * Maps will happily resolve a link to a neighbouring business, and a wrong
     * listing attached to a client is worse than no listing at all.
     */
    if (resolved.name && panel.name && !namesAgree(resolved.name, panel.name)) {
      warnings.push(
        `The link named "${resolved.name}" but the listing that opened is "${panel.name}". Check this is the right business before saving.`,
      )
    }

    if (!resolved.isPlace) {
      warnings.unshift(
        `This link opened Google Search, so the listing was found by searching Maps for "${resolved.name}" and confirmed by the website on it (${expectDomain}).`,
      )
    }

    await context.close()
    return {
      url,
      name: panel.name,
      rating: panel.rating,
      reviewCount: panel.reviewCount,
      category: panel.category,
      address: panel.address,
      serviceArea: panel.serviceArea,
      website: panel.website,
      phone: panel.phone,
      hours: panel.hours,
      priceLevel: panel.priceLevel,
      readListing: true,
      warnings,
    }
  } catch (err) {
    return empty(url, `The profile could not be read: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await browser.close().catch(() => {})
  }
}
