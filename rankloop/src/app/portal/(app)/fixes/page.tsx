import { redirect } from 'next/navigation'
import { currentPortalSession } from '@/portal/auth'
import { portalFixes, tallyDecisions, type PortalFix } from '@/portal/queries'
import { decideAction } from '../../_actions/decisions'
import { DecisionPill, Empty, PortalHeader } from '../../_components/ui'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  meta_title: 'Page title',
  meta_description: 'Search description',
  copy: 'Wording on the page',
  schema: 'Structured data',
  new_page: 'A page you do not have',
  blog_post: 'A post to publish',
  image_alt: 'A description for a picture',
  link_text: 'The words in a link',
  heading: 'The main heading on a page',
  viewport: 'A tag that tells phones the width',
}

/**
 * Every proposed change, with the client's own yes or no on each.
 *
 * Approval is the point of this screen, so the two buttons are the only
 * controls and they sit at the bottom of every card. Nothing here publishes
 * anything: approving marks a change as wanted, and the operator's own screen
 * is where it is written to the site.
 */
export default async function PortalFixes() {
  const session = await currentPortalSession()
  if (!session) redirect('/portal/login')

  const fixes = portalFixes(session.client)
  const tally = tallyDecisions(fixes)

  if (fixes.length === 0) {
    return (
      <div className="space-y-6">
        <PortalHeader title="Proposed changes" />
        <Empty title="Nothing proposed yet.">
          Changes appear here once your site has been analysed.
        </Empty>
      </div>
    )
  }

  // Pending first: the rest are decided and only here to be changed one's mind
  // about, which is rarer than working through the queue.
  const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 }
  const sorted = [...fixes].sort(
    (a, b) => order[a.decision] - order[b.decision] || b.priority - a.priority,
  )

  return (
    <div className="space-y-6">
      <PortalHeader
        title="Proposed changes"
        lede="Nothing is published to your website until you approve it."
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-lg bg-amber-soft px-3 py-1 text-amber">
          {tally.pending} waiting
        </span>
        <span className="rounded-lg bg-pine-soft px-3 py-1 text-pine-deep">
          {tally.approved} approved
        </span>
        <span className="rounded-lg bg-sink px-3 py-1 text-ink-2">{tally.rejected} declined</span>
      </div>

      <div className="space-y-4">
        {sorted.map((fix) => (
          <FixCard key={fix.id} fix={fix} />
        ))}
      </div>
    </div>
  )
}

function FixCard({ fix }: { fix: PortalFix }) {
  return (
    <article className="rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionPill decision={fix.decision} />
        <span className="eyebrow">{KIND_LABEL[fix.kind] ?? fix.kind}</span>
        {fix.pageSlug && <span className="text-xs text-ink-3">{fix.pageSlug}</span>}
      </div>

      {fix.reason && <p className="mt-3 text-sm text-ink-2">{fix.reason}</p>}

      {fix.currentValue && (
        <div className="mt-3">
          <div className="eyebrow mb-1">Now</div>
          <p className="rounded border border-line bg-sink/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">
            {fix.currentValue}
          </p>
        </div>
      )}

      <div className="mt-3">
        <div className="eyebrow mb-1">Proposed</div>
        <p className="rounded border border-pine/20 bg-pine-soft/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
          {fix.proposedValue}
        </p>
      </div>

      {fix.placeholderCount > 0 && (
        <p className="mt-3 rounded border border-amber/25 bg-amber-soft p-3 text-sm">
          This one needs {fix.placeholderCount} detail
          {fix.placeholderCount === 1 ? '' : 's'} only you know — look for{' '}
          <code className="text-xs">[[FILL: …]]</code> above and tell your contact what goes there.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {fix.decision !== 'approved' && (
          <form action={decideAction}>
            <input type="hidden" name="recommendationId" value={fix.id} />
            <input type="hidden" name="decision" value="approved" />
            <button type="submit" className="btn btn-primary">
              Approve
            </button>
          </form>
        )}
        {fix.decision !== 'rejected' && (
          <form action={decideAction}>
            <input type="hidden" name="recommendationId" value={fix.id} />
            <input type="hidden" name="decision" value="rejected" />
            <button type="submit" className="btn">
              No thanks
            </button>
          </form>
        )}
        {fix.decision !== 'pending' && (
          <form action={decideAction}>
            <input type="hidden" name="recommendationId" value={fix.id} />
            <input type="hidden" name="decision" value="pending" />
            <button type="submit" className="btn text-ink-3">
              Undo
            </button>
          </form>
        )}
        {fix.decidedAt && (
          <span className="text-xs text-ink-3">
            {fix.decision} by {fix.decidedBy} on {fix.decidedAt.toLocaleDateString()}
          </span>
        )}
      </div>
    </article>
  )
}
