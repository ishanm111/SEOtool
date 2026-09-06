import fs from 'node:fs'
import os from 'node:os'
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

/** The working document: every proposed change, in full, for applying by hand. */
export function fixPackFileFor(domain: string): string {
  return path.join(REPORTS_DIR, `${domain.replace(/\W+/g, '-')}-fix-pack.html`)
}

/**
 * Where the PDFs go.
 *
 * The Desktop, because a client report is a thing somebody attaches to an email
 * from their own machine, and asking them to dig a file out of a project folder
 * they did not choose is how it never gets sent. `RANKLOOP_PDF_DIR` overrides
 * it, and a machine with no Desktop — a server, a container — falls back to the
 * reports folder rather than failing.
 */
export function pdfOutputDir(): string {
  const configured = process.env.RANKLOOP_PDF_DIR?.trim()
  if (configured) return path.resolve(configured)
  const desktop = path.join(os.homedir(), 'Desktop')
  return fs.existsSync(desktop) ? desktop : REPORTS_DIR
}

export const pdfNameFor = (domain: string, kind: 'audit' | 'fix-pack') =>
  `${domain.replace(/\W+/g, '-')}-${kind === 'audit' ? 'ai-visibility-audit' : 'fix-pack'}.pdf`
