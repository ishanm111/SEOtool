import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentPortalSession } from '@/portal/auth'
import { signOutAction } from '../_actions/auth'

export const dynamic = 'force-dynamic'

/**
 * Everything a signed-in client sees.
 *
 * The gate is here rather than in `proxy.ts` because the check needs the
 * database, and proxy runs where better-sqlite3 does not. One `await` at the
 * top of the only layout these pages share is enough: a page cannot render
 * without its layout, so there is no route under `(app)` that can be reached
 * without a session.
 *
 * There is no client switcher and there are no run controls, by construction —
 * the nav is a fixed list of four links about one business.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await currentPortalSession()
  if (!session) redirect('/portal/login')

  const links = [
    { href: '/portal', label: 'Overview' },
    { href: '/portal/findings', label: 'What we found' },
    { href: '/portal/fixes', label: 'Proposed changes' },
    { href: '/portal/report', label: 'Full report' },
  ]

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="eyebrow">SEOmyze</div>
          <div className="display text-2xl text-pine-deep">{session.client.name}</div>
        </div>
        <form action={signOutAction}>
          <div className="flex items-center gap-3 text-sm text-ink-3">
            <span className="hidden sm:inline">{session.email}</span>
            <button type="submit" className="btn">
              Sign out
            </button>
          </div>
        </form>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-line py-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-2 transition hover:bg-sink hover:text-ink"
          >
            {l.label}
          </Link>
        ))}
        <Link
          href="/portal/password"
          className="ml-auto rounded-lg px-3 py-1.5 text-sm text-ink-3 transition hover:bg-sink hover:text-ink"
        >
          Password
        </Link>
      </nav>

      <main className="py-8">{children}</main>
    </div>
  )
}
