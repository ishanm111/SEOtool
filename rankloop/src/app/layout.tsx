import type { Metadata } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import './globals.css'

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

/**
 * Fonts, stylesheet and the document itself — nothing else.
 *
 * The two surfaces this app serves have no chrome in common. The operator
 * console under `(console)` shows every client and every control; the client
 * portal under `/portal` shows one client and no controls at all. Each brings
 * its own layout, and keeping this one empty is what makes it impossible for a
 * switcher or a run button to leak from one into the other.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
