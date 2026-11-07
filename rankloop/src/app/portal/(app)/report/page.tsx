import fs from 'node:fs'
import { redirect } from 'next/navigation'
import { currentPortalSession } from '@/portal/auth'
import { reportFileFor } from '@/lib/report-file'
import { Empty, PortalHeader } from '../../_components/ui'

export const dynamic = 'force-dynamic'

/**
 * The full audit, shown as the document it is.
 *
 * A frame around the generated file rather than a re-rendering of the same
 * data, for the same reason the console does it: the report is the deliverable,
 * and the only way to be sure what a client is reading is to show them the file.
 */
export default async function PortalReport() {
  const session = await currentPortalSession()
  if (!session) redirect('/portal/login')

  const file = reportFileFor(session.client.domain)
  if (!fs.existsSync(file)) {
    return (
      <div className="space-y-6">
        <PortalHeader title="Full report" />
        <Empty title="No report has been generated yet.">
          It appears here after your first full run.
        </Empty>
      </div>
    )
  }

  const generatedOn = fs.statSync(file).mtime.toLocaleString()

  return (
    <div className="space-y-4">
      <PortalHeader title="Full report" lede={`Generated ${generatedOn}.`} />
      <iframe
        src="/portal/report/file"
        title={`${session.client.name} audit`}
        className="h-[80vh] w-full rounded-lg border border-line bg-white"
      />
    </div>
  )
}
