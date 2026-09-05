'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The sidebar links, split into what the tool does for the whole book of
 * business and what it shows about the one client being viewed.
 *
 * A client component only because the current section has to be visible: in a
 * console with this many screens, a nav that does not say where you are makes
 * every page look like the same page.
 */

export type NavItem = { href: string; label: string; badge?: number | null }
export type NavGroup = { title: string; items: NavItem[] }

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()

  return (
    <nav className="space-y-6">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="eyebrow px-3 pb-2">{group.title}</div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                      active
                        ? 'bg-pine-soft font-semibold text-pine-deep'
                        : 'text-ink-2 hover:bg-sink hover:text-ink'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.badge ? (
                      <span
                        className={`pill ${
                          active ? 'bg-pine text-white' : 'bg-rose-soft text-rose'
                        }`}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
