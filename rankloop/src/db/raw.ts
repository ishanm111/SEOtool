import { drizzle } from 'drizzle-orm/better-sqlite3'
import { openSqlite } from './connect'
import * as schema from './schema'

/**
 * Same database, importable from plain scripts (tsx) where `server-only` would throw.
 * The Next app should import from `./index` instead.
 */
export function openDb(file = process.env.RANKLOOP_DB ?? 'data.db') {
  return drizzle(openSqlite(file, { handleSignals: true }), { schema })
}

export { schema }
