import { randomBytes } from 'node:crypto'
import { headers } from 'next/headers'

/**
 * The tool's own questionnaire link.
 *
 * Google can build the same form, but only after an operator has made a Cloud
 * project, enabled two APIs, created an OAuth client and pasted a refresh token
 * — and the answers then land in a spreadsheet somebody has to copy back out by
 * hand. This link needs none of that and writes straight into `client_facts`,
 * which is the table the recommender actually reads.
 *
 * The link is the credential. There is no password on the page it opens, the
 * same way there is none on a Google Form link, so the token has to be
 * unguessable on its own: 18 random bytes, 144 bits, not derived from anything
 * about the client.
 */

export function newQuestionnaireToken(): string {
  return randomBytes(18).toString('base64url')
}

/** The path a token opens. Short on purpose: this gets typed off a text message. */
export function questionnairePath(token: string): string {
  return `/q/${token}`
}

/**
 * Where the tool is reachable from outside.
 *
 * `PUBLIC_BASE_URL` wins when it is set, because only the operator knows
 * whether this is running behind a tunnel or a real domain. `PORTAL_URL` is
 * read after it: it is already the address portal invitations are sent to, and
 * an operator who set one and then found the questionnaire link pointing
 * somewhere else would be right to call that a bug.
 *
 * Without either, the request's own host is the best available guess, and on a
 * laptop that guess is `localhost` — a link only the operator can open. The
 * interface says so rather than handing over a URL that looks fine and is a
 * dead end for the client, which is the same failure a form created and never
 * published would have been.
 */
export async function publicBaseUrl(): Promise<string> {
  const configured = process.env.PUBLIC_BASE_URL?.trim() || process.env.PORTAL_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')

  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** True when a link cannot leave the machine the tool is running on. */
export function isLocalOnly(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(baseUrl)
}
