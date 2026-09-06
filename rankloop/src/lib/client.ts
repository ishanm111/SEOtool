import { isPlaceBased, sellsProducts, type BusinessType, type Platform } from '../config'
import { ACTIONS, PLACE_NOUNS } from './trade'

/**
 * A client, with its JSON columns already parsed.
 *
 * Everything the pipeline needs to know about a business arrives through this
 * object. No module may reach for a hardcoded name, city, phone number or
 * industry term — if a function needs one, it takes a Client.
 */
export type Client = {
  id: number
  name: string
  domain: string
  homepageUrl: string
  businessType: BusinessType
  platform: Platform
  apiBase: string | null
  aliases: string[]
  phones: string[]
  primaryPhone: string | null
  gbpUrl: string | null
  gbpRating: number | null
  gbpReviewCount: number | null
  gbpHasWebsite: boolean | null
  gbpServiceArea: string | null
  offerings: string[]
  wrongGeoTerms: string[]
}

export type ClientLocation = {
  id: number
  clientId: number
  name: string
  region: string
  metro: string
  dataforseoLocation: string
  isActive: boolean
}

type ClientRow = {
  id: number
  name: string
  domain: string
  homepageUrl: string
  businessType: string
  platform: string
  apiBase: string | null
  aliases: string
  phones: string
  primaryPhone: string | null
  gbpUrl: string | null
  gbpRating: number | null
  gbpReviewCount: number | null
  gbpHasWebsite: boolean | null
  gbpServiceArea: string | null
  offerings: string
  wrongGeoTerms: string
}

const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function hydrateClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    homepageUrl: row.homepageUrl,
    businessType: row.businessType as BusinessType,
    platform: row.platform as Platform,
    apiBase: row.apiBase,
    aliases: parseJson<string[]>(row.aliases, []),
    phones: parseJson<string[]>(row.phones, []),
    primaryPhone: row.primaryPhone,
    gbpUrl: row.gbpUrl,
    gbpRating: row.gbpRating,
    gbpReviewCount: row.gbpReviewCount,
    gbpHasWebsite: row.gbpHasWebsite,
    gbpServiceArea: row.gbpServiceArea,
    offerings: parseJson<string[]>(row.offerings, []),
    wrongGeoTerms: parseJson<string[]>(row.wrongGeoTerms, []),
  }
}

export const isLocalService = (c: Client) => c.businessType === 'local_service'
export const isEcommerce = (c: Client) => c.businessType === 'ecommerce'
export const isLocalRetail = (c: Client) => c.businessType === 'local_retail'

/**
 * The two questions the rest of the pipeline actually asks.
 *
 * A shop with a door on a street answers yes to both, which is the whole reason
 * it is its own kind: it is judged on a map pack like a plumber and on product
 * markup like a store, and every place that tested `=== 'ecommerce'` used to
 * decide one of those for it wrongly.
 */
export const isPlaceBasedClient = (c: Client) => isPlaceBased(c.businessType)
export const sellsProductsClient = (c: Client) => sellsProducts(c.businessType)
export const hasGoogleProfile = (c: Client) => c.gbpRating !== null || c.gbpUrl !== null

/**
 * Name variants for matching a business inside AI answer prose.
 *
 * Generated rather than hand-listed, because businesses are inconsistent about
 * their own name: apostrophes, ampersands, spacing and hyphens all vary between
 * a website title and a Google listing. Missing one variant means a mention is
 * scored as absent, which is the worst possible failure for this tool.
 */
export function deriveAliases(name: string): string[] {
  const base = name.toLowerCase().trim()
  const out = new Set<string>([base])

  const noPunct = base.replace(/[.,''`]/g, '')
  out.add(noPunct)
  out.add(noPunct.replace(/\s*&\s*/g, ' and '))
  out.add(noPunct.replace(/\s+and\s+/g, ' & '))
  out.add(noPunct.replace(/[\s-]+/g, ''))
  out.add(noPunct.replace(/\s+/g, '-'))

  const trimmed = noPunct
    .replace(/\b(llc|inc\.?|co\.?|corp\.?|ltd\.?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (trimmed.length >= 4) out.add(trimmed)

  /**
   * The shorter names an engine actually writes.
   *
   * Nobody types a business's full registered name into an answer, and the
   * engines do not either: Perplexity wrote "El Barrilito Liquor" for a shop
   * recorded as "El Barrilito Liquor Store", and the mention was scored as
   * absent — which is the worst failure this tool has, because it under-reports
   * the one number the client is paying to move.
   *
   * Two steps, both only from the end of the name:
   *
   *  1. Drop the trade noun a business names itself with — "store", "repair",
   *     "services". That yields "el barrilito liquor".
   *  2. Then drop the category word in front of it, which is only ever removed
   *     once a trade noun has already gone. That yields "el barrilito".
   *
   * Never below two words. "Houston Plumbing Services" stops at "houston
   * plumbing" rather than reaching "houston" — a single generic word matches
   * every rival in the city, and a false mention is worse than a missed one:
   * it tells a client they are being recommended when they are not.
   */
  for (const shortened of shorterForms(trimmed || noPunct)) out.add(shortened)

  return [...out].filter((a) => a.length >= 4)
}

/**
 * Trade nouns and company words a name can safely lose from its end.
 *
 * Reference data about how businesses name themselves, not about any client —
 * the same list is right for every business the tool will ever see, which is
 * why it lives in code beside the state list rather than in a table.
 *
 * A word earns its place here by being a descriptor rather than a brand: no
 * customer thinks of "Clinic" as the name of the clinic. Anything doubtful is
 * left out and handled by the length rule below instead.
 */
const DROPPABLE_TAIL = new Set([
  ...ACTIONS,
  ...PLACE_NOUNS,
  // what the business is
  'clinic',
  'studio',
  'workshop',
  'works',
  'garage',
  'nursery',
  'pharmacy',
  'laundry',
  'cleaners',
  'brewery',
  'roasters',
  'hardware',
  'florist',
  'jewellers',
  'jewelers',
  'opticians',
  'barbers',
  'barbershop',
  'tailors',
  // what it calls itself
  'services',
  'solutions',
  'company',
  'group',
  'supply',
  'supplies',
  'contractors',
  'contracting',
  'builders',
  'associates',
  'partners',
  'specialists',
  'experts',
])

/**
 * The shortened forms, or none when trimming would go too far.
 *
 * Two rules, and both stop at two words:
 *
 *  - A known trade noun comes off a name of three words or more, and the
 *    category word in front of it follows only on a longer name, so
 *    "el barrilito liquor store" reaches "el barrilito" but
 *    "houston plumbing services" stops at "houston plumbing".
 *  - A name of four words or more may lose its last word whether or not the
 *    vocabulary knows it. "Bayou City Coffee Roasters" and "Lone Star Tequila
 *    Depot" are the common case, and a list of trade nouns will never be
 *    complete — but three words left over are still distinctive enough that a
 *    wrong guess does not match a rival.
 */
function shorterForms(name: string): string[] {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length < 3) return []

  const known = DROPPABLE_TAIL.has(words[words.length - 1])
  if (!known && words.length < 4) return []

  const withoutTail = words.slice(0, -1)
  const out = [withoutTail.join(' ')]

  // The category word in front of a trade noun — "liquor" before "store" —
  // only ever after a word we recognised, and never below two words.
  if (known && withoutTail.length >= 3) out.push(withoutTail.slice(0, -1).join(' '))

  return out.filter((a) => a.length >= 4)
}


