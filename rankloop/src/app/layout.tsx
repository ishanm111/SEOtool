import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { ClientSwitcher } from './_components/client-switcher'

export const metadata: Metadata = {
  title: 'RankLoop',
  description: 'AI search visibility for local businesses',
}

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/prompts', label: 'Answers' },
  { href: '/competitors', label: 'Competitors' },
  { href: '/findings', label: 'Findings' },
  { href: '/generated', label: 'Recommendations' },
  { href: '/pages', label: 'Site audit' },
  { href: '/competitive-bar', label: 'Review bar' },
  { href: '/clients', label: 'Clients' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Rank<span className="text-emerald-600">Loop</span>
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-md px-3 py-1.5 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <ClientSwitcher />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
