import type { Client, ClientLocation } from '../lib/client'
import { isPlaceBasedClient } from '../lib/client'
import { groupByMarket } from '../lib/markets'
import { deriveTrade, splitOffering } from '../lib/trade'
import { normaliseState } from '../onboard/us-states'

/**
 * What to search Google for, about one business.
 *
 * Four kinds of search, because each answers a different question the paid API
 * was going to answer:
 *
 *  - service   "<trade> <town> <ST>" — the head term. This is where the map
 *              pack, the ads and the organic top ten live, so it is what tells
 *              us who holds the market and what a click on it is worth.
 *  - question  the customer questions the AI engines are already asked. Google
 *              answers most of these with an AI Overview, and the sources it
 *              links are the pages it trusts on the topic.
 *  - brand     the business's own name. Whether its own listing and site come
 *              up at all is the floor under everything else.
 *  - reviews   "<name> reviews" — what a customer who already heard of the
 *              business sees before calling it.
 *
 * Nothing here names an industry or a place. Every noun arrives on the client
 * record, exactly as everywhere else.
 */

export type ResearchQueryKind = 'service' | 'question' | 'brand' | 'reviews'

export type ResearchQuery = {
  text: string
  kind: ResearchQueryKind
  locationId: number | null
  /** Google's canonical location name — "Richmond,Virginia,United States" — or ''. */
  searchedFrom: string
}

export type PromptLike = {
  text: string
  intent: string
  locationId: number | null
  isCore: boolean
  isActive: boolean
}

/**
 * Question-set intents that are about the client rather than the topic.
 *
 * "Best <trade> in <town>" is already covered by the service search, which
 * shows the same map pack without the superlative; asking both spends a Google
 * request on the same page twice.
 */
const SKIP_INTENTS = new Set(['comparison', 'brand'])

/** The default size of one research pass. Google tolerates far less than the chat engines. */
export const DEFAULT_RESEARCH_LIMIT = 16

export function buildResearchQueries(input: {
  client: Client
  locations: ClientLocation[]
  prompts: PromptLike[]
  limit?: number
}): ResearchQuery[] {
  const { client, locations } = input
  const limit = input.limit ?? DEFAULT_RESEARCH_LIMIT
  const trade = deriveTrade(client)
  const placeBased = isPlaceBasedClient(client) && locations.length > 0
  const markets = placeBased ? groupByMarket(locations) : []
  const locationById = new Map(locations.map((l) => [l.id, l]))

  const brand: ResearchQuery[] = []
  const service: ResearchQuery[][] = []
  const questions: ResearchQuery[][] = []

  const home = markets[0]?.anchor
  brand.push({
    text: client.name,
    kind: 'brand',
    locationId: home?.id ?? null,
    searchedFrom: home?.dataforseoLocation ?? '',
  })
  brand.push({
    text: `${client.name} reviews`,
    kind: 'reviews',
    locationId: home?.id ?? null,
    searchedFrom: home?.dataforseoLocation ?? '',
  })

  /**
   * Offerings as a customer types them. Detection occasionally leaves a stray
   * number or a town in the list, and a search for either tells us nothing.
   */
  const offerings = client.offerings
    .filter((o) => !/\d/.test(o))
    .filter((o) => splitOffering(o).thing.length >= 3)
    .filter((o) => !locations.some((l) => l.name.toLowerCase() === o.toLowerCase()))

  if (placeBased) {
    for (const m of markets) {
      const anchor = m.anchor
      const abbr = normaliseState(anchor.region || '') ?? ''
      const where = `${anchor.name}${abbr ? ` ${abbr}` : ''}`
      const terms = [trade, ...offerings.slice(0, 3)].filter((t): t is string => !!t)
      service.push(
        [...new Set(terms.map((t) => t.toLowerCase()))].map((t) => ({
          text: `${t} ${where}`,
          kind: 'service' as const,
          locationId: anchor.id,
          searchedFrom: anchor.dataforseoLocation,
        })),
      )
    }
  } else {
    const terms = [...offerings.slice(0, 3).map((o) => `buy ${o} online`), ...(trade ? [trade] : [])]
    service.push(
      [...new Set(terms.map((t) => t.toLowerCase()))].map((t) => ({
        text: t,
        kind: 'service' as const,
        locationId: null,
        searchedFrom: '',
      })),
    )
  }

  /**
   * The engines' questions, grouped by market so a two-market client is not
   * researched in one of them only. Core questions first: they are the ones
   * every run measures, so research on them lines up with the headline number.
   */
  const usable = input.prompts
    .filter((p) => p.isActive && !SKIP_INTENTS.has(p.intent))
    .sort((a, b) => Number(b.isCore) - Number(a.isCore))

  if (markets.length > 0) {
    for (const m of markets) {
      const ids = new Set(m.locations.map((l) => l.id))
      questions.push(
        usable
          .filter((p) => p.locationId != null && ids.has(p.locationId))
          .map((p) => {
            const loc = locationById.get(p.locationId!)
            return {
              text: p.text,
              kind: 'question' as const,
              locationId: p.locationId,
              searchedFrom: loc?.dataforseoLocation ?? '',
            }
          }),
      )
    }
  } else {
    questions.push(
      usable.map((p) => ({ text: p.text, kind: 'question' as const, locationId: null, searchedFrom: '' })),
    )
  }

  /**
   * Interleaved rather than concatenated, so a small limit still covers every
   * kind and every market: a cap that took the first sixteen would spend them
   * all on one town's questions and never search the business's own name.
   */
  const out: ResearchQuery[] = []
  const seen = new Set<string>()
  const add = (q: ResearchQuery | undefined) => {
    if (!q || out.length >= limit) return
    const key = q.text.trim().toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(q)
  }

  add(brand[0])
  const lanes = [...service, ...questions]
  const cursors = lanes.map(() => 0)
  let progressed = true
  let round = 0
  while (out.length < limit && progressed) {
    progressed = false
    for (let i = 0; i < lanes.length; i++) {
      if (cursors[i] < lanes[i].length) {
        add(lanes[i][cursors[i]++])
        progressed = true
      }
    }
    if (round++ === 0) add(brand[1])
  }
  add(brand[1])

  return out
}
