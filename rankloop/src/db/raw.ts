import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

/**
 * Same database, importable from plain scripts (tsx) where `server-only` would throw.
 * The Next app should import from `./index` instead.
 */
export function openDb(file = process.env.RANKLOOP_DB ?? 'data.db') {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  return drizzle(sqlite, { schema })
}

export { schema }
