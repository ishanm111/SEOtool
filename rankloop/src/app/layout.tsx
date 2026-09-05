import type { Metadata } from 'next'
import Link from 'next/link'
import { Fraunces, Inter } from 'next/font/google'
import './globals.css'
import { ClientSwitcher } from './_components/client-switcher'
import { NavLinks, type NavGroup } from './_components/nav'
import { activeClient } from '@/lib/active-client'
import { listClientCards } from '@/lib/run-queries'

/**
 * Inter for reading, Fraunces for looking at.
 *
 * Self-hosted by next/font rather than linked from Google, so no page in the
 * console makes an outbound request while an operator is screen-sharing it.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  // A variable font, so the whole weight range comes for free. `opsz` is
  // requested explicitly because the CSS asks for optical sizing.
  axes: ['opsz'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SEOmyze — AI search visibility',
  description: 'Measure whether AI engines name a business, and fix the site so they do.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const client = await activeClient()
  const cards = listClientCards()
  const card = client ? cards.find((c) => c.client.id === client.id) ?? null : null
  const runningCount = cards.filter((c) => c.activeRun).length

  const groups: NavGroup[] = [
    {
      title: 'Workspace',
      items: [
        { href: '/', label: 'Home' },
        { href: '/clients', label: 'Clients' },
        { href: '/runs', label: 'Runs', badge: runningCount || null },
      ],
    },
  ]

  if (client) {
    groups.push({
      title: client.name,
      items: [
        { href: '/overview', label: 'Overview' },
        { href: '/intake', label: 'Questionnaire' },
        { href: '/prompts', label: 'AI answers' },
        { href: '/competitors', label: 'Competitors' },
        { href: '/findings', label: 'Findings', badge: card?.criticalFindings || null },
        { href: '/generated', label: 'Recommendations' },
        { href: '/fixes', label: 'Apply fixes' },
        { href: '/pages', label: 'Site audit' },
        { href: '/competitive-bar', label: 'Review bar' },
        { href: '/report', label: 'Client report' },
        { href: '/history', label: 'History' },
      ],
    })
  }

  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-full">
        <div className="lg:flex">
          <aside className="border-b border-line bg-card/70 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
            <div className="flex items-center gap-2 px-5 py-5">
              <Link href="/" className="flex items-center gap-2">
                <SEOmyzeMark />
                <span className="display text-xl text-pine-deep">SEOmyze</span>
              </Link>
            </div>

            <div className="px-3 pb-4">
              <ClientSwitcher />
            </div>

            <div className="px-2 pb-8">
              <NavLinks groups={groups} />
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}

/** A lit signal: the thing the tool is measuring, drawn once. */
function SEOmyzeMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="var(--color-pine-soft)" />
      <circle cx="12" cy="12" r="3.2" fill="var(--color-pine)" />
      <path
        d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4"
        stroke="var(--color-pine)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.4 6.4l1.7 1.7M15.9 15.9l1.7 1.7M17.6 6.4l-1.7 1.7M8.1 15.9l-1.7 1.7"
        stroke="var(--color-moss)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  )
}
