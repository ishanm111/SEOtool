import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { getClient } from '../lib/queries'
import type { Client } from '../lib/client'
import { hashPassword, verifyPassword } from './password'

/**
 * Sign-in for the client portal.
 *
 * Deliberately small and self-contained: no third-party identity provider, no
 * password reset by email, no sign-up. A client's business owner gets one login
 * from an operator and uses it to look at their own numbers. Anything more is a
 * product decision nobody has made yet.
 *
 * The session is a signed cookie rather than a row in the database. Nothing in
 * it is secret — it carries a user id and an expiry in the clear — but the HMAC
 * means it cannot be edited into someone else's id, which is the only attack
 * that matters here.
 */

const COOKIE = 'seomyze_portal'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14

export type PortalSession = { userId: number; email: string; client: Client }

/**
 * The key the session cookie is signed with.
 *
 * Read on every use rather than cached at import, so a deployment that forgot
 * to set it fails on the first sign-in attempt with a message an operator can
 * act on — not silently, and not with a default value that would let anyone
 * mint a cookie for any client.
 */
function secret(): string {
  const value = process.env.PORTAL_SECRET
  if (!value || value.length < 32) {
    throw new Error(
      'PORTAL_SECRET is missing or too short. Generate one with `npm run portal-secret` and put it in .env.local.',
    )
  }
  return value
}

// ----------------------------------------------------------------- sessions

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

function mintToken(userId: number): string {
  const payload = `${userId}.${Date.now() + MAX_AGE_SECONDS * 1000}`
  return `${payload}.${sign(payload)}`
}

/** The user id a token proves, or null when it is forged, stale or malformed. */
function readToken(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [rawId, rawExpiry, mac] = parts

  const expected = sign(`${rawId}.${rawExpiry}`)
  // Both are hex of the same length, so a length mismatch means forged.
  if (mac.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) return null

  const expiry = Number(rawExpiry)
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null

  const id = Number(rawId)
  return Number.isInteger(id) ? id : null
}

/**
 * Who is signed in, and which client they may see.
 *
 * Returns null rather than throwing for every failure mode — no cookie, a
 * cookie that no longer matches a user, a user an operator has since disabled,
 * a client that has been deleted — because every caller does the same thing
 * about it: show the sign-in page.
 */
export async function currentPortalSession(): Promise<PortalSession | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null

  let userId: number | null = null
  try {
    userId = readToken(token)
  } catch {
    // A missing PORTAL_SECRET throws here. Treat it as signed out; the sign-in
    // attempt that follows reports the real reason.
    return null
  }
  if (userId === null) return null

  const user = db.select().from(schema.portalUsers).where(eq(schema.portalUsers.id, userId)).get()
  if (!user || user.disabled) return null

  const client = getClient(user.clientId)
  if (!client) return null

  return { userId: user.id, email: user.email, client }
}

export type SignInResult =
  | { ok: true; mustChangePassword: boolean }
  | { ok: false; error: string }

/**
 * Checks an email and password and, on success, sets the session cookie.
 *
 * A wrong email and a wrong password give the same message on purpose: telling
 * someone which half they got right turns the sign-in form into a way to find
 * out who the tool's clients are.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const WRONG = { ok: false, error: 'That email and password do not match.' } as const

  const normalised = email.trim().toLowerCase()
  if (!normalised || !password) return WRONG

  const user = db
    .select()
    .from(schema.portalUsers)
    .where(eq(schema.portalUsers.email, normalised))
    .get()

  if (!user || user.disabled) return WRONG
  if (!verifyPassword(password, user.passwordHash)) return WRONG

  const store = await cookies()
  store.set(COOKIE, mintToken(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/portal',
    maxAge: MAX_AGE_SECONDS,
  })

  db.update(schema.portalUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.portalUsers.id, user.id))
    .run()

  return { ok: true, mustChangePassword: Boolean(user.mustChangePassword) }
}

export async function signOut(): Promise<void> {
  ;(await cookies()).delete({ name: COOKIE, path: '/portal' })
}

/** Changes a password and clears the flag that forces the change. */
export function setPassword(userId: number, password: string): void {
  db.update(schema.portalUsers)
    .set({ passwordHash: hashPassword(password), mustChangePassword: 0 })
    .where(eq(schema.portalUsers.id, userId))
    .run()
}
