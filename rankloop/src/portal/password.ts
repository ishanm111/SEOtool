import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing, kept apart from the session code.
 *
 * `auth.ts` is marked `server-only` and reads cookies, so a plain tsx script
 * cannot import it — and creating a portal login is exactly the kind of thing
 * an operator does from a script. This module has no such dependency, so both
 * sides share one implementation rather than keeping two in step by hand.
 */

/** scrypt with a per-password salt, stored as `<salt-hex>:<key-hex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':')
  if (!saltHex || !keyHex) return false
  try {
    const key = Buffer.from(keyHex, 'hex')
    const attempt = scryptSync(password, Buffer.from(saltHex, 'hex'), key.length)
    return timingSafeEqual(key, attempt)
  } catch {
    return false
  }
}

/**
 * A temporary password an operator can read down a phone line.
 *
 * No ambiguous characters, because it will be transcribed by hand at least
 * once. It is marked must-change at first sign-in, so its only job is to
 * survive that trip.
 */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  let out = ''
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length]
    if (i % 4 === 3 && i < 15) out += '-'
  }
  return out
}
