import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { hydrateClient, type Client, type ClientLocation } from './client'

/**
 * Every script works on exactly one client. Which one is chosen with
 * `--client=<id|domain>`, or defaults to the only client when there is one.
 *
 * Defaulting silently when several exist would make it far too easy to write one
 * client's results over another's, so that case is an error.
 */
export function resolveClient(db: ReturnType<typeof openDb>): Client {
  const arg = process.argv.find((a) => a.startsWith('--client='))?.split('=')[1]
  const rows = db.select().from(schema.clients).where(eq(schema.clients.isActive, true)).all()

  if (rows.length === 0) {
    throw new Error('no clients yet — add one with: npx tsx src/scripts/add-client.ts <url>')
  }

  if (!arg) {
    if (rows.length === 1) return hydrateClient(rows[0])
    throw new Error(
      `${rows.length} clients exist — pick one with --client=<id|domain>:\n` +
        rows.map((r) => `  ${r.id}  ${r.domain}  (${r.name})`).join('\n'),
    )
  }

  const match = rows.find((r) => String(r.id) === arg || r.domain === arg || r.domain.includes(arg))
  if (!match) {
    throw new Error(
      `no client matches "${arg}". Known clients:\n` +
        rows.map((r) => `  ${r.id}  ${r.domain}  (${r.name})`).join('\n'),
    )
  }
  return hydrateClient(match)
}

export function clientLocations(db: ReturnType<typeof openDb>, clientId: number): ClientLocation[] {
  return db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.clientId, clientId))
    .all()
    .filter((l) => l.isActive)
}
