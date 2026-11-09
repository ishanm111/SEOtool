import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ACTIVE_CLIENT_COOKIE } from '@/lib/active-client'

/**
 * Makes one client the one the rest of the console is showing, and optionally
 * goes straight to a screen about them.
 *
 * A form rather than a link, because switching writes a cookie — and a GET that
 * changes state is the kind of thing a browser prefetch triggers by accident.
 *
 * The `to` argument is what makes a cross-client link safe. Every per-client
 * screen reads the cookie, so a plain link from a card about one business to
 * /findings would show a different business's findings under that business's
 * name. Switching first is the only way that link can mean what it says.
 */
export function SwitchToClient({
  clientId,
  to,
  label = 'Open',
  variant = 'secondary',
}: {
  clientId: number
  to?: string
  label?: string
  variant?: 'primary' | 'secondary'
}) {
  async function select() {
    'use server'
    const store = await cookies()
    store.set(ACTIVE_CLIENT_COOKIE, String(clientId), { path: '/', maxAge: 60 * 60 * 24 * 365 })
    revalidatePath('/', 'layout')
    if (to) redirect(to)
  }

  return (
    <form action={select}>
      <button type="submit" className={`btn btn-${variant} ${to ? 'btn-sm' : ''}`}>
        {label}
      </button>
    </form>
  )
}
