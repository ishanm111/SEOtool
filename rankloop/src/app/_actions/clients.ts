'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { detectClient, type Detection } from '@/onboard/detect'
import { readGoogleProfile, looksLikeGoogleProfile, type GbpReading } from '@/onboard/gbp'
import { createClient, draftFrom, mergedAliases, type ClientDraft } from '@/onboard/create-client'
import { expandZipEntries, type ZipPlace } from '@/onboard/zip'
import { ACTIVE_CLIENT_COOKIE } from '@/lib/active-client'
import { saveFacts } from '@/lib/facts'
import { readAnswers } from '@/lib/read-answers'

/**
 * Adding a client, in two halves.
 *
 * The first reads the website and the Google listing and proposes an answer for
 * every field. The second saves what the operator confirmed. They are separate
 * because detection is a guess: the service area in particular is a decision
 * only a person can make, and getting it wrong quietly invalidates every
 * measurement taken afterwards.
 */

export type OnboardState =
  | { phase: 'idle' }
  /**
   * A rejected submission carries back everything that was typed.
   *
   * React clears an uncontrolled field once a form action finishes, so without
   * this a validation error threw away the operator's work — including a
   * questionnaire they had just spent ten minutes on. `attempt` changes on
   * every failure so the form can be remounted around the returned values.
   */
  | { phase: 'error'; message: string; values?: Record<string, string>; attempt?: number }
  | {
      phase: 'review'
      detection: Detection
      gbp: GbpReading | null
      draft: ClientDraft
    }

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

export async function inspectSite(
  _prev: OnboardState,
  formData: FormData,
): Promise<OnboardState> {
  const website = normaliseUrl(String(formData.get('websiteUrl') ?? ''))
  if (!website) {
    return { phase: 'error', message: 'That does not look like a website address.' }
  }

  const profileRaw = String(formData.get('googleProfileUrl') ?? '').trim()
  if (profileRaw && !looksLikeGoogleProfile(profileRaw)) {
    return {
      phase: 'error',
      message:
        'That is not a Google link. Open the business in Google Maps or in Google Search, press Share, and paste what it gives you — both a maps.app.goo.gl and a share.google address work.',
    }
  }

  const domain = new URL(website).hostname.replace(/^www\./, '')
  const clash = db.select().from(schema.clients).where(eq(schema.clients.domain, domain)).all()[0]
  if (clash) {
    return {
      phase: 'error',
      message: `${domain} is already client #${clash.id} (${clash.name}).`,
    }
  }

  // Both reads are slow and independent, so neither waits for the other.
  const [detectionResult, gbpResult] = await Promise.allSettled([
    detectClient(website),
    /**
     * The domain is handed over so a share link that lands on Google Search
     * can still reach the listing: Maps is searched for the name Google
     * returned, and the result is only used if it links to this site.
     */
    profileRaw ? readGoogleProfile(profileRaw, { expectDomain: domain }) : Promise.resolve(null),
  ])

  if (detectionResult.status === 'rejected') {
    const reason = detectionResult.reason
    return {
      phase: 'error',
      message: `The website could not be read: ${reason instanceof Error ? reason.message : String(reason)}`,
    }
  }

  const detection = detectionResult.value
  const gbp = gbpResult.status === 'fulfilled' ? gbpResult.value : null

  return { phase: 'review', detection, gbp, draft: draftFrom(detection, gbp) }
}

const numberOrNull = (raw: FormDataEntryValue | null): number | null => {
  const text = String(raw ?? '').trim().replace(/,/g, '')
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

const listOf = (raw: FormDataEntryValue | null): string[] =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Everything typed into the review form, so a rejection can hand it straight back. */
function submittedValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    // The detection blob is passed through a hidden field and re-rendered from
    // state; echoing it back would double the size of every error response.
    if (key === 'detection' || typeof value !== 'string') continue
    out[key] = value
  }
  return out
}

export async function saveClient(
  prev: OnboardState,
  formData: FormData,
): Promise<OnboardState> {
  const attempt = (prev.phase === 'error' ? prev.attempt ?? 0 : 0) + 1
  const values = submittedValues(formData)
  const reject = (message: string): OnboardState => ({
    phase: 'error',
    message,
    values,
    attempt,
  })

  let detection: Detection
  try {
    detection = JSON.parse(String(formData.get('detection') ?? '')) as Detection
  } catch {
    return reject('The detected details were lost. Start again from the website address.')
  }

  const businessType =
    String(formData.get('businessType') ?? '') === 'ecommerce' ? 'ecommerce' : 'local_service'

  const name = String(formData.get('name') ?? '').trim()

  /**
   * ZIP codes become towns before anything is written.
   *
   * A service area is frequently given as ZIPs, and a location row reading
   * "77502" would put "best plumber in 77502" to the engines — a question no
   * customer asks and no answer names anybody for.
   */
  const townEntries = listOf(formData.get('towns'))
  const towns = await expandZipEntries(townEntries)
  if (towns.unresolved.length > 0) {
    return reject(
      `These ZIP codes could not be looked up: ${towns.unresolved.join(', ')}. ` +
        'Check them, or type the town names instead — the questions are asked by town name, so a ZIP that cannot be resolved has nothing to ask about.',
    )
  }

  const draft: ClientDraft = {
    name,
    // Rebuilt here rather than carried through the form, so an operator who
    // corrects the name gets variants of the name they actually typed.
    aliases: mergedAliases(name || detection.name, detection.aliases),
    businessType,
    states: listOf(formData.get('states')),
    towns: towns.entries,
    primaryPhone: String(formData.get('primaryPhone') ?? '').trim() || null,
    gbpUrl: String(formData.get('gbpUrl') ?? '').trim() || null,
    gbpRating: numberOrNull(formData.get('gbpRating')),
    gbpReviewCount: numberOrNull(formData.get('gbpReviewCount')),
    gbpServiceArea: String(formData.get('gbpServiceArea') ?? '').trim() || null,
    gbpHasWebsite:
      formData.get('gbpHasWebsite') === 'yes'
        ? true
        : formData.get('gbpHasWebsite') === 'no'
          ? false
          : null,
  }

  if (!draft.name) return reject('The business needs a name.')
  if (businessType === 'local_service' && draft.states.length === 0) {
    return reject(
      'A local business needs at least one state it serves — that is what decides which place names count as wrong.',
    )
  }

  let clientId: number
  try {
    clientId = createClient(db, detection, draft).clientId
    // Written straight after the client, because a questionnaire answered
    // during onboarding and then lost is worse than one never asked.
    saveFacts(db, clientId, readAnswers(formData))
  } catch (err) {
    return reject(err instanceof Error ? err.message : String(err))
  }

  const store = await cookies()
  store.set(ACTIVE_CLIENT_COOKIE, String(clientId), { path: '/', maxAge: 60 * 60 * 24 * 365 })
  revalidatePath('/', 'layout')
  redirect(`/clients?added=${clientId}`)
}


/**
 * Turns the ZIP codes in a typed service area into towns, while it is typed.
 *
 * The same expansion happens on save regardless, but doing it on the spot means
 * the operator sees "77502 → Pasadena TX" and can correct a wrong ZIP there and
 * then, rather than finding out from a rejected form after filling in a
 * questionnaire.
 */
export type TownExpansion = {
  towns: string
  resolved: ZipPlace[]
  unresolved: string[]
}

export async function expandTowns(raw: string): Promise<TownExpansion> {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const { entries: expanded, resolved, unresolved } = await expandZipEntries(entries)
  return { towns: expanded.join(', '), resolved, unresolved }
}
