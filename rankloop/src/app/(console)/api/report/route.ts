import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { REPORTS_DIR, fixPackFileFor, reportFileFor } from '@/lib/report-file'

/**
 * Serves a generated audit as its own document, so the console can show the
 * exact file that gets sent to the client rather than a second rendering of it.
 *
 * Two ways in: `?domain=` for the current report, and `?run=` for the copy kept
 * for one past run. History uses the second — the live file is overwritten by
 * every new report, and linking an old run to a newer audit would misrepresent
 * what the client was actually sent.
 *
 * A path is only served if it resolves inside the reports directory.
 */
function serve(file: string) {
  const resolved = path.resolve(file)
  if (!resolved.startsWith(REPORTS_DIR + path.sep) || !fs.existsSync(resolved)) {
    return new NextResponse('no report generated yet', { status: 404 })
  }
  return new NextResponse(fs.readFileSync(resolved, 'utf8'), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  const runId = Number(params.get('run'))
  if (Number.isInteger(runId) && runId > 0) {
    const stored = db
      .select({ reportPath: schema.runResults.reportPath })
      .from(schema.runResults)
      .where(eq(schema.runResults.runId, runId))
      .all()[0]
    if (!stored?.reportPath) {
      return new NextResponse('that run did not produce a report', { status: 404 })
    }
    return serve(stored.reportPath)
  }

  const domain = params.get('domain')
  if (!domain) return new NextResponse('missing domain or run', { status: 400 })

  // `doc=fix-pack` is the working document — every change in full, for a site
  // the console cannot publish to.
  return serve(params.get('doc') === 'fix-pack' ? fixPackFileFor(domain) : reportFileFor(domain))
}
