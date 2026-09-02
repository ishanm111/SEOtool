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
