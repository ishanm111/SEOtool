import { getPages } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { activeClient } from '@/lib/active-client'

export const dynamic = 'force-dynamic'

export default async function SiteAuditPage() {
  const client = await activeClient()
  if (!client) return <NoClient />
  const pages = getPages(client)
  const offenders = pages.filter((p) => p.wrongGeoHits > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Site audit</h1>
        <p className="mt-1 text-sm text-ink-3">
          All {pages.length} pages, sorted by how strongly they point outside the service area.{' '}
          {offenders.length} of them reference places outside the service area.
        </p>
      </div>

      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3">Page</th>
              <th className="px-3 py-3 text-right">Words</th>
              <th className="px-3 py-3 text-right">Wrong-area refs</th>
              <th className="px-4 py-3">Which terms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pages.map((p) => {
              const terms = JSON.parse(p.geoRefs || '[]') as string[]
              return (
                <tr key={p.id} className="hover:bg-sink">
                  <td className="px-4 py-3">
                    <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                      /{p.slug}
                    </a>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-3">{p.wordCount}</td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums font-medium ${
                      p.wrongGeoHits > 0 ? 'text-rose' : 'text-pine'
                    }`}
                  >
                    {p.wrongGeoHits}
                  </td>
                  <td className="max-w-md px-4 py-3 text-xs text-ink-3">
                    <span className="line-clamp-2">{terms.slice(0, 8).join(', ')}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
