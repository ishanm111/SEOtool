import Link from 'next/link'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ACTIVE_CLIENT_COOKIE, activeClient, allClients } from '@/lib/active-client'

/**
 * Which client the whole console is showing.
 *
 * Kept as a plain form so it works without client-side JavaScript, and switching
 * submits on change so nobody has to find a second button. It renders even with
 * one client, because the same control is where a new one gets added.
 */
export async function ClientSwitcher() {
  const clients = allClients()
  const active = await activeClient()

  async function select(formData: FormData) {
    'use server'
    const id = String(formData.get('clientId') ?? '')
    if (!/^\d+$/.test(id)) return
    const store = await cookies()
    store.set(ACTIVE_CLIENT_COOKIE, id, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    revalidatePath('/', 'layout')
  }

  if (clients.length === 0 || !active) {
    return (
      <Link href="/clients/new" className="btn btn-primary w-full">
        Add your first client
      </Link>
    )
  }

  return (
    <div className="space-y-2">
      <form action={select}>
        <label htmlFor="clientId" className="field-label">
          Viewing
        </label>
        {/*
          Keyed on the active client so React rebuilds the element when the
          client changes elsewhere. Without it the browser keeps the selection
          it already had, and the switcher sits there naming a client the rest
          of the screen is no longer showing.
        */}
        <select
          key={active.id}
          id="clientId"
          name="clientId"
          defaultValue={String(active.id)}
          className="field text-sm"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary btn-sm mt-2 w-full">
          Switch client
        </button>
      </form>
      <Link href="/clients/new" className="btn btn-primary btn-sm w-full">
        + New client
      </Link>
    </div>
  )
}
