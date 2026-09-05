import { eq } from 'drizzle-orm'
import type { openDb } from '../db/raw'
import * as schema from '../db/schema'
import { factsFromEntries, type ClientFacts } from '../onboard/questionnaire'

/**
 * The intake answers for one client.
 *
 * Importable from plain scripts as well as the app, because the recommender
 * runs in both and must produce identical output either way.
 */
export function loadFacts(db: ReturnType<typeof openDb>, clientId: number): ClientFacts {
  const rows = db
    .select()
    .from(schema.clientFacts)
    .where(eq(schema.clientFacts.clientId, clientId))
    .all()
  return factsFromEntries(rows)
}

/**
 * Saves the answers, storing only the ones that were given.
 *
 * A blank answer deletes its row rather than storing an empty string, so
 * "not answered" has exactly one representation everywhere it is read.
 */
export function saveFacts(
  db: ReturnType<typeof openDb>,
  clientId: number,
  answers: Record<string, string>,
) {
  for (const [key, raw] of Object.entries(answers)) {
    const value = raw.trim()
    const existing = db
      .select()
      .from(schema.clientFacts)
      .where(eq(schema.clientFacts.clientId, clientId))
      .all()
      .find((r) => r.key === key)

    if (!value) {
      if (existing) db.delete(schema.clientFacts).where(eq(schema.clientFacts.id, existing.id)).run()
      continue
    }
    if (existing) {
      db.update(schema.clientFacts)
        .set({ value, updatedAt: new Date() })
        .where(eq(schema.clientFacts.id, existing.id))
        .run()
    } else {
      db.insert(schema.clientFacts).values({ clientId, key, value }).run()
    }
  }
}
