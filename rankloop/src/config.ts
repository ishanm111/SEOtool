/**
 * Tool-wide configuration.
 *
 * NOTHING CLIENT-SPECIFIC BELONGS IN THIS FILE. No business names, no cities,
 * no phone numbers, no industry terms. Every client detail lives in the
 * `clients` and `locations` tables, populated by src/onboard/detect.ts.
 *
 * If you are about to add a constant here, ask whether it would still be true
 * for a completely different client. If not, it belongs in the database.
 */

/**
 * Minimum star rating each engine requires before it will recommend a business.
 * A property of the engines, not of any client — which is why it stays in code.
 */
export const RATING_THRESHOLDS = { chatgpt: 4.3, perplexity: 4.1, gemini: 3.9 } as const

/**
 * The shortest string that can be a real answer.
 *
 * A stable string is not an answer. Gemini returned the accessibility label
 * "Gemini said" — eleven characters, perfectly stable, and the reader accepted
 * it as the response. Google leaves behind furniture of the same shape
 * ("∙ Choose area"), and both are counted as measurements unless something
 * rejects them. Eighty characters is comfortably below any real recommendation
 * and comfortably above every label seen so far.
 *
 * A property of how the engines render, not of any client, so it lives here.
 */
export const MIN_ANSWER_CHARS = 80

/**
 * The three kinds of business the pipeline handles.
 *
 * They are not variations on a theme. A plumber is found by "who can come out
 * today", judged on a service area and a map pack, and never asked about
 * postage. An online store is found by "where do I buy X", judged on product
 * markup and returns, and has no service area at all. A shop with a door on a
 * street is both at once — people search for it by place and buy a product
 * when they get there — and treating it as either one alone asks it half the
 * questions that matter and half that do not.
 *
 * Two properties do the work downstream, so nothing has to enumerate the list:
 * whether a business is found through places, and whether it sells things.
 */
export const BUSINESS_TYPES = ['local_service', 'ecommerce', 'local_retail'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

/** How each kind is described to an operator, in one line. */
export const BUSINESS_TYPE_LABELS: Record<BusinessType, { label: string; help: string }> = {
  local_service: {
    label: 'Service business',
    help: 'Goes to the customer, or works from premises customers rarely visit. Plumbers, repairs, cleaning, trades.',
  },
  ecommerce: {
    label: 'Online store',
    help: 'Sells and ships. No premises a customer would search for.',
  },
  local_retail: {
    label: 'Shop or in-person location selling products',
    help: 'Customers come to a place and buy something there. Liquor stores, bakeries, boutiques, garden centres.',
  },
}

/**
 * Found through places: has a service area or an address, competes in a map
 * pack, and lives or dies by its Google listing.
 */
export const isPlaceBased = (type: BusinessType): boolean => type !== 'ecommerce'

/**
 * Sells things rather than labour: needs product markup, a currency, and an
 * answer about returns.
 */
export const sellsProducts = (type: BusinessType): boolean => type !== 'local_service'

/** Site platforms the ingest layer knows how to read. */
export const PLATFORMS = [
  'wordpress',
  'shopify',
  'webflow',
  'squarespace',
  'wix',
  'custom',
] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * Aggregators, marketplaces and manufacturers. They show up in AI answers as
 * genuine sources but are not local competitors, so they are excluded from the
 * competitive comparison.
 */
export const NOT_A_DIRECT_COMPETITOR =
  /^(yelp\.com|reddit\.com|facebook\.com|instagram\.com|angi\.com|thumbtack\.com|homeadvisor\.com|bbb\.org|nextdoor\.com|checkbook\.org|youtube\.com|tripadvisor\.com|yellowpages\.com|amazon\.[a-z.]+|etsy\.com|ebay\.com|walmart\.com|target\.com|wikipedia\.org|quora\.com|pinterest\.com)$/

/** Map-widget and engine-furniture links that are not real citations. */
export const JUNK_CITATION_DOMAINS =
  /^(mapbox\.com|openstreetmap\.org|myactivity\.google\.com|accounts\.google\.com|policies\.google\.com|support\.google\.com|gstatic\.com|googleusercontent\.com|maps\.google\.com)$/
