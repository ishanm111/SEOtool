import fs from 'node:fs'
import { activeClient } from '@/lib/active-client'
import { fixPackFileFor, pdfNameFor, pdfOutputDir, reportFileFor } from '@/lib/report-file'
import { NoClient } from '../_components/no-client'
import { NeedsRun } from '../_components/ui'
import { SaveDocuments } from '../_components/save-documents'
import path from 'node:path'

export const dynamic = 'force-dynamic'

/**
 * The client-facing audit, shown inside the dashboard.
 *
 * Deliberately the file itself in a frame rather than a React re-rendering of
 * the same data: the report is the deliverable, and the only way to be sure of
 * what a client will see is to look at exactly what gets sent.
 */
export default async function ReportPage() {
  const client = await activeClient()
  if (!client) return <NoClient />

  const file = reportFileFor(client.domain)
  const exists = fs.existsSync(file)
  const generatedOn = exists ? fs.statSync(file).mtime.toLocaleString() : null

  const fixPackExists = fs.existsSync(fixPackFileFor(client.domain))
  const auditPdf = path.join(pdfOutputDir(), pdfNameFor(client.domain, 'audit'))
  const pdfSavedOn = fs.existsSync(auditPdf) ? fs.statSync(auditPdf).mtime.toLocaleString() : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Client report</h1>
          <p className="mt-1 text-sm text-ink-3">
            {exists
              ? `The audit as ${client.name} would receive it. Generated ${generatedOn}.`
              : `No report has been generated for ${client.name} yet.`}
          </p>
          {exists && (
            <p className="mt-1 text-xs text-ink-3">
              {pdfSavedOn
                ? `PDFs on your Desktop, saved ${pdfSavedOn}. Pressing save writes them again from the current data.`
                : 'Save it as a PDF to your Desktop, together with the fix pack — every proposed change in full, for a site this console cannot publish to.'}
            </p>
          )}
        </div>
        {exists && (
          <div className="flex flex-wrap items-start gap-2">
            <a
              href={`/api/report?domain=${encodeURIComponent(client.domain)}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
            >
              Open full page
            </a>
            {fixPackExists && (
              <a
                href={`/api/report?domain=${encodeURIComponent(client.domain)}&doc=fix-pack`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
              >
                Open the fix pack
              </a>
            )}
            <SaveDocuments clientId={client.id} />
          </div>
        )}
      </div>

      {exists ? (
        <iframe
          title={`AI visibility audit for ${client.name}`}
          src={`/api/report?domain=${encodeURIComponent(client.domain)}`}
          // Inline height rather than a utility class: the frame has to fill the
          // viewport whatever the surrounding stylesheet does, and a report that
          // renders 150px tall reads as a broken report.
          style={{ height: '80vh' }}
          className="w-full card"
        />
      ) : (
        <NeedsRun
          what="No report has been generated yet"
          step="The report is the last step of a run, rendered from everything the earlier steps collected."
        />
      )}
    </div>
  )
}
