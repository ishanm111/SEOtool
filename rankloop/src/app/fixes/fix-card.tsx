'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { applyFixAction, revertFixAction } from '../_actions/fixes'
import { emptyFixState, type FixState } from '../_actions/form-state'
import { Pill, timeAgo } from '../_components/ui'
import type { FixRow } from '@/lib/fix-queries'

/**
 * One proposed change, with what is there now beside what would replace it.
 *
 * Both values are always shown. Publishing to somebody else's live website
 * without seeing the before and the after side by side is not a decision anyone
 * should be asked to make from a summary.
 */

const KIND_LABEL: Record<string, string> = {
  meta_title: 'Page title',
  meta_description: 'Search description',
  copy: 'Body copy',
  schema: 'Structured data',
  new_page: 'New page',
  blog_post: 'Blog post',
}

function ApplyButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {pending ? 'Publishing…' : label}
    </button>
  )
}

function RevertButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-danger btn-sm" disabled={pending}>
      {pending ? 'Putting back…' : 'Undo on the site'}
    </button>
  )
}

export function FixCard({ fix }: { fix: FixRow }) {
  const [applyState, apply] = useActionState<FixState, FormData>(applyFixAction, emptyFixState)
  const [revertState, revert] = useActionState<FixState, FormData>(revertFixAction, emptyFixState)
  const state = applyState.error || applyState.notice ? applyState : revertState

  const isApplied = fix.applied?.status === 'applied'
  const lastFailed = fix.applied?.status === 'failed'

  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="brand">{KIND_LABEL[fix.kind] ?? fix.kind}</Pill>
            {isApplied && <Pill tone="good">Published {timeAgo(fix.applied?.appliedAt)}</Pill>}
            {lastFailed && <Pill tone="bad">Last attempt failed</Pill>}
            {fix.placeholderCount > 0 && (
              <Pill tone="warn">{fix.placeholderCount} to fill in</Pill>
            )}
          </div>
          <p className="mt-1.5 truncate text-sm font-medium">{fix.target}</p>
          {fix.pageUrl && (
            <a
              href={fix.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-ink-3 hover:text-pine hover:underline"
            >
              {fix.pageUrl}
            </a>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {fix.blockedBecause ? null : isApplied ? (
            <form action={revert}>
              <input type="hidden" name="applicationId" value={fix.applied?.id ?? ''} />
              <RevertButton />
            </form>
          ) : (
            <form action={apply}>
              <input type="hidden" name="recommendationId" value={fix.id} />
              <ApplyButton label={lastFailed ? 'Try again' : 'Publish this fix'} />
            </form>
          )}
        </div>
      </header>

      <div className="grid gap-0 sm:grid-cols-2">
        <div className="border-b border-line p-5 sm:border-b-0 sm:border-r">
          <div className="eyebrow">On the site now</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">
            {fix.currentValue?.trim() || <span className="italic text-ink-3">nothing there</span>}
          </p>
        </div>
        <div className="bg-pine-soft/40 p-5">
          <div className="eyebrow text-pine-deep">Proposed</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{fix.proposedValue}</p>
        </div>
      </div>

      <footer className="space-y-3 border-t border-line px-5 py-4">
        {fix.reason && <p className="text-sm text-ink-2">{fix.reason}</p>}

        {fix.blockedBecause && (
          <p className="rounded-lg border border-amber/25 bg-amber-soft p-3 text-sm text-amber">
            {fix.blockedBecause}
          </p>
        )}

        {lastFailed && fix.applied?.error && !state.error && (
          <p className="rounded-lg border border-rose/25 bg-rose-soft p-3 text-sm text-rose">
            {fix.applied.error}
          </p>
        )}

        {state.error && (
          <p className="rounded-lg border border-rose/25 bg-rose-soft p-3 text-sm text-rose">
            {state.error}
          </p>
        )}
        {state.notice && (
          <p className="rounded-lg border border-moss/25 bg-moss-soft p-3 text-sm text-moss-deep">
            {state.notice}
          </p>
        )}
      </footer>
    </article>
  )
}
