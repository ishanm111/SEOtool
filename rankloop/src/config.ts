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

/** The two kinds of business the pipeline handles, each with its own logic. */
export const BUSINESS_TYPES = ['local_service', 'ecommerce'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

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
