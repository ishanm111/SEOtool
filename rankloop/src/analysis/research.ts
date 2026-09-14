import { NOT_A_DIRECT_COMPETITOR } from '../config'
import type { Client } from '../lib/client'
import { isPlaceBasedClient } from '../lib/client'
import type { NewFinding } from './findings'
import { isNavigational, isOnTopic, topicWords } from '../research/relevance'

/**
 * Findings from the Google research pass: what Google shows the business's
 * customers, and what that says the website should change.
 *
 * Each finding is a decision, not a statistic. "The AI Overview cited these
 * five sites" becomes "these are the pages to study and the directories to be
 * listed on"; "People also ask these questions" becomes "the site answers none
 * of them — these are the headings to add".
 *
 * Nothing here names a business, place or industry. Every noun arrives through
 * the rows.
 */

export type SnapshotRow = {
  query: string
  queryKind: string
  ok: boolean
  aiOverviewText: string
  aiOverviewSources: string
  clientInAiOverview: boolean
  clientCitedInAiOverview: boolean
  localPack: string
  clientPackPosition: number | null
  organic: string
  clientOrganicPosition: number | null
  peopleAlsoAsk: string
  relatedSearches: string
  suggestions: string
  adsCount: number
}

export type ProfileRow = {
  businessName: string
  isClient: boolean
  ok: boolean
  rating: number | null
  reviewCount: number | null
  reviewsLast30Days: number | null
  newestReviewDays: number | null
  unclaimed: boolean | null
  website: string | null
}

type PageLike = { url: string; title: string; text: string }

const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const list = (items: string[], max = 6) =>
  items.slice(0, max).join('; ') + (items.length > max ? `; +${items.length - max} more` : '')

const WORDS_TO_IGNORE = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'are', 'do', 'does',
  'can', 'how', 'what', 'why', 'when', 'which', 'who', 'my', 'your', 'you', 'i', 'it', 'if', 'be',
  'much', 'long', 'should', 'with', 'from', 'near', 'me', 'there', 'that', 'this', 'get', 'will',
])

const contentWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !WORDS_TO_IGNORE.has(w))

/**
 * Whether the site already answers a question.
 *
 * The question's content words have to appear close together — inside one
 * stretch of about fifty words, or in a page title — not merely somewhere on
 * the page. A site that mentions "freezer" in its menu and "cost" in its
 * footer has not answered what a freezer repair costs, and counting it as
 * answered was how a first pass reported ten of fourteen questions covered.
 */
const WINDOW = 50

export function siteAnswers(question: string, pages: PageLike[], placeWords: Set<string>): boolean {
  const need = [...new Set(contentWords(question))].filter((w) => !placeWords.has(w))
  if (need.length === 0) return true
  const threshold = Math.max(1, Math.ceil(need.length * 0.8))
  const stem = (w: string) => w.replace(/s$/, '')
  const wanted = new Set(need.map(stem))

  return pages.some((p) => {
    const titleWords = new Set(contentWords(p.title).map(stem))
    if ([...wanted].filter((w) => titleWords.has(w)).length >= threshold) return true

    const words = contentWords(p.text).map(stem)
    const counts = new Map<string, number>()
    let present = 0
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (wanted.has(w)) {
        if ((counts.get(w) ?? 0) === 0) present++
        counts.set(w, (counts.get(w) ?? 0) + 1)
      }
      if (i >= WINDOW) {
        const old = words[i - WINDOW]
        if (wanted.has(old)) {
          counts.set(old, (counts.get(old) ?? 0) - 1)
          if (counts.get(old) === 0) present--
        }
      }
      if (present >= threshold) return true
    }
    return false
  })
}

export function buildResearchFindings(input: {
  client: Client
  snapshots: SnapshotRow[]
  profiles: ProfileRow[]
  pages: PageLike[]
  placeNames: string[]
}): NewFinding[] {
  const { client, pages } = input
  const snaps = input.snapshots.filter((s) => s.ok)
  const out: NewFinding[] = []
  if (snaps.length === 0) return out

  const placeWords = new Set(input.placeNames.flatMap(contentWords))
  const topic = topicWords(client)
  /** Every business Google showed, so a search for one of them is never read as a topic. */
  const businessNames = [
    ...new Set(
      snaps.flatMap((s) => [
        ...parse<{ title: string }[]>(s.localPack, []).map((e) => e.title),
        ...parse<{ siteName?: string }[]>(s.organic, []).map((o) => o.siteName ?? ''),
      ]),
    ),
  ].filter(Boolean)
  const isLocal = isPlaceBasedClient(client)
  const topicSearches = snaps.filter((s) => s.queryKind === 'service' || s.queryKind === 'question')

  // ── 1. The AI Overview: whether Google's AI names the business, and whose pages it trusts instead.
  const withAio = topicSearches.filter((s) => s.aiOverviewText)
  if (withAio.length > 0) {
    const named = withAio.filter((s) => s.clientInAiOverview).length
    const cited = withAio.filter((s) => s.clientCitedInAiOverview).length
    const domainCounts = new Map<string, number>()
    for (const s of withAio) {
      const seen = new Set<string>()
      for (const src of parse<{ domain: string; site?: string }[]>(s.aiOverviewSources, [])) {
        // Located by domain where possible, by the name Google gave it where not.
        const key = src.domain || src.site || ''
        if (!key || (src.domain && src.domain.includes(client.domain)) || seen.has(key)) continue
        seen.add(key)
        domainCounts.set(key, (domainCounts.get(key) ?? 0) + 1)
      }
    }
    const ranked = [...domainCounts].sort((a, b) => b[1] - a[1])
    // A directory named rather than located ("Yelp", "Reddit") is still a directory.
    const isDirectory = (d: string) =>
      NOT_A_DIRECT_COMPETITOR.test(d) || NOT_A_DIRECT_COMPETITOR.test(`${d.toLowerCase().replace(/[^a-z]/g, '')}.com`)
    const directories = ranked.filter(([d]) => isDirectory(d))
    const others = ranked.filter(([d]) => !isDirectory(d))
    const fmt = (rows: [string, number][]) => rows.slice(0, 6).map(([d, n]) => `${d} (${n})`).join(', ')

    out.push({
      targetType: 'site',
      category: 'google-ai-overview',
      severity: cited === 0 && named === 0 && withAio.length >= 2 ? 'critical' : cited < withAio.length / 2 ? 'high' : 'medium',
      issue:
        `Google showed an AI Overview on ${withAio.length} of ${topicSearches.length} customer searches. ` +
        `It named ${client.name} in ${named} and linked to the website in ${cited}.` +
        (ranked.length > 0 ? ` It built those answers from other sites instead.` : ''),
      proposedText: [
        others.length > 0
          ? `Study the pages Google's AI trusts for these questions — ${fmt(others)} — and make sure the site answers the same questions as directly: the answer in the first two sentences, a real figure with its source, a FAQ block with FAQPage schema.`
          : null,
        directories.length > 0
          ? `Get listed, with complete details and reviews, on the directories it quotes: ${fmt(directories)}. An overview that cites a directory recommends whoever is listed on it.`
          : null,
      ]
        .filter(Boolean)
        .join(' ') || 'Answer each of these questions directly on the site, with sourced figures and FAQ schema.',
      evidence: list(
        withAio.map(
          (s) =>
            `"${s.query}" → ${s.clientInAiOverview ? 'named' : 'not named'}, sources: ${
              [...new Set(parse<{ domain: string; site?: string }[]>(s.aiOverviewSources, []).map((x) => x.domain || x.site || ''))]
                .filter(Boolean)
                .slice(0, 3)
                .join(', ') || 'none read'
            }`,
        ),
        5,
      ),
    })
  }

  // ── 2. The map pack, on the searches that have one.
  if (isLocal) {
    const withPack = topicSearches.filter((s) => parse<unknown[]>(s.localPack, []).length > 0)
    if (withPack.length > 0) {
      const inPack = withPack.filter((s) => s.clientPackPosition !== null).length
      const holders = new Map<string, number>()
      for (const s of withPack) {
        for (const e of parse<{ title: string }[]>(s.localPack, [])) {
          if (!e.title || client.aliases.some((a) => e.title.toLowerCase().includes(a))) continue
          holders.set(e.title, (holders.get(e.title) ?? 0) + 1)
        }
      }
      if (inPack < withPack.length) {
        out.push({
          targetType: 'offsite',
          category: 'google-map-pack',
          severity: inPack === 0 ? 'critical' : 'high',
          issue:
            `${client.name} is in Google's map pack on ${inPack} of ${withPack.length} customer searches that showed one, searched from inside its own towns. ` +
            `The map pack sits above every website result and is what Google's AI Overview and Gemini draw local recommendations from.`,
          proposedText:
            'The map pack is decided by the Google Business Profile, not the website: complete every field, pick the exact primary category the holders use, add each service by name, attach the website, and ask every recent customer for a review. On the site, make the name, address and phone match the profile character for character, and give each town served a page of its own.',
          evidence: `Holding it instead: ${[...holders].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n} (${c})`).join(', ')}`,
        })
      }
    }
  }

  // ── 3. Organic results: the brand search first, because it is the floor.
  const brand = snaps.find((s) => s.queryKind === 'brand')
  if (brand && (brand.clientOrganicPosition === null || brand.clientOrganicPosition > 3)) {
    out.push({
      targetType: 'site',
      category: 'google-brand-search',
      severity: 'critical',
      issue:
        brand.clientOrganicPosition === null
          ? `Searching Google for the business's own name ("${brand.query}") does not show its website in the top 10.`
          : `Searching Google for the business's own name puts its website at position ${brand.clientOrganicPosition}, below other sites.`,
      proposedText:
        'Put the exact business name in the homepage title tag and H1, add Organization / LocalBusiness schema with the name, logo, phone and sameAs links to every profile, and submit the sitemap in Google Search Console so the homepage is indexed.',
      evidence: `Top results: ${parse<{ domain: string }[]>(brand.organic, []).slice(0, 5).map((o) => o.domain).join(', ') || 'none read'}`,
    })
  }

  const nonBrand = topicSearches
  if (nonBrand.length > 0) {
    const ranking = nonBrand.filter((s) => s.clientOrganicPosition !== null)
    if (ranking.length < nonBrand.length) {
      const rivals = new Map<string, number>()
      for (const s of nonBrand) {
        for (const o of parse<{ domain: string; position: number }[]>(s.organic, []).slice(0, 5)) {
          if (!o.domain || o.domain.includes(client.domain)) continue
          rivals.set(o.domain, (rivals.get(o.domain) ?? 0) + 1)
        }
      }
      const absent = nonBrand.filter((s) => s.clientOrganicPosition === null)
      out.push({
        targetType: 'site',
        category: 'google-organic',
        severity: ranking.length === 0 ? 'high' : 'medium',
        issue: `The website is in Google's top 10 on ${ranking.length} of ${nonBrand.length} customer searches.`,
        proposedText:
          'Each search the site is missing from needs one page that targets it: the search phrase in the title tag and H1, the answer in the opening paragraph, and internal links to it from the homepage and service pages. The new-page and blog-post recommendations are built from these searches.',
        evidence:
          `Not ranking for: ${list(absent.map((s) => `"${s.query}"`), 4)}. ` +
          `Sites ranking most often: ${[...rivals].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, n]) => `${d} (${n})`).join(', ')}`,
      })
    }
  }

  // ── 4. "People also ask": questions Google knows customers ask, that the site never answers.
  const paa = new Map<string, number>()
  for (const s of snaps) {
    for (const q of parse<string[]>(s.peopleAlsoAsk, [])) {
      if (!isOnTopic(q, topic) || isNavigational(q, businessNames)) continue
      paa.set(q, (paa.get(q) ?? 0) + 1)
    }
  }
  const unanswered = [...paa]
    .filter(([q]) => !siteAnswers(q, pages, placeWords))
    .sort((a, b) => b[1] - a[1])
  if (unanswered.length > 0) {
    out.push({
      targetType: 'site',
      category: 'google-people-also-ask',
      severity: unanswered.length >= 5 ? 'high' : 'medium',
      issue:
        `Google's "People also ask" raised ${paa.size} questions across these searches; the website answers ${paa.size - unanswered.length} of them. ` +
        `These are the questions AI Overviews are assembled from.`,
      proposedText:
        'Add each question, word for word, as an H2 or FAQ heading on the most relevant service page, answered in two or three plain sentences directly beneath it, and mark the block up with FAQPage schema. Questions that need more than a paragraph are proposed as blog posts in the recommendations.',
      evidence: list(unanswered.map(([q, n]) => (n > 1 ? `${q} (×${n})` : q)), 8),
    })
  }

  // ── 5. What people type: Google's completions and related searches the site never uses.
  const phrases = new Map<string, number>()
  for (const s of snaps) {
    for (const t of [...parse<string[]>(s.suggestions, []), ...parse<string[]>(s.relatedSearches, [])]) {
      const key = t.toLowerCase().trim()
      if (client.aliases.some((a) => key.includes(a))) continue
      if (!isOnTopic(key, topic) || isNavigational(key, businessNames)) continue
      phrases.set(key, (phrases.get(key) ?? 0) + 1)
    }
  }
  const untargeted = [...phrases]
    .filter(([p]) => !siteAnswers(p, pages.map((pg) => ({ ...pg, text: pg.text.slice(0, 4000) })), placeWords))
    .sort((a, b) => b[1] - a[1])
  if (untargeted.length > 0) {
    out.push({
      targetType: 'site',
      category: 'google-search-demand',
      severity: 'medium',
      issue:
        `Google completes and relates these customer searches to ${phrases.size} phrases; ${untargeted.length} of them appear nowhere on the website. ` +
        `Google only suggests phrases people actually search, so each is real demand — without a volume attached.`,
      proposedText:
        'Use these exact phrases in page titles, headings and opening paragraphs where they match a service the business offers. A phrase for something the business does not do is a signal about what customers want, not a page to write.',
      evidence: list(untargeted.map(([p, n]) => (n > 1 ? `${p} (×${n})` : p)), 10),
    })
  }

  // ── 6. Commercial value: the searches advertisers pay for.
  const paid = topicSearches.filter((s) => s.adsCount > 0).sort((a, b) => b.adsCount - a.adsCount)
  if (paid.length > 0) {
    out.push({
      targetType: 'site',
      category: 'google-paid-searches',
      severity: 'low',
      issue:
        `${paid.length} of ${topicSearches.length} searches carry paid ads. Advertisers only keep paying for searches that turn into customers, so these are the ones worth ranking for first.`,
      proposedText:
        'Work through the fixes for these searches before the others. Every click earned on one of them is a click a competitor is currently buying.',
      evidence: list(paid.map((s) => `"${s.query}" (${s.adsCount} ad${s.adsCount === 1 ? '' : 's'})`), 5),
    })
  }

  // ── 7. The listings: review pace and an unclaimed profile.
  const own = input.profiles.find((p) => p.isClient && p.ok)
  const rivals = input.profiles.filter((p) => !p.isClient && p.ok)
  if (own?.unclaimed) {
    out.push({
      targetType: 'offsite',
      category: 'google-profile-unclaimed',
      severity: 'critical',
      issue: `Google Maps offers "Own this business?" on ${client.name}'s listing — nobody has claimed it, so nobody controls what it says.`,
      proposedText:
        'Claim the listing at business.google.com and verify it. Until then the hours, categories, website link and photos can be edited by anyone, and review replies are impossible.',
    })
  }
  const paced = rivals.filter((r) => r.reviewsLast30Days !== null)
  if (own && own.reviewsLast30Days !== null && paced.length > 0) {
    const sorted = paced.map((r) => r.reviewsLast30Days!).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const leader = [...paced].sort((a, b) => b.reviewsLast30Days! - a.reviewsLast30Days!)[0]
    if (median > own.reviewsLast30Days) {
      out.push({
        targetType: 'offsite',
        category: 'google-review-velocity',
        severity: median - own.reviewsLast30Days >= 4 ? 'high' : 'medium',
        issue:
          `${client.name} gained ${own.reviewsLast30Days} Google review${own.reviewsLast30Days === 1 ? '' : 's'} in the last 30 days. ` +
          `The businesses holding the map pack gained ${median} (median); ${leader.businessName} gained ${leader.reviewsLast30Days}.`,
        proposedText:
          `Ask every customer for a review the day the job is done — a direct link by text message converts far better than a card. Matching the median pace means about ${median} a month; replying to each review is part of what Google counts as an active listing.`,
        evidence: paced
          .map((r) => `${r.businessName}: ${r.rating ?? '?'}★, ${r.reviewCount ?? '?'} reviews, ${r.reviewsLast30Days} in 30 days`)
          .join('; '),
      })
    }
  }

  return out
}
