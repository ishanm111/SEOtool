import * as cheerio from 'cheerio'
import { splitContent } from '../ingest/split'
import { isFaqType, isLocalBusinessType } from '../lib/schema-types'
import { countStats, countSuperlatives, readingEase, wordCount } from '../ingest/score'
import { deriveAliases } from '../lib/client'

/**
 * Crawls a competitor's site the way an AI engine would read it, and measures
 * the same things we measure on the client's site — so the two are directly
 * comparable. Deliberately shallow and polite: sitemap plus a handful of pages.
 */

const UA = 'SEOmyze/0.1 (competitive research; respects robots)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * National franchises and chains appear in AI answers, but their page counts run
 * into the tens of thousands. Averaging them in with local operators produces a
 * target no small business could hit, and hides the real one.
 *
 * Detected structurally rather than by name, so it holds in any industry: a site
 * with thousands of pages, or location pages covering a whole country, is not a
 * local competitor regardless of what it sells.
 */
const NATIONAL_PAGE_COUNT = 1000
const NATIONAL_LOCATION_PAGES = 100

export function isNationalChain(profile: { pageCount: number; cityPageCount: number }): boolean {
  return profile.pageCount >= NATIONAL_PAGE_COUNT || profile.cityPageCount >= NATIONAL_LOCATION_PAGES
}

const SITEMAP_CANDIDATES = [
  '/sitemap_index.xml', '/sitemap.xml', '/wp-sitemap.xml',
  '/page-sitemap.xml', '/sitemap-index.xml',
]

async function get(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** Follows sitemap-index files one level down to reach the real URL lists. */
async function collectSitemapUrls(origin: string): Promise<string[]> {
  const urls = new Set<string>()

  for (const path of SITEMAP_CANDIDATES) {
    const xml = await get(origin + path)
    if (!xml) continue

    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
    const nested = locs.filter((u) => /\.xml($|\?)/i.test(u))
    const pages = locs.filter((u) => !/\.xml($|\?)/i.test(u))

    pages.forEach((u) => urls.add(u))

    for (const child of nested.slice(0, 6)) {
      const childXml = await get(child)
      if (!childXml) continue
      for (const m of childXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        if (!/\.xml($|\?)/i.test(m[1])) urls.add(m[1])
      }
      await sleep(300)
    }

    if (urls.size > 0) break
  }

  return [...urls]
}

function schemaTypesFrom(html: string): string[] {
  const $ = cheerio.load(html)
  const types = new Set<string>()

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text())
      const walk = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(walk)
        if (node && typeof node === 'object') {
          const obj = node as Record<string, unknown>
          const t = obj['@type']
          if (typeof t === 'string') types.add(t)
          else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x))
          Object.values(obj).forEach(walk)
        }
      }
      walk(parsed)
    } catch {
      // malformed JSON-LD is common in the wild — skip it
    }
  })

  // Legacy microdata still counts as structured data
  $('[itemtype]').each((_, el) => {
    const t = $(el).attr('itemtype')?.split('/').pop()
    if (t) types.add(t)
  })

  return [...types].sort()
}

function phonesFrom(html: string): string[] {
  const text = cheerio.load(html).root().text()
  const found = new Set<string>()
  for (const m of text.matchAll(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g)) {
    found.add(m[0].replace(/\s+/g, ' ').trim())
  }
  return [...found].slice(0, 5)
}

/** A question heading is the strongest signal of a real FAQ block. */
function countFaqBlocks(html: string): number {
  const $ = cheerio.load(html)
  let n = 0
  $('h2, h3, h4, summary, dt, .faq-question, [class*="accordion"] [class*="title"]').each((_, el) => {
    const t = $(el).text().trim()
    if (t.length > 10 && t.length < 200 && /\?\s*$/.test(t)) n++
  })
  return n
}

export type CompetitorProfile = {
  domain: string
  /** Sitemap is authoritative; homepage-links undercounts and should be labelled. */
  discoveredVia: 'sitemap' | 'homepage-links'
  pageCount: number
  cityPageCount: number
  cityPages: string[]
  schemaTypes: string[]
  hasLocalBusiness: boolean
  hasFaqSchema: boolean
  faqBlockCount: number
  avgReadability: number
  statsPerThousand: number
  superlativeCount: number
  sampleWordCount: number
  phones: string[]
  ok: boolean
  error?: string
}

/**
 * @param locationNames Towns the client serves. A competitor URL containing one
 *   of these is counted as a location page. Passing an empty array (an online
 *   store) simply yields zero location pages, which is correct — location pages
 *   are not a thing an ecommerce competitor is judged on.
 */
export async function profileCompetitor(
  domain: string,
  locationNames: string[] = [],
  samplePages = 5,
): Promise<CompetitorProfile> {
  const base: CompetitorProfile = {
    domain, discoveredVia: 'sitemap', pageCount: 0, cityPageCount: 0, cityPages: [], schemaTypes: [],
    hasLocalBusiness: false, hasFaqSchema: false, faqBlockCount: 0,
    avgReadability: 0, statsPerThousand: 0, superlativeCount: 0,
    sampleWordCount: 0, phones: [], ok: false,
  }

  const origin = `https://${domain}`
  const home = await get(origin)
  if (!home) return { ...base, error: 'homepage unreachable' }

  let sitemapUrls = await collectSitemapUrls(origin)

  // No sitemap is common on small hand-built sites. Fall back to the homepage's
  // own internal links — an undercount, but far better than reporting zero pages
  // and quietly excluding a real competitor from the comparison.
  let discoveredVia: 'sitemap' | 'homepage-links' = 'sitemap'
  if (sitemapUrls.length === 0) {
    discoveredVia = 'homepage-links'
    const $ = cheerio.load(home)
    const found = new Set<string>()
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')
      if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return
      try {
        const abs = new URL(href, origin)
        if (abs.hostname.replace(/^www\./, '') !== domain.replace(/^www\./, '')) return
        if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|webp)$/i.test(abs.pathname)) return
        abs.hash = ''
        abs.search = ''
        found.add(abs.toString().replace(/\/$/, ''))
      } catch {
        // malformed href — skip
      }
    })
    sitemapUrls = [...found]
  }
  // Match on the client's own service area, in both "glen allen" and
  // "glen-allen" forms, since slugs hyphenate what prose spaces.
  const placeSlugs = locationNames.flatMap((n) => {
    const lower = n.toLowerCase().trim()
    return [lower.replace(/\s+/g, '-'), lower.replace(/\s+/g, '')]
  })
  const cityPages =
    placeSlugs.length === 0
      ? []
      : sitemapUrls.filter((u) => {
          const slug = u.toLowerCase()
          return placeSlugs.some((p) => slug.includes(p))
        })

  // Sample the homepage plus city pages first — those are the ones AI quotes for
  // local queries, so they are the fair comparison against our generated pages.
  const toFetch = [origin, ...cityPages.slice(0, samplePages)]
  const htmls: string[] = [home]
  for (const url of toFetch.slice(1)) {
    const h = await get(url)
    if (h) htmls.push(h)
    await sleep(600)
  }

  const allSchema = new Set<string>()
  let faqBlocks = 0
  let totalWords = 0
  let totalStats = 0
  let totalSupers = 0
  const readabilities: number[] = []
  const phones = new Set<string>()

  for (const html of htmls) {
    schemaTypesFrom(html).forEach((t) => allSchema.add(t))
    faqBlocks += countFaqBlocks(html)
    phonesFrom(html).forEach((p) => phones.add(p))

    const { plainText, blocks } = splitContent(html)
    const words = wordCount(plainText)
    totalWords += words
    totalStats += countStats(plainText)
    totalSupers += countSuperlatives(plainText)
    for (const b of blocks) {
      if (b.text.split(/\s+/).length >= 40) readabilities.push(readingEase(b.text))
    }
  }

  const types = [...allSchema]
  return {
    domain,
    discoveredVia,
    pageCount: sitemapUrls.length,
    cityPageCount: cityPages.length,
    cityPages: cityPages.slice(0, 40),
    schemaTypes: types,
    hasLocalBusiness: types.some(isLocalBusinessType),
    hasFaqSchema: types.some(isFaqType),
    faqBlockCount: faqBlocks,
    avgReadability: readabilities.length
      ? Math.round((readabilities.reduce((a, b) => a + b, 0) / readabilities.length) * 10) / 10
      : 0,
    statsPerThousand: totalWords ? Math.round((totalStats / totalWords) * 1000 * 10) / 10 : 0,
    superlativeCount: totalSupers,
    sampleWordCount: totalWords,
    phones: [...phones],
    ok: true,
  }
}

/**
 * Tying a domain the engines cited to the business name they wrote in prose.
 *
 * These arrive separately and have to be reunited: a citation is a link, a
 * mention is a phrase in a sentence, and only together do they say "this rival
 * was named nine times and here is their site". Matching them used to compare
 * the first ten characters of the compacted full name against the domain, which
 * fails exactly where the client matcher failed — nobody registers a domain
 * containing their whole name. "Spec's Wines, Spirits & Finer Foods" trades at
 * specsonline.com, and the tool recorded them as never mentioned.
 *
 * So the same shortened forms the client is matched by are tried here, and the
 * strongest match wins rather than the first one found. A weak match is refused
 * outright: a competitor row carrying another business's mention count is worse
 * than one carrying none, because it is read as a measurement.
 */

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** "specsonline.com" -> "specsonline". */
export function domainSlug(domain: string): string {
  return compact(domain.replace(/\.[a-z.]+$/, ''))
}

/**
 * How strongly a name matches a domain. Zero means no.
 *
 * Scored rather than boolean so the best candidate can be chosen when several
 * names could plausibly belong to one domain — which happens constantly, since
 * the engines write a chain's name three different ways in one answer.
 */
export function nameDomainScore(name: string, slug: string): number {
  if (!slug) return 0
  const keys = [...new Set(deriveAliases(name).map(compact))]

  let best = 0
  for (const key of keys) {
    if (key === slug) best = Math.max(best, 100)
    // The name, or a shortened form of it, inside the domain.
    else if (key.length >= MIN_OVERLAP && slug.includes(key)) best = Math.max(best, 80)
    // The domain inside the name — "twinliquors" in "twin liquors houston".
    else if (slug.length >= MIN_OVERLAP && key.includes(slug)) best = Math.max(best, 75)
  }

  return best
}

/**
 * How much of a name and a domain must coincide.
 *
 * Eight characters, because everything shorter is a place or a trade: matching
 * on the first word alone tied a local news site, pasadenanow.com, to "Pasadena
 * Liquor Warehouse", and "houston" inside "Houston Plumbing" to the city's own
 * .gov. Both were plausible-looking and both were wrong, and a competitor row
 * carrying another business's mention count is read as a measurement.
 *
 * The cost is real and worth paying: a business whose domain shares nothing
 * with its name — Spec's, trading at specsonline.com — is left unmatched rather
 * than guessed at. `--add=domain.com` names those by hand, which is the only
 * honest way to know.
 */
const MIN_OVERLAP = 8


/** The lowest score worth recording. Below it, the row is left unnamed. */
export const NAME_MATCH_FLOOR = 40

/**
 * The best name for a domain out of the ones the engines actually wrote.
 *
 * Ties break towards the name mentioned most often, because that is the form
 * an engine settled on rather than a passing variant.
 */
export function matchNameToDomain(
  domain: string,
  names: Iterable<[string, number]>,
): { name: string; mentions: number; score: number } | null {
  const slug = domainSlug(domain)
  let best: { name: string; mentions: number; score: number } | null = null

  for (const [name, mentions] of names) {
    const score = nameDomainScore(name, slug)
    if (score < NAME_MATCH_FLOOR) continue
    if (!best || score > best.score || (score === best.score && mentions > best.mentions)) {
      best = { name, mentions, score }
    }
  }

  return best
}
