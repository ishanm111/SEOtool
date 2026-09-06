import fs from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import type { openDb } from '../db/raw'
import * as schema from '../db/schema'
import { archivedReportFor, reportFileFor } from './report-file'

/**
 * Removing a client, and everything that only existed because of them.
 *
 * A client is the root of about fifteen tables. Deleting the row alone would
 * leave every one of them holding orphans — answers filed under prompts nobody
 * owns, findings about a business the tool no longer knows, screenshots on disk
 * for a client that cannot be opened. Worse, the ids get reused, so a later
 * client can inherit the previous one's history and be reported on numbers that
 * were never about them.
 *
 * So this deletes the whole tree, children first, in one transaction: either
 * the client and everything under it goes, or nothing does.
 *
 * What it will not do is decide for the operator. A count of exactly what is
 * about to be destroyed is produced first and shown on screen, because "delete
 * this client" and "delete four months of measurements" are the same button and
 * only one of them is what somebody means to press.
 */

export type DeletionPlan = {
  clientId: number
  name: string
  domain: string
  /** What goes, in the words the interface uses. Zero counts are kept. */
  counts: {
    pages: number
    prompts: number
    answers: number
    findings: number
    recommendations: number
    competitors: number
    runs: number
    screenshots: number
    reports: number
  }
  /**
   * Fixes published to the client's live site.
   *
   * The row holding the text that was there before is the only way back, so
   * deleting the client makes those changes permanent. Counted separately
   * because it is the one consequence that reaches outside this database.
   */
  appliedFixes: number
  /** True while a run is in flight, which has to be stopped first. */
  hasLiveRun: boolean
}

/** Every id that hangs off this client, gathered once and reused. */
function treeOf(db: ReturnType<typeof openDb>, clientId: number) {
  const pageIds = db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(eq(schema.pages.clientId, clientId))
    .all()
    .map((r) => r.id)

  const promptIds = db
    .select({ id: schema.prompts.id })
    .from(schema.prompts)
    .where(eq(schema.prompts.clientId, clientId))
    .all()
    .map((r) => r.id)

  const answers = promptIds.length
    ? db.select().from(schema.runs).where(inArray(schema.runs.promptId, promptIds)).all()
    : []

  const pipelineRunIds = db
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.clientId, clientId))
    .all()
    .map((r) => r.id)

  return { pageIds, promptIds, answers, pipelineRunIds }
}

/**
 * The files this client owns.
 *
 * Only ever paths this database recorded: a screenshot named on one of its
 * answers, and the two report documents named after its own domain and runs.
 * Nothing is matched by guessing at filenames.
 */
function filesOf(
  db: ReturnType<typeof openDb>,
  clientId: number,
): { screenshots: string[]; reports: string[] } {
  const { answers, pipelineRunIds } = treeOf(db, clientId)
  const client = db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).all()[0]

  const screenshots = [
    ...new Set(answers.map((a) => a.screenshotPath).filter((p): p is string => !!p)),
  ].filter((p) => fs.existsSync(p))

  const reports = [
    ...(client ? [reportFileFor(client.domain)] : []),
    ...pipelineRunIds.map((id) => archivedReportFor(id)),
  ].filter((p) => fs.existsSync(p))

  return { screenshots, reports }
}

/** What deleting this client would destroy. Null when there is no such client. */
export function planDeletion(
  db: ReturnType<typeof openDb>,
  clientId: number,
  /** Whether a run is currently in flight, which only the runner knows. */
  hasLiveRun = false,
): DeletionPlan | null {
  const client = db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).all()[0]
  if (!client) return null

  const { pageIds, promptIds, answers, pipelineRunIds } = treeOf(db, clientId)
  const files = filesOf(db, clientId)

  const countOf = <T extends { clientId: number }>(rows: T[]) => rows.length

  return {
    clientId,
    name: client.name,
    domain: client.domain,
    counts: {
      pages: pageIds.length,
      prompts: promptIds.length,
      answers: answers.length,
      findings: countOf(
        db.select().from(schema.findings).where(eq(schema.findings.clientId, clientId)).all(),
      ),
      recommendations: countOf(
        db
          .select()
          .from(schema.recommendations)
          .where(eq(schema.recommendations.clientId, clientId))
          .all(),
      ),
      competitors: countOf(
        db.select().from(schema.competitors).where(eq(schema.competitors.clientId, clientId)).all(),
      ),
      runs: pipelineRunIds.length,
      screenshots: files.screenshots.length,
      reports: files.reports.length,
    },
    appliedFixes: db
      .select()
      .from(schema.fixApplications)
      .where(eq(schema.fixApplications.clientId, clientId))
      .all()
      .filter((f) => f.status === 'applied').length,
    hasLiveRun,
  }
}

export type DeletionResult = { plan: DeletionPlan; filesRemoved: number }

/**
 * Deletes the client and its whole tree.
 *
 * Children before parents, and all of it inside one transaction: a half-deleted
 * client — rows gone, findings left pointing at nothing — is worse than either
 * outcome on its own, and a page load in the middle of it must never see one.
 *
 * Files go last and outside the transaction, because the filesystem cannot join
 * one. A file that fails to delete is reported rather than thrown: the database
 * is already consistent by then, and an unreadable screenshot left on disk is
 * not a reason to tell the operator the deletion failed.
 */
export function deleteClient(
  db: ReturnType<typeof openDb>,
  clientId: number,
  { removeFiles = true }: { removeFiles?: boolean } = {},
): DeletionResult | null {
  const plan = planDeletion(db, clientId)
  if (!plan) return null

  const { pageIds, answers, pipelineRunIds } = treeOf(db, clientId)
  const answerIds = answers.map((a) => a.id)
  const files = removeFiles ? filesOf(db, clientId) : { screenshots: [], reports: [] }

  db.transaction((tx) => {
    // Two levels below the client: what an answer produced.
    if (answerIds.length > 0) {
      tx.delete(schema.mentions).where(inArray(schema.mentions.runId, answerIds)).run()
      tx.delete(schema.citations).where(inArray(schema.citations.runId, answerIds)).run()
      tx.delete(schema.runs).where(inArray(schema.runs.id, answerIds)).run()
    }
    if (pageIds.length > 0) {
      tx.delete(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).run()
    }
    if (pipelineRunIds.length > 0) {
      tx.delete(schema.pipelineSteps)
        .where(inArray(schema.pipelineSteps.runId, pipelineRunIds))
        .run()
    }

    // Directly the client's, and each of them referenced by nothing below.
    tx.delete(schema.runResults).where(eq(schema.runResults.clientId, clientId)).run()
    tx.delete(schema.competitiveBar).where(eq(schema.competitiveBar.clientId, clientId)).run()
    tx.delete(schema.generatedPages).where(eq(schema.generatedPages.clientId, clientId)).run()
    tx.delete(schema.fixApplications).where(eq(schema.fixApplications.clientId, clientId)).run()
    tx.delete(schema.recommendations).where(eq(schema.recommendations.clientId, clientId)).run()
    tx.delete(schema.findings).where(eq(schema.findings.clientId, clientId)).run()
    tx.delete(schema.competitors).where(eq(schema.competitors.clientId, clientId)).run()
    tx.delete(schema.searchQueries).where(eq(schema.searchQueries.clientId, clientId)).run()
    tx.delete(schema.siteCredentials).where(eq(schema.siteCredentials.clientId, clientId)).run()
    tx.delete(schema.clientFacts).where(eq(schema.clientFacts.clientId, clientId)).run()

    // The four that everything above pointed at, then the client itself.
    tx.delete(schema.prompts).where(eq(schema.prompts.clientId, clientId)).run()
    tx.delete(schema.pages).where(eq(schema.pages.clientId, clientId)).run()
    tx.delete(schema.locations).where(eq(schema.locations.clientId, clientId)).run()
    tx.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.clientId, clientId)).run()
    tx.delete(schema.clients).where(eq(schema.clients.id, clientId)).run()
  })

  let filesRemoved = 0
  for (const file of [...files.screenshots, ...files.reports]) {
    try {
      fs.rmSync(file)
      filesRemoved += 1
    } catch {
      // Already gone, or not ours to remove. The rows are the record; a file
      // left behind is untidy, not wrong.
    }
  }

  return { plan, filesRemoved }
}
