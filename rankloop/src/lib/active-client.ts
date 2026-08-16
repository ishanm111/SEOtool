import 'server-only'
import { cookies } from 'next/headers'
import { getClient, listClients } from './queries'
import type { Client } from './client'

export const ACTIVE_CLIENT_COOKIE = 'rankloop_client'

/**
 * The client currently being viewed.
 *
 * Held in a cookie rather than a URL parameter so it survives navigation without
 * every link having to carry it — and so a page can never accidentally render
 * one client's heading above another client's numbers.
 */
export async function activeClient(): Promise<Client | null> {
  const store = await cookies()
  const raw = store.get(ACTIVE_CLIENT_COOKIE)?.value
  const id = raw ? Number(raw) : undefined

  // Falls back to the first client when the cookie points at one that has been
  // removed, rather than rendering an empty dashboard.
  return getClient(Number.isFinite(id) ? id : undefined) ?? getClient()
}

export function allClients() {
  return listClients()
}
