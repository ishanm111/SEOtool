import 'server-only'
import { desc, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { isPlaceBased } from '../config'
import { listClientCards, listRuns, type ClientCard, type RunRow } from './run-queries'

/**
 * The whole book of business at a glance.
 *
 * Everything here is summed across clients, which is only ever a triage aid —
 * a portfolio-wide "named in 6% of answers" is not a number anyone is paid to
 * move. It exists to answer "who do I open first", and every figure links
 * through to the one client it is actually about.
 */

export type Attention = {
  clientId: number
  clientName: string
  /** Highest first: 3 is "nothing else matters until this is fixed". */
  weight: number
  tone: 'bad' | 'warn' | 'info'
  headline: string
  detail: string
  href: string
  action: string
}

export type ChangeEntry = {
  id: number
  clientId: number
  clientName: string
  appliedAt: Date | null
  targetUrl: string
  field: string
  status: string
  appliedValue: string
}

export type Workspace = {
  cards: ClientCard[]
  runs: RunRow[]
  activeRuns: RunRow[]
  recentChanges: ChangeEntry[]
  totals: {
    clients: number
    neverRun: number
    notMeasured: number
    answers: number
    named: number
    namedPct: number | null
    findings: number
    critical: number
    recommendations: number
    published: number
    connected: number
    competitors: number
  }
  attention: Attention[]
}

export function getWorkspace(): Workspace {
  const cards = listClientCards()
  const runs = listRuns(undefined, 12)

  const ids = cards.map((c) => c.client.id)
  const changeRows = ids.length
    ? db
        .select()
        .from(schema.fixApplications)
        .where(inArray(schema.fixApplications.clientId, ids))
        .orderBy(desc(schema.fixApplications.id))
        .all()
        .slice(0, 8)
    : []
  const nameById = new Map(cards.map((c) => [c.client.id, c.client.name]))

  const answers = cards.reduce((n, c) => n + c.answerCount, 0)
  const named = cards.reduce((n, c) => n + c.namedCount, 0)

  const attention: Attention[] = []
  for (const c of cards) {
    const { id, name } = c.client

    if (c.lastRun?.status === 'failed') {
      attention.push({
        clientId: id,
        clientName: name,
        weight: 3,
        tone: 'bad',
        headline: 'The last run stopped early',
        detail: c.lastRun.error ?? 'A step exited with an error before the run finished.',
        href: `/runs/${c.lastRun.id}`,
        action: 'Read the log',
      })
    }

    if (c.answerCount === 0) {
      attention.push({
        clientId: id,
        clientName: name,
        weight: c.pageCount === 0 ? 3 : 2,
        tone: 'info',
        headline: c.pageCount === 0 ? 'Nothing has been read yet' : 'The engines have not been asked',
        detail:
          c.pageCount === 0
            ? 'No run has touched this client, so there is nothing to report on at all.'
            : `The site is read (${c.pageCount} pages) but no AI answer has been collected, so there is no visibility figure.`,
        href: '/clients',
        action: 'Start a run',
      })
    } else if (c.namedCount === 0) {
      attention.push({
        clientId: id,
        clientName: name,
        weight: 3,
        tone: 'bad',
        headline: 'Invisible to AI search',
        detail: `Named in 0 of ${c.answerCount} answers. The engines recommend somebody else every single time.`,
        href: '/findings',
        action: 'See why',
      })
    }

    if (c.criticalFindings > 0) {
      attention.push({
        clientId: id,
        clientName: name,
        weight: 2,
        tone: 'bad',
        headline: `${c.criticalFindings} critical finding${c.criticalFindings === 1 ? '' : 's'}`,
        detail: 'Nothing else on the site moves until these are dealt with.',
        href: '/findings',
        action: 'Open findings',
      })
    }

    if (!c.hasCredentials && c.recommendationCount > 0) {
      attention.push({
        clientId: id,
        clientName: name,
        weight: 1,
        tone: 'warn',
        headline: 'The website is not connected',
        detail: `${c.recommendationCount} changes are written and waiting, but there is nowhere to publish them.`,
        href: '/fixes',
        action: 'Connect the site',
      })
    }

    if (c.client.gbpRating === null && isPlaceBased(c.client.businessType)) {
      attention.push({
        clientId: id,
        clientName: name,
        weight: 1,
        tone: 'warn',
        headline: 'No Google rating recorded',
        detail:
          'Every engine has a star-rating floor below which it will not recommend a business. Without the rating the audit cannot say whether this one clears it.',
        href: '/clients',
        action: 'Open client',
      })
    }
  }

  attention.sort((a, b) => b.weight - a.weight || a.clientName.localeCompare(b.clientName))

  return {
    cards,
    runs,
    activeRuns: runs.filter((r) => r.status === 'running' || r.status === 'queued'),
    recentChanges: changeRows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: nameById.get(r.clientId) ?? '',
      appliedAt: r.appliedAt,
      targetUrl: r.targetUrl,
      field: r.field,
      status: r.status,
      appliedValue: r.appliedValue,
    })),
    totals: {
      clients: cards.length,
      neverRun: cards.filter((c) => !c.lastRun).length,
      notMeasured: cards.filter((c) => c.answerCount === 0).length,
      answers,
      named,
      namedPct: answers > 0 ? Math.round((named / answers) * 100) : null,
      findings: cards.reduce((n, c) => n + c.findingCount, 0),
      critical: cards.reduce((n, c) => n + c.criticalFindings, 0),
      recommendations: cards.reduce((n, c) => n + c.recommendationCount, 0),
      published: cards.reduce((n, c) => n + c.appliedFixes, 0),
      connected: cards.filter((c) => c.hasCredentials).length,
      competitors: cards.reduce((n, c) => n + c.competitorCount, 0),
    },
    attention,
  }
}
