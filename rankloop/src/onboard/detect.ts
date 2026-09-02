import * as cheerio from 'cheerio'
import type { BusinessType, Platform } from '../config'
import { deriveAliases } from '../lib/client'
import {
  jsonLdSignals,
  parseJsonLd,
  schemaTypesOf,
  visibleWordCount,
  type JsonLdNode,
  type JsonLdSignals,
} from '../lib/jsonld'
import { isLocalBusinessType } from '../lib/schema-types'
import { collectSitemapUrls, get, getJson, linksFromHtml, originOf } from '../lib/sitemap'
import { US_STATES, normaliseState, stateFromAbbreviation } from './us-states'

/**
 * Works out everything the tool needs about a business from its URL alone.
 *
 * Nothing here may assume an industry, a place, or a particular client. Every
 * value is read off the site itself; anything that cannot be read confidently is
 * surfaced for a human to confirm rather than guessed.
 */

export type DetectedPlace = { name: string; state: string; mentions: number }

export type Detection = {
  url: string
  domain: string
  homepageUrl: string
  name: string
  platform: Platform
  apiBase: string | null
  businessType: BusinessType
  businessTypeConfidence: string
  nameCandidates: { value: string; source: string }[]
  aliases: string[]
  phones: string[]
  primaryPhone: string | null
  /** Every place found on the site, with the state it belongs to. */
  places: DetectedPlace[]
  /** States the site mentions, most-referenced first. */
  states: { state: string; mentions: number }[]
  offerings: string[]
  pageCount: number
  schemaTypes: string[]
  warnings: string[]
}

// ── platform ────────────────────────────────────────────────────────────────

async function detectPlatform(
  origin: string,
  html: string,
): Promise<{ platform: Platform; apiBase: string | null }> {
  // WordPress advertises a REST root; confirming it is cheap and definitive.
  const wp = await getJson<{ routes?: unknown }>(`${origin}/wp-json/`)
  if (wp && typeof wp === 'object') return { platform: 'wordpress', apiBase: `${origin}/wp-json/wp/v2` }

  if (/cdn\.shopify\.com|\/cdn\/shop\/|Shopify\.theme|shopify-features/i.test(html)) {
    return { platform: 'shopify', apiBase: origin }
  }
  const products = await getJson<{ products?: unknown[] }>(`${origin}/products.json?limit=1`)
  if (products && Array.isArray(products.products)) return { platform: 'shopify', apiBase: origin }

  if (/wf-page|webflow\.js|data-wf-site/i.test(html)) return { platform: 'webflow', apiBase: null }
  if (/Static\.SQUARESPACE_CONTEXT|squarespace\.com\/universal/i.test(html)) {
    return { platform: 'squarespace', apiBase: null }
  }
  if (/_wixCssIds|static\.wixstatic\.com|wix-code/i.test(html)) return { platform: 'wix', apiBase: null }

  return { platform: 'custom', apiBase: null }
}

// ── structured data ─────────────────────────────────────────────────────────

/**
 * JSON-LD parsing lives in `lib/jsonld` because ingestion needs exactly the same
 * reading of it. A site that states its phone, its service area and its
 * catalogue only in structured data has to be understood identically whether it
 * is being onboarded or crawled.
 */

// ── business type ───────────────────────────────────────────────────────────

function classify(
  html: string,
  urls: string[],
  schemaTypes: string[],
  platform: Platform,
): { businessType: BusinessType; confidence: string; cityStateMentions: number } {
  /**
   * Visible text only. Counting patterns in the raw HTML counts them inside the
   * JSON-LD and the inline scripts too, which is how the same page could be
   * classified on "6 City, ST mentions" and then warned about having none: two
   * different readings of one document, reported as if they were one.
   */
  const $ = cheerio.load(html)
  $('script, style, noscript').remove()
  const visibleText = $.root().text().replace(/\s+/g, ' ')
  const text = visibleText.toLowerCase()
  const paths = urls.map((u) => u.toLowerCase())

  let ecom = 0
  const ecomWhy: string[] = []
  const addE = (n: number, why: string) => {
    ecom += n
    ecomWhy.push(why)
  }

  if (platform === 'shopify') addE(5, 'runs on Shopify')
  if (schemaTypes.some((t) => /^(Product|Offer|AggregateOffer)$/.test(t))) addE(4, 'Product schema')
  const productUrls = paths.filter((p) => /\/products?\//.test(p)).length
  const collectionUrls = paths.filter((p) => /\/(collections?|categor|shop)\//.test(p)).length
  if (productUrls > 2) addE(3, `${productUrls} product URLs`)
  if (collectionUrls > 0) addE(2, `${collectionUrls} collection URLs`)
  if (/add to cart|add to bag|\/cart\b|checkout/i.test(text)) addE(3, 'cart or checkout')
  if (/free shipping|in stock|sold out|sku\b/i.test(text)) addE(1, 'stock or shipping wording')

  let local = 0
  const localWhy: string[] = []
  const addL = (n: number, why: string) => {
    local += n
    localWhy.push(why)
  }

  if (schemaTypes.some(isLocalBusinessType)) addL(4, 'LocalBusiness schema')
  if (schemaTypes.includes('PostalAddress')) addL(2, 'postal address in schema')
  if (/service area|areas we serve|we come to you|serving\s+\w+/i.test(text)) addL(3, 'service-area wording')
  if (/book (?:a|an|now)|schedule (?:a|an|your)|request a quote|free estimate|call for/i.test(text)) {
    addL(3, 'booking or quote wording')
  }
  if (/\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*[-–:]\s*\d/i.test(text)) addL(1, 'opening hours')
  // A "City, ST" pattern in the page text is a strong local signal.
  const cityState = [...visibleText.matchAll(/\b[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?,\s*([A-Z]{2})\b/g)]
  if (cityState.length >= 3) addL(3, `${cityState.length} "City, ST" mentions`)

  const businessType: BusinessType = ecom > local ? 'ecommerce' : 'local_service'
  const winner = businessType === 'ecommerce' ? ecomWhy : localWhy
  const confidence =
    `${businessType} (${businessType === 'ecommerce' ? ecom : local} vs ` +
    `${businessType === 'ecommerce' ? local : ecom}) — ${winner.join(', ') || 'no strong signals, defaulted'}`

  return { businessType, confidence, cityStateMentions: cityState.length }
}

// ── name, phones ────────────────────────────────────────────────────────────

/**
 * Business-name candidates, in descending order of trust, with their source.
 *
 * These disagree more often than you would expect — a site can carry one name in
 * its structured data, another in its title, and a third in its copy. Returning
 * every candidate rather than silently picking one means the operator sees the
 * disagreement, which is itself a finding worth knowing about.
 */
function nameCandidates(html: string, nodes: JsonLdNode[], domain: string): { value: string; source: string }[] {
  const out: { value: string; source: string }[] = []
  const add = (value: string | undefined, source: string) => {
    const v = value?.trim()
    if (!v || v.length < 3 || v.length > 80) return
    if (out.some((c) => c.value.toLowerCase() === v.toLowerCase())) return
    out.push({ value: v, source })
  }

  const $ = cheerio.load(html)

  // og:site_name is ranked first because it is the one field authored to hold
  // exactly the site's name. A <title> carries page names, separators and SEO
  // padding, and frequently arrives mangled.
  add($('meta[property="og:site_name"]').attr('content'), 'og:site_name')

  const title = $('title').text().trim()
  if (title) {
    const parts = title
      .split(/\s[|–—]\s|\s-\s|[|–—]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 2 && !/^(home|welcome)$/i.test(p))
    // The business name is usually the tail of a "Page | Business" title.
    add(parts.length > 1 ? parts[parts.length - 1] : parts[0], 'page title')
  }

  for (const n of nodes) {
    const t = n['@type']
    const isOrg =
      (typeof t === 'string' && /Organization|LocalBusiness|Store|Corporation/.test(t)) ||
      (Array.isArray(t) && t.some((x) => typeof x === 'string' && /Organization|LocalBusiness|Store/.test(x)))
    if (isOrg && typeof n.name === 'string') add(n.name, 'structured data')
  }

  add(domain.replace(/\.[a-z.]+$/, '').replace(/[-_]/g, ' '), 'domain name')
  return out
}

function extractPhones(text: string): string[] {
  const counts = new Map<string, number>()
  for (const m of text.matchAll(/\(?\b\d{3}\)?[\s.–-]\d{3}[\s.–-]\d{4}\b/g)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length !== 10) continue
    // Reject obvious non-numbers: dates, prices, repeated digits.
    if (/^(\d)\1{9}$/.test(digits)) continue
    const pretty = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    counts.set(pretty, (counts.get(pretty) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
}

// ── geography ───────────────────────────────────────────────────────────────

/**
 * Words that can precede a place name in page copy but never start one.
 * "The" is deliberately excluded: "The Woodlands" and "The Colony" are real US
 * towns, and stripping it would corrupt them.
 */
const CITY_PREFIX_NOISE = new Set([
  'us', 'all', 'in', 'to', 'at', 'near', 'from', 'and', 'or', 'our', 'your', 'my',
  'we', 'call', 'visit', 'contact', 'about', 'home', 'page', 'serving', 'serve',
  'areas', 'area', 'service', 'services', 'repair', 'best', 'top', 'local',
  'welcome', 'around', 'throughout', 'across', 'greater',
])

/**
 * Parent path segments that mean "everything below me is a place".
 *
 * Sites group location pages under a folder far more often than not
 * ("/service-area/katy/", "/locations/dallas/"), which makes the URL structure a
 * more reliable place-finder than the page text — a location page does not
 * always write its town as "Katy, TX", but it is always filed under the folder.
 */
const LOCATION_PARENTS =
  /^(service[-_]?areas?|locations?|areas?|areas[-_]we[-_]serve|cities|city|our[-_]locations?|coverage|regions?|towns?|where[-_]we[-_]serve)$/

/** Multi-word nav slugs that are site furniture, not something the business sells. */
const NAV_PHRASES = new Set([
  'about us', 'contact us', 'write reviews', 'write a review', 'service area',
  'service areas', 'our services', 'our work', 'privacy policy', 'terms of service',
  'terms and conditions', 'refund policy', 'shipping policy', 'get a quote',
  'book now', 'free estimate', 'customer reviews', 'meet the team', 'our team',
  'frequently asked questions', 'thank you', 'not found',
])

/** Words that look like place names in a slug but are not. */
const SLUG_STOPWORDS = new Set([
  'about', 'contact', 'services', 'service', 'blog', 'home', 'reviews', 'faq',
  'privacy', 'terms', 'cart', 'checkout', 'account', 'search', 'shop', 'products',
  'collections', 'category', 'news', 'gallery', 'careers', 'sitemap', 'pricing',
])

/**
 * Finds every place the site mentions and which state it belongs to.
 *
 * Two sources, both read from the site itself:
 *  1. "City, ST" in the visible text — unambiguous
 *  2. Page slugs that match a city already seen with a state
 *
 * Nothing is assumed about which places are correct. That judgement is left to
 * the operator, because a site can legitimately serve several states.
 */
function extractPlaces(
  documents: string[],
  urls: string[],
): { places: DetectedPlace[]; states: { state: string; mentions: number }[] } {
  const cityCounts = new Map<string, { state: string; mentions: number }>()
  const stateCounts = new Map<string, number>()

  for (const html of documents) {
    const $ = cheerio.load(html)
    $('script, style, noscript').remove()
    const text = $.root().text().replace(/\s+/g, ' ')

    // 1. "City, ST" and "City, State name" — the only unambiguous signal.
    for (const m of text.matchAll(
      /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2}),\s*([A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    )) {
      // Page furniture runs into the place name ("Contact Us Houston, TX",
      // "Serving All Pearland, TX"). Strip leading words that never begin a US
      // place name. "The" is deliberately absent — "The Woodlands" is a real town.
      const words = m[1].trim().split(/\s+/)
      while (words.length > 1 && CITY_PREFIX_NOISE.has(words[0].toLowerCase())) words.shift()
      const city = words.slice(-Math.min(words.length, 3)).join(' ')
      const state = normaliseState(m[2])
      if (!state) continue
      if (city.length < 3 || SLUG_STOPWORDS.has(city.toLowerCase())) continue
      const key = city.toLowerCase()
      const prev = cityCounts.get(key)
      cityCounts.set(key, { state, mentions: (prev?.mentions ?? 0) + 1 })
      stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1)
    }

    // 2. Bare state names. Excluded when followed by a capitalised word, because
    //    "Missouri City" is a town in Texas, not a mention of Missouri.
    for (const [name, abbr] of Object.entries(US_STATES)) {
      const re = new RegExp(`\\b${name.replace(/\s/g, '\\s+')}\\b(?!\\s+[A-Z])`, 'gi')
      const n = (text.match(re) ?? []).length
      if (n > 0) stateCounts.set(abbr, (stateCounts.get(abbr) ?? 0) + n)
    }
  }

  // 3. Anything filed under a location folder is a place, whether or not the
  //    page ever writes it as "City, ST". Assigned to the site's dominant state,
  //    which the operator confirms before it is used for anything.
  const dominantState = [...stateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (dominantState) {
    for (const url of urls) {
      let parts: string[]
      try {
        parts = new URL(url).pathname.toLowerCase().split('/').filter(Boolean)
      } catch {
        continue
      }
      if (parts.length < 2) continue
      if (!parts.slice(0, -1).some((p) => LOCATION_PARENTS.test(p))) continue

      const slug = parts[parts.length - 1]
      if (SLUG_STOPWORDS.has(slug)) continue
      const key = slug.replace(/[-_]/g, ' ').replace(/\s+\d+$/, '').trim()
      if (key.length < 3) continue
      const prev = cityCounts.get(key)
      cityCounts.set(key, { state: prev?.state ?? dominantState, mentions: (prev?.mentions ?? 0) + 1 })
    }
  }

  // 4. Slugs matching a city we now know about, so location pages get counted.
  for (const url of urls) {
    const slug = url.toLowerCase().replace(/\/$/, '').split('/').pop() ?? ''
    if (!slug || SLUG_STOPWORDS.has(slug)) continue
    const words = slug.replace(/[-_]/g, ' ')
    for (const [key, val] of [...cityCounts.entries()]) {
      if (words.includes(key)) cityCounts.set(key, { ...val, mentions: val.mentions + 1 })
    }
  }

  const places: DetectedPlace[] = [...cityCounts.entries()]
    .map(([name, v]) => ({
      name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
      state: v.state,
      mentions: v.mentions,
    }))
    .sort((a, b) => b.mentions - a.mentions)

  const states = [...stateCounts.entries()]
    .map(([state, mentions]) => ({ state, mentions }))
    .sort((a, b) => b.mentions - a.mentions)

  return { places, states }
}

// ── offerings ───────────────────────────────────────────────────────────────

/**
 * What a store sells, in the words customers use.
 *
 * Product handles are model names ("trino-tubers-onyx"), which nobody searches
 * for and which would generate meaningless questions. Shopify publishes the real
 * category on every product as `product_type`, and collection titles carry the
 * merchandising language on top of that. Both are what a shopper would type.
 */
async function shopifyOfferings(origin: string): Promise<string[]> {
  /**
   * Stores keep dozens of internal collections for merchandising and operations
   * — "all msrp products", "add on essentials", "all shoes - search". They are
   * real collections, but no shopper has ever typed one, so a question built
   * from them measures nothing.
   */
  const isInternal = (t: string) =>
    /^all\b/.test(t) ||
    / - |\bsearch\b|\bmsrp\b|\bessentials\b|\btest\b|\bhidden\b|\bdraft\b|\bstaff\b|\bbundle\b/.test(t) ||
    /\b(sale|clearance|outlet|new in|new arrivals|gift(s|ing)?|discount|code|final|archive|preorder)\b/.test(t) ||
    /\d/.test(t)

  // product_type is the true category — ranked first because it is what the
  // merchant themselves calls the thing.
  const categories = new Set<string>()
  const products = await getJson<{ products?: { product_type?: string }[] }>(
    `${origin}/products.json?limit=250`,
  )
  for (const p of products?.products ?? []) {
    const t = p.product_type?.trim().toLowerCase()
    if (t && t.length > 2 && t.length < 40 && !isInternal(t)) categories.add(t)
  }

  /**
   * When the merchant has filled in product_type properly, that IS the category
   * list and collections add nothing but noise — single-product collections,
   * collaborations and curated "edits" are not things anyone searches for.
   * Collections are only consulted when product_type is empty or unhelpfully thin.
   */
  if (categories.size >= 4) return [...categories]

  const brand = origin.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0]
  const collectionNames = new Set<string>()
  const collections = await getJson<{ collections?: { title?: string }[] }>(
    `${origin}/collections.json?limit=250`,
  )
  for (const c of collections?.collections ?? []) {
    const t = c.title?.trim().toLowerCase()
    if (!t || t.length < 3 || t.length > 30) continue
    if (isInternal(t)) continue
    if (t.split(' ').length > 3) continue
    if (categories.has(t)) continue
    // A collection carrying the brand name is a product line, not a category.
    if (brand.length > 3 && t.includes(brand)) continue
    // Curated edits are named after a person, never after what they contain.
    if (/'s\b|\bedit\b|\bpicks?\b|\bcollab/.test(t)) continue
    collectionNames.add(t)
  }

  return [...categories, ...collectionNames].slice(0, 20)
}

/**
 * What the business sells or does, taken from its own URL structure. Slugs that
 * match a detected place are excluded, so location pages are not mistaken for
 * services.
 */
function extractOfferings(
  urls: string[],
  places: DetectedPlace[],
  platform: Platform,
  domain: string,
): string[] {
  const placeWords = new Set(places.map((p) => p.name.toLowerCase()))
  const counts = new Map<string, number>()
  const domainWords = domain.replace(/\.[a-z.]+$/, '')

  for (const url of urls) {
    let parts: string[]
    try {
      parts = new URL(url).pathname.toLowerCase().split('/').filter(Boolean)
    } catch {
      continue
    }
    const slug = parts[parts.length - 1] ?? ''
    if (!slug || SLUG_STOPWORDS.has(slug)) continue
    if (/^\d+$/.test(slug)) continue
    if (slug.includes(domainWords) || slug.includes('.')) continue

    const phrase = slug.replace(/[-_]/g, ' ').replace(/\.(html?|php|aspx)$/, '').trim()
    if (phrase.length < 4 || phrase.split(' ').length > 5) continue
    if (NAV_PHRASES.has(phrase.replace(/\s+\d+$/, ''))) continue
    if ([...placeWords].some((p) => phrase === p || phrase.includes(` ${p}`) || phrase.startsWith(`${p} `))) continue
    if (placeWords.has(phrase)) continue

    /**
     * On a local business, a bare one-word top-level page is almost always a
     * location ("/katy", "/conroe") rather than a service — services carry what
     * they do in the slug ("dryer-repair", "oven-installation"). Excluding them
     * keeps towns out of the service list even when the page never writes the
     * town as "Katy, TX" and so was never detected as a place.
     */
    // Filed under a location folder — a place, not something the business sells.
    if (parts.slice(0, -1).some((p) => LOCATION_PARENTS.test(p))) continue

    counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
  }

  const ranked = [...counts.keys()]
  // On a store, individual product slugs are noise — categories carry the meaning.
  return platform === 'shopify' ? ranked.slice(0, 40) : ranked.slice(0, 30)
}

/**
 * Picks a spread of pages to read. Shallow URLs first (they carry the important
 * pages), then a spread across the rest so location and service pages both get
 * represented rather than the first 14 alphabetically.
 */
function pickSample(urls: string[], count: number): string[] {
  if (urls.length <= count) return urls
  const byDepth = [...urls].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.length - b.length,
  )
  const head = byDepth.slice(0, Math.ceil(count / 2))
  const rest = byDepth.slice(head.length)
  const stride = Math.max(1, Math.floor(rest.length / (count - head.length)))
  const spread: string[] = []
  for (let i = 0; i < rest.length && spread.length < count - head.length; i += stride) {
    spread.push(rest[i])
  }
  return [...head, ...spread]
}


// ── structured data as a source of truth ────────────────────────────────────

/** One set of signals from every page read, rather than one per page. */
function mergeSignals(all: JsonLdSignals[]): JsonLdSignals {
  const merged: JsonLdSignals = {
    phones: [], places: [], offerings: [], faqs: [], descriptions: [], locality: null, region: null,
  }
  for (const s of all) {
    merged.phones.push(...s.phones)
    merged.offerings.push(...s.offerings)
    merged.faqs.push(...s.faqs)
    merged.descriptions.push(...s.descriptions)
    merged.locality ??= s.locality
    merged.region ??= s.region
    for (const p of s.places) {
      const seen = merged.places.find((x) => x.name.toLowerCase() === p.name.toLowerCase())
      if (seen) seen.state ??= p.state
      else merged.places.push({ ...p })
    }
  }
  merged.phones = [...new Set(merged.phones)]
  merged.offerings = [...new Set(merged.offerings)]
  merged.descriptions = [...new Set(merged.descriptions)]
  return merged
}

/**
 * Folds the places a site declares in its markup into the ones read from its
 * copy.
 *
 * `areaServed` is the business stating its own trading area — a stronger source
 * than a town name that happens to appear in a sentence — but it is only
 * counted once, so a place written into the copy on every page still outranks it
 * when the operator picks a primary location.
 */
function mergeGeo(
  fromText: { places: DetectedPlace[]; states: { state: string; mentions: number }[] },
  signals: JsonLdSignals,
  businessType: BusinessType,
): { places: DetectedPlace[]; states: { state: string; mentions: number }[] } {
  if (businessType !== 'local_service') return fromText

  const places = [...fromText.places]
  const stateCounts = new Map(fromText.states.map((s) => [s.state, s.mentions]))

  for (const p of signals.places) {
    if (!p.state) continue
    const existing = places.find((x) => x.name.toLowerCase() === p.name.toLowerCase())
    if (existing) continue
    places.push({ name: p.name, state: p.state, mentions: 1 })
    stateCounts.set(p.state, (stateCounts.get(p.state) ?? 0) + 1)
  }

  return {
    places: places.sort((a, b) => b.mentions - a.mentions),
    states: [...stateCounts.entries()]
      .map(([state, mentions]) => ({ state, mentions }))
      .sort((a, b) => b.mentions - a.mentions),
  }
}

// ── main ────────────────────────────────────────────────────────────────────

export async function detectClient(input: string): Promise<Detection> {
  const { origin, domain } = originOf(input)
  const warnings: string[] = []

  const html = await get(origin)
  if (!html) throw new Error(`could not reach ${origin}`)

  const { platform, apiBase } = await detectPlatform(origin, html)

  let urls = await collectSitemapUrls(origin)
  if (urls.length === 0) {
    urls = linksFromHtml(html, origin, domain)
    warnings.push(`No sitemap found — page list came from homepage links only (${urls.length} URLs), so it is an undercount.`)
  }

  const nodes = parseJsonLd(html)
  const schemaTypes = schemaTypesOf(nodes)
  const { businessType, confidence, cityStateMentions } = classify(html, urls, schemaTypes, platform)

  const candidates = nameCandidates(html, nodes, domain)
  const name = candidates[0]?.value ?? domain

  /**
   * Sample real pages, not just the homepage. Location pages state their town in
   * the body ("Katy, TX") while the homepage often names only the head office —
   * reading one page would find one place and miss the entire service area.
   */
  // Sample generously on small sites: every unread page is a location or service
  // that gets missed, and these sites are only a few dozen pages to begin with.
  const sample = pickSample(urls, urls.length <= 80 ? 26 : 16)
  const documents = [html]
  for (const url of sample) {
    const page = await get(url, 15000)
    if (page) documents.push(page)
    await new Promise((r) => setTimeout(r, 200))
  }

  const allText = documents
    .map((doc) => {
      const $$ = cheerio.load(doc)
      $$('script, style, noscript').remove()
      return $$.root().text()
    })
    .join(' ')

  /**
   * The structured data on every page read, not just the homepage — a site can
   * publish its catalogue on one page and its service area on another.
   */
  const signals = mergeSignals(documents.map((doc) => jsonLdSignals(parseJsonLd(doc))))

  // Text first: a number shown to customers is the one they call. Anything the
  // markup declares and the copy never shows is still a real number, so it is
  // added rather than ignored.
  const phones = [...new Set([...extractPhones(allText), ...signals.phones])]

  /**
   * Geography is only meaningful for a business that travels to customers. An
   * online store mentions states in shipping tables and store locators, which
   * would produce a long, useless list and a nonsense wrong-geography set.
   */
  const geo =
    businessType === 'local_service'
      ? extractPlaces(documents, urls)
      : { places: [], states: [] }
  const { places, states } = mergeGeo(geo, signals, businessType)

  // A store's real categories come from its product feed, not its URLs.
  let offerings =
    platform === 'shopify' ? await shopifyOfferings(origin) : extractOfferings(urls, places, platform, domain)
  if (offerings.length === 0) offerings = extractOfferings(urls, places, platform, domain)
  /**
   * A site that renders its copy in the browser has no slugs to read a catalogue
   * off — one URL, one empty div. What it does publish is an OfferCatalog and a
   * product list, in the merchant's own category words.
   */
  if (offerings.length === 0) offerings = signals.offerings.slice(0, 30)

  if (schemaTypes.length === 0) warnings.push('No structured data on the homepage at all.')
  if (phones.length === 0 && businessType === 'local_service') {
    warnings.push('No phone number found on the homepage — unusual for a local business.')
  }
  if (phones.length > 1) {
    warnings.push(`${phones.length} different phone numbers on the homepage: ${phones.join(', ')}`)
  }
  /**
   * Said precisely, because the two sources disagree often and the operator is
   * about to make a decision on this. A site can carry the service area only in
   * its markup, only in its copy, or in neither — and "we found nothing" is a
   * different fact from "the copy shows nothing but the markup does".
   */
  if (businessType === 'local_service' && places.length === 0) {
    warnings.push('No place was found in the page copy or the structured data, so the service area could not be read from the site.')
  } else if (businessType === 'local_service' && cityStateMentions === 0) {
    warnings.push(
      `The page copy never writes a place as "City, ST". The service area was read from the structured data instead: ` +
        `${places.slice(0, 6).map((p) => p.name).join(', ')}. Confirm it.`,
    )
  }
  if (visibleWordCount(html) < 50) {
    warnings.push(
      'The homepage serves almost no readable text — its copy is assembled in the browser. ' +
        'Search and AI crawlers that do not run JavaScript see what this tool saw: an empty page.',
    )
  }
  if (states.length > 1) {
    warnings.push(
      `The site mentions ${states.length} states: ${states.map((s) => `${s.state} (${s.mentions})`).join(', ')}. ` +
        'Confirm which the business actually serves — the rest become wrong-geography terms.',
    )
  }

  return {
    url: origin,
    domain,
    homepageUrl: origin + '/',
    name,
    platform,
    apiBase,
    businessType,
    businessTypeConfidence: confidence,
    nameCandidates: candidates,
    aliases: deriveAliases(name),
    phones,
    primaryPhone: phones[0] ?? null,
    places,
    states,
    offerings,
    pageCount: urls.length,
    schemaTypes,
    warnings,
  }
}

/**
 * Places outside the confirmed service states become the wrong-geography term
 * list. Full state names and abbreviations are included, because a site built
 * for the wrong area names the state as often as the towns.
 */
export function deriveWrongGeoTerms(detection: Detection, servedStates: string[]): string[] {
  const served = new Set(servedStates.map((s) => s.toUpperCase()))
  const terms = new Set<string>()

  for (const place of detection.places) {
    if (!served.has(place.state)) terms.add(place.name.toLowerCase())
  }

  for (const { state } of detection.states) {
    if (served.has(state)) continue
    const full = stateFromAbbreviation(state)
    if (full) terms.add(full.toLowerCase())
    terms.add(`, ${state.toLowerCase()}`)
  }

  return [...terms].sort()
}
