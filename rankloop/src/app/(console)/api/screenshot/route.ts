import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

const SHOTS_DIR = path.resolve('screenshots')

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('path')
  if (!requested) return new NextResponse('missing path', { status: 400 })

  // Only ever serve files that resolve inside ./screenshots.
  const resolved = path.resolve(requested)
  if (!resolved.startsWith(SHOTS_DIR + path.sep) || !fs.existsSync(resolved)) {
    return new NextResponse('not found', { status: 404 })
  }

  return new NextResponse(new Uint8Array(fs.readFileSync(resolved)), {
    headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
  })
}
