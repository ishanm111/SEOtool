'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Re-fetches the page while something is still happening on the server.
 *
 * A run writes its output to the database as it goes, so the only thing missing
 * is a reason to look again. Polling stops the moment the work finishes, so a
 * finished run costs nothing to leave open.
 */
export function AutoRefresh({ everyMs = 3000, active }: { everyMs?: number; active: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => router.refresh(), everyMs)
    return () => clearInterval(id)
  }, [active, everyMs, router])

  return null
}
