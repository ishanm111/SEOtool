import 'server-only'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Client } from './client'
import { PUBLISHABLE_KINDS, WHY_NOT_PUBLISHABLE, editorFor, type StoredCredential } from '../editor'

/**
 * What can be published to a client's site, what has been, and what is standing
 * in the way of the rest.
 *
 * A recommendation is only offered as a one-press fix when three things hold: it
 * is a kind the platform can be written to, it has no placeholders left in it,
 * and the site is connected. Anything else is shown with the reason, because a
 * disabled button with no explanation is the fastest way to make a tool look
 * broken.
 */

export type FixRow = {
  id: number
  kind: string
  target: string
  currentValue: string | null
  proposedValue: string
  reason: string
  priority: number
  placeholderCount: number
  pageId: number | null
  pageUrl: string | null
  pageType: string | null
  externalId: string | null
  /** Null when it can be applied; otherwise why not. */
  blockedBecause: string | null
  applied: {
    id: number
    appliedAt: Date | null
    status: string
    previousValue: string | null
    error: string | null
  } | null
}

export function credentialFor(clientId: number): StoredCredential | null {
  const row = db
    .select()
    .from(schema.siteCredentials)
    .where(eq(schema.siteCredentials.clientId, clientId))
    .all()
    .sort((a, b) => b.id - a.id)[0]
  return row ?? null
}

export function listFixes(client: Client): {
  rows: FixRow[]
  credential: StoredCredential | null
  counts: { total: number; ready: number; applied: number; blocked: number }
} {
  const credential = credentialFor(client.id)
  const editor = credential ? editorFor(credential) : null

  const recs = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.clientId, client.id))
    .all()
    .sort((a, b) => b.priority - a.priority)

  const pageIds = recs.map((r) => r.pageId).filter((id): id is number => id !== null)
  const pages = pageIds.length
    ? db.select().from(schema.pages).where(inArray(schema.pages.id, pageIds)).all()
    : []
  const pageById = new Map(pages.map((p) => [p.id, p]))

  const applications = db
    .select()
    .from(schema.fixApplications)
    .where(eq(schema.fixApplications.clientId, client.id))
    .orderBy(desc(schema.fixApplications.id))
    .all()
  const latestByRec = new Map<number, (typeof applications)[number]>()
  for (const a of applications) {
    if (a.recommendationId !== null && !latestByRec.has(a.recommendationId)) {
      latestByRec.set(a.recommendationId, a)
    }
  }

  const rows: FixRow[] = recs.map((r) => {
    const page = r.pageId ? pageById.get(r.pageId) : undefined
    const application = latestByRec.get(r.id) ?? null

    let blocked: string | null = null
    if (!PUBLISHABLE_KINDS.has(r.kind)) {
      blocked = WHY_NOT_PUBLISHABLE[r.kind] ?? 'This kind of change cannot be published from here.'
    } else if (r.placeholderCount > 0) {
      blocked = `This still contains ${r.placeholderCount} value${
        r.placeholderCount === 1 ? '' : 's'
      } only the business can confirm. Fill them in before publishing.`
    } else if (!credential || !editor) {
      blocked = 'The website is not connected yet, so there is nowhere to publish this.'
    } else if (!page) {
      blocked = 'This is not attached to a page that was read from the site.'
    } else {
      blocked = editor.refuse({
        page: {
          id: page.id,
          externalId: page.externalId,
          url: page.url,
          slug: page.slug,
          pageType: page.pageType,
          title: page.title,
          metaDescription: page.metaDescription,
        },
        field: r.kind as 'meta_title' | 'meta_description' | 'copy',
        currentValue: r.currentValue,
        proposedValue: r.proposedValue,
      })
    }

    return {
      id: r.id,
      kind: r.kind,
      target: r.target,
      currentValue: r.currentValue,
      proposedValue: r.proposedValue,
      reason: r.reason,
      priority: r.priority,
      placeholderCount: r.placeholderCount,
      pageId: r.pageId,
      pageUrl: page?.url ?? null,
      pageType: page?.pageType ?? null,
      externalId: page?.externalId ?? null,
      blockedBecause: blocked,
      applied: application
        ? {
            id: application.id,
            appliedAt: application.appliedAt,
            status: application.status,
            previousValue: application.previousValue,
            error: application.error,
          }
        : null,
    }
  })

  return {
    rows,
    credential,
    counts: {
      total: rows.length,
      ready: rows.filter((r) => !r.blockedBecause && r.applied?.status !== 'applied').length,
      applied: rows.filter((r) => r.applied?.status === 'applied').length,
      blocked: rows.filter((r) => r.blockedBecause).length,
    },
  }
}

/** The change log: every edit written to the live site, newest first. */
export function listApplications(client: Client) {
  const rows = db
    .select()
    .from(schema.fixApplications)
    .where(eq(schema.fixApplications.clientId, client.id))
    .orderBy(desc(schema.fixApplications.id))
    .all()
  return rows.slice(0, 100)
}
