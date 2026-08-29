import 'server-only'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { openSqlite } from './connect'
import * as schema from './schema'

const sqlite = openSqlite(process.env.RANKLOOP_DB ?? 'data.db')

export const db = drizzle(sqlite, { schema })
export { schema }
