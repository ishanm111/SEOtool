import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { activeClient } from '@/lib/active-client'
import { NoClient } from '../_components/no-client'

export const dynamic = 'force-dynamic'

/**
 * The bar a client has to clear: the top three businesses in the local map pack,
 * with their ratings and review counts.
 *
 * Typed in by hand from a Google search, which takes about ten minutes and costs
 * nothing. The findings engine reads these rows without knowing where they came
 * from, so wiring an API in later changes nothing downstream.
 *
 * This is what turns "get more reviews" into "you need 212 to match the leader;
 * you have 2" — the single most useful number in a local audit.
 */
export default async function CompetitiveBarPage() {
  const client = await activeClient()
  if (!client) return <NoClient />

  const locations = db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.clientId, client.id))
    .all()

  const rows = db
    .select()
    .from(schema.competitiveBar)
    .where(eq(schema.competitiveBar.clientId, client.id))
    .all()
    .sort((a, b) => a.rank - b.rank)

  async function save(formData: FormData) {
    'use server'
    const clientId = Number(formData.get('clientId'))
    if (!Number.isFinite(clientId)) return

    const locationRaw = String(formData.get('locationId') ?? '')
    const locationId = /^\d+$/.test(locationRaw) ? Number(locationRaw) : null

    // Replace the whole set for this location: a map pack is a snapshot of three
    // businesses, not a list that accumulates.
    const existing = db
      .select()
      .from(schema.competitiveBar)
      .where(eq(schema.competitiveBar.clientId, clientId))
      .all()
      .filter((r) => (r.locationId ?? null) === locationId)
    for (const r of existing) {
      db.delete(schema.competitiveBar).where(eq(schema.competitiveBar.id, r.id)).run()
    }

    /**
     * An empty field means "not looked up", not zero. `Number('')` is 0, so a
     * blank review count would otherwise be stored as a real zero and reported
     * as though the competitor genuinely has no reviews — a fact the tool never
     * established.
     */
    const numberOrNull = (raw: FormDataEntryValue | null): number | null => {
      const s = String(raw ?? '').trim()
      if (s === '') return null
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    }

    for (const rank of [1, 2, 3]) {
      const name = String(formData.get(`name${rank}`) ?? '').trim()
      if (!name) continue
      db.insert(schema.competitiveBar)
        .values({
          clientId,
          locationId,
          rank,
          businessName: name,
          rating: numberOrNull(formData.get(`rating${rank}`)),
          reviewCount: numberOrNull(formData.get(`reviews${rank}`)),
          source: 'manual',
        })
        .run()
    }

    revalidatePath('/competitive-bar')
    revalidatePath('/findings')
  }

  // Only meaningful once at least one competitor's review count is actually known.
  const knownCounts = rows.map((r) => r.reviewCount).filter((n): n is number => n !== null)
  const gap =
    client.gbpReviewCount !== null && knownCounts.length > 0
      ? Math.max(...knownCounts) - client.gbpReviewCount
      : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competitive bar</h1>
        <p className="mt-1 text-sm text-zinc-500">
          The three businesses Google shows on the map, with their ratings and review counts. Ten
          minutes of looking, and it turns every review finding into a specific target.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm">
        <h2 className="font-semibold">How to fill this in</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-zinc-700">
          <li>
            Google <em>&ldquo;{client.offerings[0] ?? 'your service'} {locations[0]?.name ?? 'your town'}&rdquo;</em>
          </li>
          <li>Look at the three businesses shown on the map</li>
          <li>Type their names, star ratings and review counts below</li>
        </ol>
      </section>

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Recorded</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 tabular-nums text-zinc-500">{r.rank}</td>
                  <td className="px-4 py-2 font-medium">{r.businessName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.rating ?? '?'}★</td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-600">
                    {r.reviewCount ?? '?'} reviews
                  </td>
                </tr>
              ))}
              <tr className="bg-zinc-50 font-semibold">
                <td className="px-4 py-2" />
                <td className="px-4 py-2">{client.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {client.gbpRating !== null ? `${client.gbpRating}★` : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {client.gbpReviewCount !== null ? `${client.gbpReviewCount} reviews` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
          {gap !== null && gap > 0 && (
            <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>{gap} reviews behind the leader.</strong> That is the target — a number, not
              &ldquo;get more reviews&rdquo;.
            </div>
          )}
        </section>
      )}

      <form action={save} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
        <input type="hidden" name="clientId" value={client.id} />

        {locations.length > 0 && (
          <div>
            <label htmlFor="locationId" className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Which place
            </label>
            <select
              id="locationId"
              name="locationId"
              className="mt-1 block w-full max-w-xs rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-3">
          {[1, 2, 3].map((rank) => {
            const existing = rows.find((r) => r.rank === rank)
            return (
              <div key={rank} className="grid gap-2 sm:grid-cols-[2rem_1fr_6rem_8rem]">
                <div className="flex items-center text-sm font-semibold text-zinc-500">{rank}.</div>
                <input
                  name={`name${rank}`}
                  defaultValue={existing?.businessName ?? ''}
                  placeholder="Business name"
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                />
                <input
                  name={`rating${rank}`}
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  defaultValue={existing?.rating ?? ''}
                  placeholder="4.8"
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm tabular-nums"
                />
                <input
                  name={`reviews${rank}`}
                  type="number"
                  min="0"
                  defaultValue={existing?.reviewCount ?? ''}
                  placeholder="212"
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm tabular-nums"
                />
              </div>
            )
          })}
        </div>

        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          Save
        </button>
        <p className="text-xs text-zinc-500">
          Saving replaces whatever is recorded for this place. Re-run{' '}
          <code className="rounded bg-zinc-100 px-1 py-0.5">analyze.ts</code> afterwards to fold the
          numbers into the findings.
        </p>
      </form>
    </div>
  )
}
