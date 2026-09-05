import { eq } from 'drizzle-orm'
import type { openDb } from '../db/raw'
import * as schema from '../db/schema'
import { deriveAliases } from '../lib/client'
import { isPlaceBased, type BusinessType } from '../config'
import { deriveWrongGeoTerms, type Detection } from './detect'
import { normaliseState, parseTypedPlace, stateFromAbbreviation } from './us-states'
import type { GbpReading } from './gbp'

/**
 * Turns a finished onboarding form into rows.
 *
 * Detection proposes and the operator disposes: everything here arrives already
 * confirmed on screen. Nothing in this file may guess at a value the operator
 * left blank — a service area invented on their behalf silently poisons every
 * measurement that follows it.
 *
 * Shared by the console and by add-client.ts so both write identical rows.
 */

export type ClientDraft = {
  name: string
  /** The variants an AI answer will be matched against, shown before saving. */
  aliases: string[]
  businessType: BusinessType
  /** State abbreviations the business genuinely serves. */
  states: string[]
  /** Towns, typed as "Houston TX" or bare when they share the first state. */
  towns: string[]
  primaryPhone: string | null
  gbpUrl: string | null
  gbpRating: number | null
  gbpReviewCount: number | null
  gbpServiceArea: string | null
  /** Whether the Google listing points at the site the tool is auditing. */
  gbpHasWebsite: boolean | null
}

export type CreateResult = {
  clientId: number
  locationCount: number
  wrongGeoTermCount: number
}

/**
 * Name variants built from the name that was confirmed, not only from the one
 * the website's title happened to give.
 *
 * The two disagree constantly — a title tag is usually a slogan, so detection
 * alone produced variants of the slogan and none of the business's actual name.
 * Every AI answer naming the business would then have been scored as not naming
 * it, which is the single worst failure this tool can have. Both sets are kept:
 * a slogan is sometimes what an engine writes.
 */
export function mergedAliases(name: string, detected: string[]): string[] {
  return [...new Set([...deriveAliases(name), ...detected])]
}

/** The draft the form starts from, before the operator touches anything. */
export function draftFrom(detection: Detection, gbp: GbpReading | null): ClientDraft {
  const suggestedState = detection.states[0]?.state ?? ''
  const inArea = suggestedState
    ? detection.places.filter((p) => p.state === suggestedState)
    : detection.places

  /**
   * A Google listing and a website often disagree about the business name. The
   * listing wins: it is what the engines read when they decide who to name, and
   * a website <title> is usually a slogan with the name buried in it.
   */
  const name = gbp?.name?.trim() || detection.name

  return {
    name,
    aliases: mergedAliases(name, detection.aliases),
    businessType: detection.businessType,
    states: suggestedState ? [suggestedState] : [],
    towns: inArea.slice(0, 25).map((p) => `${p.name} ${p.state}`),
    primaryPhone: gbp?.phone ?? detection.primaryPhone,
    gbpUrl: gbp?.url ?? null,
    gbpRating: gbp?.rating ?? null,
    gbpReviewCount: gbp?.reviewCount ?? null,
    gbpServiceArea: gbp?.serviceArea ?? null,
    // Only decided when the listing was actually read. A share link that went
    // to Google Search tells us nothing about the website attached to it, and
    // recording "no website" on that basis would be a fabricated finding.
    gbpHasWebsite: gbp?.readListing ? gbpPointsAtSite(gbp.website, detection.domain) : null,
  }
}

/**
 * Whether the Google listing links to the site being audited.
 *
 * A listing with no website, or one pointing somewhere else, is a finding in its
 * own right: the engines follow that link, so it decides which pages they read.
 */
export function gbpPointsAtSite(website: string | null, domain: string): boolean | null {
  if (!website) return false
  try {
    const host = new URL(website).hostname.replace(/^www\./, '')
    return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)
  } catch {
    return null
  }
}

export function createClient(
  db: ReturnType<typeof openDb>,
  detection: Detection,
  draft: ClientDraft,
): CreateResult {
  const existing = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.domain, detection.domain))
    .all()[0]
  if (existing) {
    throw new Error(
      `${detection.domain} is already client #${existing.id} (${existing.name}). Open that client instead of adding it twice.`,
    )
  }

  const name = draft.name.trim() || detection.name

  const aliases = mergedAliases(name, detection.aliases)

  const states = draft.states.map((s) => normaliseState(s)).filter((s): s is string => s !== null)

  /**
   * A shop has locations for the same reason a plumber does: it is found
   * through a place. Only an online store has none.
   */
  const locations =
    isPlaceBased(draft.businessType)
      ? draft.towns
          .map((t) => t.trim())
          .filter(Boolean)
          .map((entry) => parseTypedPlace(entry, states[0] ?? ''))
          .filter((l) => l.name.length > 0)
      : []

  // Only derivable once the served states are known — the terms are simply
  // every place the site mentions that lies outside them.
  const wrongGeoTerms = states.length > 0 ? deriveWrongGeoTerms(detection, states) : []

  const clientId = db
    .insert(schema.clients)
    .values({
      name,
      domain: detection.domain,
      homepageUrl: detection.homepageUrl,
      businessType: draft.businessType,
      platform: detection.platform,
      apiBase: detection.apiBase,
      aliases: JSON.stringify(aliases),
      phones: JSON.stringify(detection.phones),
      primaryPhone: draft.primaryPhone,
      gbpUrl: draft.gbpUrl,
      gbpRating: draft.gbpRating,
      gbpReviewCount: draft.gbpReviewCount,
      gbpHasWebsite: draft.gbpHasWebsite,
      gbpServiceArea: draft.gbpServiceArea,
      offerings: JSON.stringify(detection.offerings),
      wrongGeoTerms: JSON.stringify(wrongGeoTerms),
      isActive: true,
    })
    .returning({ id: schema.clients.id })
    .all()[0].id

  if (locations.length > 0) {
    db.insert(schema.locations)
      .values(
        locations.map((l) => {
          const full = stateFromAbbreviation(l.state) ?? l.state
          return {
            clientId,
            name: l.name,
            region: full,
            metro: full,
            dataforseoLocation: `${l.name},${full},United States`,
            isActive: true,
          }
        }),
      )
      .run()
  }

  return { clientId, locationCount: locations.length, wrongGeoTermCount: wrongGeoTerms.length }
}
