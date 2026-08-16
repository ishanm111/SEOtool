import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ACTIVE_CLIENT_COOKIE, activeClient, allClients } from '@/lib/active-client'

/**
 * Switches which client the whole dashboard is showing.
 *
 * Renders as a plain form so it works without client-side JavaScript, and only
 * appears at all when there is more than one client to switch between.
 */
export async function ClientSwitcher() {
  const clients = allClients()
  const active = await activeClient()
  if (clients.length <= 1 || !active) return null

  async function select(formData: FormData) {
    'use server'
    const id = String(formData.get('clientId') ?? '')
    if (!/^\d+$/.test(id)) return
    const store = await cookies()
    store.set(ACTIVE_CLIENT_COOKIE, id, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    revalidatePath('/', 'layout')
  }

  return (
    <form action={select} className="ml-auto flex items-center gap-2">
      <label htmlFor="clientId" className="text-xs uppercase tracking-wide text-zinc-500">
        Client
      </label>
      <select
        id="clientId"
        name="clientId"
        defaultValue={String(active.id)}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm text-zinc-700 transition hover:bg-zinc-100"
      >
        Switch
      </button>
    </form>
  )
}
