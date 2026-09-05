/**
 * ZIP codes, turned into the place names the rest of the tool works in.
 *
 * A service area is often given as a list of ZIP codes — it is how a business
 * thinks about where it works, and how their existing paperwork is written. But
 * nothing downstream can use one: the questions put to the engines read "best
 * appliance repair in 77502", which is not a question anybody asks, and the
 * wrong-geography check compares place names. So a ZIP is resolved to its town
 * and state at the point it is typed, and only the town is ever stored.
 *
 * The lookup is the free Zippopotam service, which needs no key. Nothing is
 * guessed when it cannot be reached: an unresolved ZIP is reported back by
 * number and the save is refused, because a location row reading "77502" would
 * quietly produce a run's worth of questions no customer would ever ask.
 */

/** Five digits, optionally the +4 that nothing here needs. */
const ZIP_PATTERN = /^(\d{5})(?:-\d{4})?$/

export function isZipCode(raw: string): boolean {
  return ZIP_PATTERN.test(raw.trim())
}

export type ZipPlace = {
  /** The five digits as typed, so a failure can be reported in those terms. */
  zip: string
  name: string
  /** Two-letter abbreviation, matching how towns are typed elsewhere. */
  state: string
}

/**
 * Answers already fetched, for the life of the process.
 *
 * A ZIP code's town does not change, and an operator correcting one field of a
 * form should not re-ask the network about the twelve ZIPs they typed earlier.
 */
const cache = new Map<string, ZipPlace | null>()

export async function lookupZip(raw: string, timeoutMs = 8000): Promise<ZipPlace | null> {
  const digits = raw.trim().match(ZIP_PATTERN)?.[1]
  if (!digits) return null
  if (cache.has(digits)) return cache.get(digits) ?? null

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${digits}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      // A 404 is a real answer — that ZIP does not exist — and worth caching.
      // Anything else may be transient, so it is not.
      if (res.status === 404) cache.set(digits, null)
      return null
    }

    const body = (await res.json()) as {
      places?: { 'place name'?: string; 'state abbreviation'?: string }[]
    }
    /**
     * A ZIP can list several place names — the town and the neighbourhoods
     * inside it. The first is the one the postal service considers primary,
     * and the others are the same contest by another name.
     */
    const place = body.places?.[0]
    const name = place?.['place name']?.trim()
    const state = place?.['state abbreviation']?.trim()
    if (!name || !state) {
      cache.set(digits, null)
      return null
    }

    const resolved: ZipPlace = { zip: digits, name, state }
    cache.set(digits, resolved)
    return resolved
  } catch {
    // Offline, or the service is down. Not cached: it may work in a minute.
    return null
  }
}

export type ZipExpansion = {
  /** The list with every ZIP replaced by "Town ST", in the order given. */
  entries: string[]
  /** What each ZIP turned into, so the operator can see it before saving. */
  resolved: ZipPlace[]
  /** ZIPs that could not be looked up, by number. */
  unresolved: string[]
}

/**
 * Replaces the ZIP codes in a typed list of places with their towns.
 *
 * Entries that are not ZIP codes are passed through untouched, so a list may
 * mix the two freely — which is what actually gets typed. A town that arrives
 * twice, once by name and once by ZIP, is kept once.
 */
export async function expandZipEntries(input: string[]): Promise<ZipExpansion> {
  const entries: string[] = []
  const resolved: ZipPlace[] = []
  const unresolved: string[] = []

  // Looked up together: a service area of twenty ZIPs would otherwise be twenty
  // round trips end to end, which is long enough for an operator to give up on.
  const lookups = await Promise.all(
    input.map(async (entry) => (isZipCode(entry) ? await lookupZip(entry) : null)),
  )

  const seen = new Set<string>()
  const push = (entry: string) => {
    const key = entry.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    entries.push(entry)
  }

  input.forEach((entry, i) => {
    const trimmed = entry.trim()
    if (!isZipCode(trimmed)) {
      push(trimmed)
      return
    }
    const place = lookups[i]
    if (!place) {
      unresolved.push(trimmed)
      return
    }
    resolved.push(place)
    push(`${place.name} ${place.state}`)
  })

  return { entries, resolved, unresolved }
}
