import path from 'node:path'

/**
 * Where a client's generated audit lives.
 *
 * Shared by the script that writes it and the dashboard that shows it, so the
 * two can never disagree about the filename — a mismatch there would show an
 * empty page for a report that exists.
 */
export const REPORTS_DIR = path.resolve('reports')

export function reportFileFor(domain: string): string {
  return path.join(REPORTS_DIR, `${domain.replace(/\W+/g, '-')}-ai-visibility-audit.html`)
}

/**
 * The copy of a report kept for one run.
 *
 * The live report is overwritten every time one is generated, so history would
 * otherwise link every past run to whatever the newest audit happens to say.
 * Each run keeps its own copy instead: the document actually sent to the client
 * that month stays readable however many runs come after it.
 */
export function archivedReportFor(runId: number): string {
  return path.join(REPORTS_DIR, 'history', `run-${runId}.html`)
}
