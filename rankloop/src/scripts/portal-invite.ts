import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient } from '../lib/resolve-client'
import { hashPassword, temporaryPassword } from '../portal/password'
import { arg, flag } from '../lib/args'
import { loadEnv } from '../lib/env'

/**
 * Creates or resets a client's login to their own portal.
 *
 * There is no sign-up form anywhere in the app: a portal login exists only
 * because an operator made one, which is what keeps a client's numbers from
 * being reachable by anyone who guesses a URL.
 *
 *   npm run portal-invite -- --client=5 --email=owner@example.com
 *   npm run portal-invite -- --client=5 --email=owner@example.com --reset
 *   npm run portal-invite -- --client=5 --list
 *   npm run portal-invite -- --email=owner@example.com --disable
 *
 * The password is printed once and never stored in the clear. Losing it means
 * running this again with --reset.
 */
function main() {
  loadEnv()
  const db = openDb()

  const email = arg('email')?.trim().toLowerCase()

  if (flag('list')) {
    const client = resolveClient(db)
    const rows = db
      .select()
      .from(schema.portalUsers)
      .where(eq(schema.portalUsers.clientId, client.id))
      .all()

    if (rows.length === 0) {
      console.log(`No portal logins for ${client.name}.`)
      return
    }
    console.log(`Portal logins for ${client.name}:`)
    for (const r of rows) {
      const last = r.lastLoginAt ? r.lastLoginAt.toLocaleString() : 'never signed in'
      const state = r.disabled ? 'DISABLED' : r.mustChangePassword ? 'temp password' : 'active'
      console.log(`  ${r.email}  —  ${state}, ${last}`)
    }
    return
  }

  if (!email) {
    throw new Error('an email is needed: --email=owner@example.com')
  }

  const existing = db
    .select()
    .from(schema.portalUsers)
    .where(eq(schema.portalUsers.email, email))
    .get()

  if (flag('disable')) {
    if (!existing) throw new Error(`no portal login for ${email}`)
    db.update(schema.portalUsers)
      .set({ disabled: 1 })
      .where(eq(schema.portalUsers.id, existing.id))
      .run()
    console.log(`${email} can no longer sign in.`)
    return
  }

  const password = temporaryPassword()
  const passwordHash = hashPassword(password)

  if (existing) {
    if (!flag('reset')) {
      throw new Error(
        `${email} already has a login. Re-run with --reset to issue a new password.`,
      )
    }
    db.update(schema.portalUsers)
      .set({ passwordHash, mustChangePassword: 1, disabled: 0 })
      .where(eq(schema.portalUsers.id, existing.id))
      .run()
  } else {
    const client = resolveClient(db)
    db.insert(schema.portalUsers)
      .values({ clientId: client.id, email, passwordHash, mustChangePassword: 1 })
      .run()
  }

  const client = existing
    ? db.select().from(schema.clients).where(eq(schema.clients.id, existing.clientId)).get()
    : resolveClient(db)

  console.log('')
  console.log(`  Portal login for ${client?.name ?? 'client'}`)
  console.log('  ------------------------------------------')
  console.log(`  Address   ${process.env.PORTAL_URL ?? 'http://localhost:3000'}/portal/login`)
  console.log(`  Email     ${email}`)
  console.log(`  Password  ${password}`)
  console.log('')
  console.log('  Shown once. They are asked to change it when they first sign in.')
  console.log('')

  if (!process.env.PORTAL_SECRET) {
    console.log('  ! PORTAL_SECRET is not set, so nobody can sign in yet.')
    console.log(`    Add this line to .env.local:\n`)
    console.log(`    PORTAL_SECRET=${randomBytes(32).toString('hex')}\n`)
  }
}

main()
