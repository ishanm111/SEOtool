import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { reportFileFor } from '@/lib/report-file'

const REPORTS_DIR = path.resolve('reports')

/**
 * Serves a generated audit as its own document, so the dashboard can show the
 * exact file that gets sent to the client rather than a second rendering of it.
 *
 * Same rule as the screenshot route: a path is only served if it resolves inside
 * the reports directory.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain')
  if (!domain) return new NextResponse('missing domain', { status: 400 })

  const resolved = path.resolve(reportFileFor(domain))
  if (!resolved.startsWith(REPORTS_DIR + path.sep) || !fs.existsSync(resolved)) {
    return new NextResponse('no report generated yet', { status: 404 })
  }

  return new NextResponse(fs.readFileSync(resolved, 'utf8'), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
