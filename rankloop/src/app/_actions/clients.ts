'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { detectClient, type Detection } from '@/onboard/detect'
import { readGoogleProfile, looksLikeGoogleProfile, type GbpReading } from '@/onboard/gbp'
import { createClient, draftFrom, mergedAliases, type ClientDraft } from '@/onboard/create-client'
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
  | { phase: 'error'; message: string }
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
        'The Google profile link should be a Google Maps address — open the listing, press Share, and copy the link.',
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
    profileRaw ? readGoogleProfile(profileRaw) : Promise.resolve(null),
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

export async function saveClient(
  _prev: OnboardState,
  formData: FormData,
): Promise<OnboardState> {
  let detection: Detection
  try {
    detection = JSON.parse(String(formData.get('detection') ?? '')) as Detection
  } catch {
    return {
      phase: 'error',
      message: 'The detected details were lost. Start again from the website address.',
    }
  }

  const businessType =
    String(formData.get('businessType') ?? '') === 'ecommerce' ? 'ecommerce' : 'local_service'

  const name = String(formData.get('name') ?? '').trim()

  const draft: ClientDraft = {
    name,
    // Rebuilt here rather than carried through the form, so an operator who
    // corrects the name gets variants of the name they actually typed.
    aliases: mergedAliases(name || detection.name, detection.aliases),
    businessType,
    states: listOf(formData.get('states')),
    towns: listOf(formData.get('towns')),
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

  if (!draft.name) return { phase: 'error', message: 'The business needs a name.' }
  if (businessType === 'local_service' && draft.states.length === 0) {
    return {
      phase: 'error',
      message:
        'A local business needs at least one state it serves — that is what decides which place names count as wrong.',
    }
  }

  let clientId: number
  try {
    clientId = createClient(db, detection, draft).clientId
    // Written straight after the client, because a questionnaire answered
    // during onboarding and then lost is worse than one never asked.
    saveFacts(db, clientId, readAnswers(formData))
  } catch (err) {
    return { phase: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  const store = await cookies()
  store.set(ACTIVE_CLIENT_COOKIE, String(clientId), { path: '/', maxAge: 60 * 60 * 24 * 365 })
  revalidatePath('/', 'layout')
  redirect(`/clients?added=${clientId}`)
}
