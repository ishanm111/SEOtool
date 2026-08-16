import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const DB_FILE = process.env.RANKLOOP_DB ?? 'data.db'
const MIGRATIONS = path.resolve('drizzle')

/**
 * Applies every generated migration. Safe to re-run: statements for things that
 * already exist are skipped rather than treated as failures. SQLite words that
 * two different ways — "already exists" and "duplicate column name".
 *
 * No seeding happens here. Clients are added with add-client.ts.
 */
function main() {
  const sqlite = new Database(DB_FILE)
  sqlite.pragma('journal_mode = WAL')

  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim()
      if (!trimmed) continue
      try {
        sqlite.exec(trimmed)
      } catch (err) {
        const msg = String(err)
        const alreadyApplied = msg.includes('already exists') || msg.includes('duplicate column name')
        if (!alreadyApplied) throw err
      }
    }
    console.log(`applied ${file}`)
  }

  const tables = sqlite
    .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
    .all() as { name: string }[]
  sqlite.close()

  console.log(`\ndatabase ready: ${path.resolve(DB_FILE)}`)
  console.log(`${tables.length} tables: ${tables.map((t) => t.name).join(', ')}`)
}

main()
