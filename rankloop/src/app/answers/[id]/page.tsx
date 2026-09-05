import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRun } from '@/lib/queries'

export const dynamic = 'force-dynamic'

/** Highlights the client's name inside the raw answer so it is findable at a glance. */
function Highlighted({ text, aliases }: { text: string; aliases: string[] }) {
  if (aliases.length === 0) return <>{text}</>
  const pattern = new RegExp(
    `(${aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  )
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark key={i} className="rounded bg-emerald-200 px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = getRun(Number(id))
  if (!data) notFound()

  const { run, prompt, client, mentions, citations } = data
  const localPack = run.rawPayload ? JSON.parse(run.rawPayload).localPack : null

  return (
    <div className="space-y-6">
      <Link href="/prompts" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← back to answers
      </Link>

      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {run.engine} · {run.runAt ? new Date(run.runAt).toLocaleString() : ''}
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{prompt?.text}</h1>
      </div>

      {!run.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>This run failed.</strong> {run.error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            What the engine said
          </h2>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
            {run.answerText ? <Highlighted text={run.answerText} aliases={client.aliases} /> : <em className="text-zinc-400">empty</em>}
          </div>
        </section>

        <div className="space-y-6">
          {run.screenshotPath && (
            <section className="rounded-lg border border-zinc-200 bg-white p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Screenshot
              </h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/screenshot?path=${encodeURIComponent(run.screenshotPath)}`}
                alt="engine answer screenshot"
                className="mt-3 w-full rounded border border-zinc-200"
              />
            </section>
          )}

          {localPack && localPack.length > 0 && (
            <section className="rounded-lg border border-zinc-200 bg-white p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Google map pack
              </h2>
              <ol className="mt-3 space-y-2 text-sm">
                {localPack.map((l: { title: string; rating: number | null; ratingCount: number | null }, i: number) => (
                  <li key={i}>
                    <div className="font-medium">{l.title}</div>
                    <div className="text-zinc-500">
                      {l.rating ?? '?'}★ · {l.ratingCount ?? '?'} reviews
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Businesses named ({mentions.length})
            </h2>
            <ol className="mt-3 space-y-1.5 text-sm">
              {mentions.length === 0 && <li className="text-zinc-400">none detected</li>}
              {mentions.map((m) => (
                <li key={m.id} className={m.isClient ? 'font-semibold text-emerald-700' : ''}>
                  {m.position}. {m.businessName}
                  {m.isClient && ' ← client'}
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Sources cited ({citations.length})
            </h2>
            <ol className="mt-3 space-y-1.5 text-sm">
              {citations.length === 0 && <li className="text-zinc-400">none captured</li>}
              {citations.map((c) => (
                <li key={c.id} className={c.isClientDomain ? 'font-semibold text-emerald-700' : ''}>
                  <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {c.domain}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}
