import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { getRecommendations } from '../lib/queries'
import type { Client } from '../lib/client'

/**
 * What a signed-in client may read and change.
 *
 * Every function here takes the client from the session rather than from the
 * request, and every write names the client in its WHERE clause. That is the
 * whole isolation story: there is no portal query that can be made to return
 * another client's row by changing a number in a form.
 */

export const DECISIONS = ['pending', 'approved', 'rejected'] as const
export type Decision = (typeof DECISIONS)[number]

export function isDecision(value: string): value is Decision {
  return (DECISIONS as readonly string[]).includes(value)
}

export type PortalFix = {
  id: number
  kind: string
  target: string
  currentValue: string | null
  proposedValue: string
  reason: string
  priority: number
  placeholderCount: number
  pageSlug: string | undefined
  decision: Decision
  decidedAt: Date | null
  decidedBy: string | null
}

/**
 * The proposed changes, ranked, with what the client has already said about
 * each one.
 *
 * Recommendations still carrying `[[FILL: ...]]` placeholders are included
 * rather than hidden: they are exactly the ones where the client knows
 * something the tool does not, and a client who cannot see them cannot supply
 * it.
 */
export function portalFixes(client: Client): PortalFix[] {
  return getRecommendations(client).rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    target: r.target,
    currentValue: r.currentValue,
    proposedValue: r.proposedValue,
    reason: r.reason,
    priority: r.priority,
    placeholderCount: r.placeholderCount,
    pageSlug: r.pageSlug,
    decision: isDecision(r.clientDecision) ? r.clientDecision : 'pending',
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
  }))
}

export type DecisionTally = { pending: number; approved: number; rejected: number }

export function tallyDecisions(fixes: PortalFix[]): DecisionTally {
  const tally: DecisionTally = { pending: 0, approved: 0, rejected: 0 }
  for (const f of fixes) tally[f.decision] += 1
  return tally
}

/**
 * Records a client's decision about one proposed change.
 *
 * The client id is part of the WHERE clause, not something checked beforehand
 * and trusted afterwards, so a recommendation belonging to another client
 * matches no rows and the call reports that it changed nothing.
 */
export function recordDecision(
  clientId: number,
  recommendationId: number,
  decision: Decision,
  email: string,
): boolean {
  const result = db
    .update(schema.recommendations)
    .set({
      clientDecision: decision,
      decidedAt: decision === 'pending' ? null : new Date(),
      decidedBy: decision === 'pending' ? null : email,
    })
    .where(
      and(
        eq(schema.recommendations.id, recommendationId),
        eq(schema.recommendations.clientId, clientId),
      ),
    )
    .run()

  return result.changes > 0
}
