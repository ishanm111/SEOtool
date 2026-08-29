import type { ClientLocation } from './client'

/**
 * A market is a group of places that compete as one search result.
 *
 * A business is rarely visible "in general" — it is visible in one place and
 * invisible in another. Two branches a hundred miles apart are two separate
 * contests: different rivals, a different map pack, a different set of answers.
 * Averaging them into one percentage hides exactly the fact the client is
 * paying to learn, so every measurement that can be split by market is.
 *
 * The grouping key is the location's `metro` — the label an operator sets for a
 * trading area ("Richmond", "Northern Virginia"). It falls back to the region
 * (usually the state) and then to the place's own name, so a client onboarded
 * without any market labels still gets sensible groups rather than none.
 */
export type Market = {
  /** Stable, lowercase key for joins and maps. */
  key: string
  /** How the market is written in a report. */
  label: string
  /** The place every market-wide question is asked about. */
  anchor: ClientLocation
  locations: ClientLocation[]
}

export const marketKeyOf = (l: ClientLocation): string =>
  (l.metro || l.region || l.name).trim().toLowerCase()

export const marketLabelOf = (l: ClientLocation): string => (l.metro || l.region || l.name).trim()

/**
 * Groups locations into markets, preserving the order they were added in.
 *
 * Order is load-bearing: the first market is the one the client thinks of as
 * home, and it is what a single-market report is written about.
 */
export function groupByMarket(locations: ClientLocation[]): Market[] {
  const out: Market[] = []
  const byKey = new Map<string, Market>()

  for (const l of locations) {
    const key = marketKeyOf(l)
    const existing = byKey.get(key)
    if (existing) {
      existing.locations.push(l)
      continue
    }
    const market: Market = { key, label: marketLabelOf(l), anchor: l, locations: [l] }
    byKey.set(key, market)
    out.push(market)
  }

  return out
}

/** True when this client trades in more than one place — the case worth splitting. */
export const isMultiMarket = (locations: ClientLocation[]) => groupByMarket(locations).length > 1
