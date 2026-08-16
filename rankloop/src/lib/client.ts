import type { BusinessType, Platform } from '../config'

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

  // Drop trailing descriptors so "Acme Appliance Repair" also matches "Acme".
  const trimmed = noPunct
    .replace(/\b(llc|inc\.?|co\.?|corp\.?|ltd\.?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (trimmed.length >= 4) out.add(trimmed)

  return [...out].filter((a) => a.length >= 4)
}
