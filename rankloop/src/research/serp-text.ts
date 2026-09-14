/**
 * Reading a Google results page from its rendered TEXT.
 *
 * Same principle as the measurement adapter: Google's markup is generated and
 * reshuffled every few weeks, while the words on the page are what it means and
 * survive redesigns. "People also ask" is always introduced by those words, an
 * ad is always labelled "Sponsored", and a review is always dated "3 weeks ago".
 *
 * Pure functions, kept apart from the browser so they can be checked against a
 * saved page without opening one.
 */

/** Section headings that end whichever block came before them. */
const SECTION_END =
  /^(People also ask|People also search for|Related searches|Things to know|Top stories|Videos|Short videos|Images|Discussions and forums|Perspectives|Places|Local results|More places|Sponsored|Feedback|More results|Next|Footer links|Web results|Search Results|What people are saying|Find results on|Results for .+|AI Overview|Find related products & services|These searches help you find relevant offers from advertisers|Page Navigation|Businesses|More businesses)$/i

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * The questions under "People also ask", verbatim.
 *
 * Google renders each as a single line, usually but not always ending in a
 * question mark ("Signs your fridge is dying"), so the block is read up to the
 * next heading rather than filtered on punctuation.
 */
export function extractPeopleAlsoAsk(text: string): string[] {
  const all = lines(text)
  const out: string[] = []
  for (let i = 0; i < all.length; i++) {
    if (!/^People also ask$/i.test(all[i])) continue
    for (let j = i + 1; j < all.length && j < i + 14; j++) {
      const l = all[j]
      if (SECTION_END.test(l)) break
      if (l.length < 10 || l.length > 160) continue
      // Answer furniture that sits inside the block once one is expanded.
      if (/^(Show more|Show less|More|Search for:|Source:|Feedback)/i.test(l)) continue
      if (/https?:\/\/|›|\.com\b/.test(l)) continue
      if (!/^[A-Z0-9]/.test(l)) continue
      if (!out.includes(l)) out.push(l)
    }
  }
  return out.slice(0, 10)
}

/**
 * The phrases under "People also search for" / "Related searches".
 *
 * Only the LAST such block is read: Google puts a small "People also search for"
 * row inside an expanded result as well, and those are about one page rather
 * than the search.
 */
export function extractRelatedSearches(text: string): string[] {
  const all = lines(text)
  let start = -1
  for (let i = 0; i < all.length; i++) {
    if (/^(People also search for|Related searches)$/i.test(all[i])) start = i
  }
  if (start === -1) return []

  const out: string[] = []
  for (let j = start + 1; j < all.length && out.length < 12; j++) {
    const l = all[j]
    if (SECTION_END.test(l)) break
    if (/^\d+$/.test(l)) break // pagination
    if (l.length < 3 || l.length > 90) continue
    if (/https?:\/\/|›/.test(l)) continue
    if (!out.some((o) => o.toLowerCase() === l.toLowerCase())) out.push(l)
  }
  return out
}

/** Paid results on the page: each is labelled "Sponsored" on a line of its own. */
export function countAds(text: string): number {
  return lines(text).filter((l) => /^Sponsored$/i.test(l)).length
}

/**
 * "3 weeks ago" as a number of days.
 *
 * Maps only ever gives a relative date, and a coarse one — "a month ago" covers
 * anything from four to seven weeks. Each unit is read at its lower bound so a
 * count of reviews "in the last 30 days" is never inflated by rounding.
 */
export function relativeAgeDays(raw: string): number | null {
  const m = raw
    .trim()
    .toLowerCase()
    // Stars and a "New" badge can share the line; review prose never starts with the date.
    .replace(/^[^a-z0-9]*(?:new\s+)?/, '')
    .match(/^(?:edited\s+)?(a|an|one|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago(?:\s+on\s+google)?$/)
  if (!m) return null
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1
  const unit = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }[
    m[2] as 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
  ]
  return n * unit
}

/** Every review date on a Maps reviews panel, as days old, newest first. */
export function reviewAges(text: string): number[] {
  return lines(text)
    .map(relativeAgeDays)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)
}

/**
 * Google's `uule` parameter: search as though standing in a named place.
 *
 * This is the one thing the DataForSEO decision report said browser automation
 * could not do. It can — Google reads an encoded canonical location name from
 * the URL and localises the map pack, the ads and the AI Overview to it. The
 * name is the same string DataForSEO takes ("Richmond,Virginia,United States"),
 * which the locations table already stores for every town.
 *
 * Encoding: a fixed prefix, one character giving the name's length, then the
 * name in base64.
 */
const UULE_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function uuleFor(canonicalName: string): string | null {
  const name = canonicalName.trim()
  if (!name) return null
  const length = Buffer.byteLength(name, 'utf8')
  if (length >= UULE_KEY.length) return null
  return `w+CAIQICI${UULE_KEY[length]}${Buffer.from(name, 'utf8').toString('base64')}`
}

/** The results URL for a query, pinned to a place when one is given. */
export function searchUrl(query: string, canonicalLocation: string): string {
  const params = new URLSearchParams({ q: query, hl: 'en', gl: 'us', pws: '0' })
  let url = `https://www.google.com/search?${params.toString()}`
  const uule = uuleFor(canonicalLocation)
  // Appended raw: URLSearchParams would encode the '+' the format depends on.
  if (uule) url += `&uule=${uule}`
  return url
}

export type PackEntry = {
  title: string
  rating: number | null
  ratingCount: number | null
  url: string | null
  position: number
}

/** "1.3K" as 1300, "1,398" as 1398. A "K" count is Google's rounding, not ours. */
function countOf(raw: string): number | null {
  const m = raw.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(K)?$/i)
  if (!m) return null
  return Math.round(Number(m[1]) * (m[2] ? 1000 : 1))
}

/**
 * Map-pack entries, in either of the two shapes Google has served:
 *
 *   Appliance Doctor Inc        Mr. E Appliance Service
 *   4.8                         4.5(310) · Appliance repair service
 *   (115)
 *
 * Read only inside the block headed "Businesses" or "Places", so a rated
 * directory result further down the page ("Yelp … 3.4(1,398)") is never taken
 * for a business in the pack. An entry straight after "Sponsored" is an ad and
 * is skipped: a paid slot is not a place the client failed to earn.
 */
export function extractMapPack(text: string): PackEntry[] {
  const all = lines(text)
  const start = all.findIndex((l) => /^(Businesses|Places|Local results)$/i.test(l))
  const block = start === -1 ? all : all.slice(start + 1)
  const end = block.findIndex((l) => /^(More businesses|More places|Web results|People also ask|Have AI get prices)$/i.test(l))
  const scope = start === -1 ? all : end === -1 ? block.slice(0, 60) : block.slice(0, end)

  const out: PackEntry[] = []
  const push = (name: string, rating: string, count: string, prev: string | undefined) => {
    if (name.length < 3 || name.length > 80 || !/^[A-Z0-9]/.test(name)) return
    if (/^(sponsored|ads?|rating|reviews?|website|directions|top |people also|schedule)/i.test(name)) return
    if (prev && /^Sponsored$/i.test(prev)) return
    if (out.some((e) => e.title === name)) return
    out.push({ title: name, rating: Number(rating), ratingCount: countOf(count), url: null, position: out.length + 1 })
  }

  for (let i = 1; i < scope.length; i++) {
    const inline = scope[i].match(/^([0-5](?:\.\d)?)\s*\((\d[\d.,]*K?)\)/i)
    // Outside a headed block, a one-line rating is as likely to be a directory result.
    if (inline && start !== -1) {
      push(scope[i - 1], inline[1], inline[2], scope[i - 2])
      continue
    }
    if (/^[0-5](?:\.\d)?$/.test(scope[i]) && /^\(\d[\d.,]*K?\)$/i.test(scope[i + 1] ?? '')) {
      push(scope[i - 1], scope[i], scope[i + 1].replace(/[()]/g, ''), scope[i - 2])
    }
  }
  return out.slice(0, 5)
}

/**
 * The organic results, read from the address line every result prints.
 *
 * Google now links results through its own "/goto" redirect, so an anchor's
 * href no longer says where a result goes — the printed address does:
 *
 *   Appliance Repair Services In Richmond, VA     ← title
 *   Mr. Appliance                                 ← site name
 *   https://www.mrappliance.com › richmond        ← address
 */
export type OrganicEntry = { title: string; url: string; domain: string; position: number; siteName?: string }

export function extractOrganic(text: string): OrganicEntry[] {
  const all = lines(text)
  const from = Math.max(0, all.findIndex((l) => /^Search Results$/i.test(l)))
  const out: OrganicEntry[] = []
  for (let i = from + 2; i < all.length && out.length < 10; i++) {
    const m = all[i].match(/^(https?:\/\/[^\s›]+)/)
    if (!m) continue
    let domain = ''
    try {
      domain = new URL(m[1]).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    if (/(^|\.)google\./.test(domain)) continue
    const title = all[i - 2]
    if (!title || /^https?:/.test(title) || SECTION_END.test(title)) continue
    if (out.some((o) => o.domain === domain && o.title === title)) continue
    // The "› a › b" trail is a breadcrumb, often elided, not a real path — the origin is what is known.
    const siteName = all[i - 1] && !/^https?:/.test(all[i - 1]) ? all[i - 1].split(' · ')[0] : undefined
    out.push({ title, url: m[1], domain, position: out.length + 1, siteName })
  }
  return out
}
