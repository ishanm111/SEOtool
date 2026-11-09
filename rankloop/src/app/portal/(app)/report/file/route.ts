import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { currentPortalSession } from '@/portal/auth'
import { REPORTS_DIR, reportFileFor } from '@/lib/report-file'

/**
 * The signed-in client's own audit, as the file itself.
 *
 * Deliberately not the console's `/api/report`, which takes the domain from the
 * query string: that is right for an operator and wrong here, because it would
 * let a signed-in client read another client's audit by editing a URL. This
 * route takes no parameters at all — the only report it can serve is the one
 * belonging to the session.
 */
export async function GET() {
  const session = await currentPortalSession()
  if (!session) return new NextResponse('sign in first', { status: 401 })

  const resolved = path.resolve(reportFileFor(session.client.domain))
  if (!resolved.startsWith(REPORTS_DIR + path.sep) || !fs.existsSync(resolved)) {
    return new NextResponse('no report generated yet', { status: 404 })
  }

  return new NextResponse(fs.readFileSync(resolved, 'utf8'), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
