'use server'

import { revalidatePath } from 'next/cache'
import { eq, ne, and } from 'drizzle-orm'
import { db, schema } from '@/db'
import { detectClient } from '@/onboard/detect'
import { readGoogleProfile, looksLikeGoogleProfile } from '@/onboard/gbp'
import { gbpPointsAtSite } from '@/onboard/create-client'
import type { ReinspectState } from './reinspect-state'

/**
 * Correcting a client's website address or Google listing after the fact, and
 * reading the business again.
 *
 * The new-client flow cannot do this: it refuses any domain already on file,
 * which is right when adding and exactly wrong when fixing a typo in the thing
 * that was added. So this is its own path, scoped to one existing client.
 *
 * Two separate actions on purpose, because they are two different intentions.
 * Saving a link is bookkeeping and must never touch measurements. Re-inspecting
 * reads the site and rewrites what was derived from it — which is the right
 * thing to do when the URL was wrong, and the wrong thing to do by accident.
 */

function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return url.hostname.includes('.') ? url.toString() : null
  } catch {
    return null
  }
}

/** Shared validation: both actions take the same two fields. */
function readLinks(formData: FormData):
  | { ok: true; clientId: number; website: string; domain: string; profile: string }
  | { ok: false; error: string } {
  const clientId = Number(formData.get('clientId'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, error: 'No client was given.' }
  }

  const website = normaliseUrl(String(formData.get('websiteUrl') ?? ''))
  if (!website) return { ok: false, error: 'That does not look like a website address.' }

  const profile = String(formData.get('googleProfileUrl') ?? '').trim()
  if (profile && !looksLikeGoogleProfile(profile)) {
    return {
      ok: false,
      error:
        'That is not a Google link. Open the business in Google Maps or Google Search, press Share, and paste what it gives you.',
    }
  }

  const domain = new URL(website).hostname.replace(/^www\./, '')

  // Another client already owning this domain is a real collision; this client
  // owning it is just an unchanged address.
  const clash = db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(and(eq(schema.clients.domain, domain), ne(schema.clients.id, clientId)))
    .get()

  if (clash) {
    return { ok: false, error: `${domain} already belongs to client #${clash.id} (${clash.name}).` }
  }

  return { ok: true, clientId, website, domain, profile }
}

/**
 * One action, two intentions, chosen by which button was pressed.
 *
 * A single form rather than two, because both buttons act on the same two
 * fields and duplicating the inputs so a second form can see them is how they
 * drift apart. The submit button's own name/value rides along in the form data,
 * which is plain HTML and needs no JavaScript to work.
 */
export async function businessLinksAction(
  prev: ReinspectState,
  formData: FormData,
): Promise<ReinspectState> {
  return String(formData.get('intent')) === 'inspect'
    ? reinspectAction(prev, formData)
    : saveClientLinksAction(prev, formData)
}

/**
 * Saves the two links and nothing else.
 *
 * Deliberately does not re-read the site. An operator pasting a Google listing
 * they finally tracked down should not have the business re-classified as a
 * side effect of filing it.
 */
async function saveClientLinksAction(
  _prev: ReinspectState,
  formData: FormData,
): Promise<ReinspectState> {
  const parsed = readLinks(formData)
  if (!parsed.ok) return { error: parsed.error, notice: null }

  db.update(schema.clients)
    .set({
      homepageUrl: parsed.website,
      domain: parsed.domain,
      ...(parsed.profile ? { gbpUrl: parsed.profile } : {}),
    })
    .where(eq(schema.clients.id, parsed.clientId))
    .run()

  revalidatePath('/overview')
  revalidatePath('/clients')

  return {
    error: null,
    notice: 'Saved. Press "Inspect the business again" to re-read the site with it.',
  }
}

/**
 * Reads the website and the Google listing again, and rewrites what was derived
 * from them.
 *
 * What it overwrites: platform, API base, phone numbers, offerings, and every
 * Google listing figure. These are all readings, and a reading taken from the
 * wrong address is worth nothing.
 *
 * What it leaves alone: the business name, the aliases, the service-area towns
 * and the business type. Those are the four an operator corrects by hand after
 * detection gets them wrong, and silently reverting someone's corrections is a
 * worse failure than leaving a stale one for them to fix.
 */
async function reinspectAction(
  _prev: ReinspectState,
  formData: FormData,
): Promise<ReinspectState> {
  const parsed = readLinks(formData)
  if (!parsed.ok) return { error: parsed.error, notice: null }

  const [detectionResult, gbpResult] = await Promise.allSettled([
    detectClient(parsed.website),
    parsed.profile
      ? readGoogleProfile(parsed.profile, { expectDomain: parsed.domain })
      : Promise.resolve(null),
  ])

  if (detectionResult.status === 'rejected') {
    const reason = detectionResult.reason
    return {
      error: `The website could not be read: ${reason instanceof Error ? reason.message : String(reason)}`,
      notice: null,
    }
  }

  const detection = detectionResult.value
  const gbp = gbpResult.status === 'fulfilled' ? gbpResult.value : null

  db.update(schema.clients)
    .set({
      homepageUrl: detection.homepageUrl,
      domain: detection.domain,
      platform: detection.platform,
      apiBase: detection.apiBase,
      phones: JSON.stringify(detection.phones),
      primaryPhone: gbp?.phone ?? detection.primaryPhone,
      offerings: JSON.stringify(detection.offerings),
      ...(parsed.profile ? { gbpUrl: gbp?.url ?? parsed.profile } : {}),
      ...(gbp
        ? {
            gbpRating: gbp.rating,
            gbpReviewCount: gbp.reviewCount,
            gbpServiceArea: gbp.serviceArea,
            // Only decided when the listing was actually read. A share link
            // that landed on Google Search says nothing about the website
            // attached to it, and recording "no website" on that basis would
            // be a fabricated finding.
            gbpHasWebsite: gbp.readListing
              ? gbpPointsAtSite(gbp.website, detection.domain)
              : null,
          }
        : {}),
    })
    .where(eq(schema.clients.id, parsed.clientId))
    .run()

  revalidatePath('/overview')
  revalidatePath('/clients')
  revalidatePath('/intake')

  const parts = [
    `Read ${detection.domain}`,
    `platform: ${detection.platform}`,
    `${detection.offerings.length} offerings`,
    `${detection.phones.length} phone number${detection.phones.length === 1 ? '' : 's'}`,
  ]
  if (gbp?.readListing) {
    parts.push(`listing: ${gbp.rating ?? '—'}★ / ${gbp.reviewCount ?? 0} reviews`)
  } else if (parsed.profile) {
    parts.push('the Google link did not open a listing')
  }

  return {
    error: null,
    notice: `${parts.join(' · ')}. Name, towns and business type were left as they are — change those on the client screen. Re-run ingest to pick up pages.`,
  }
}
