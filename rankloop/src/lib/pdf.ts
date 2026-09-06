import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

/**
 * Turning a generated document into a PDF.
 *
 * The HTML is the deliverable and the PDF is a copy of it, printed by the same
 * engine that renders it on screen — so a client reading the file and an
 * operator reading the page are looking at the same document. Nothing is
 * re-laid-out for print beyond the `@media print` rules the documents already
 * carry.
 *
 * The browser is the one Playwright bundles, which the tool already installs
 * for reading Google listings. A machine without it gets a clear reason and
 * still gets the HTML — a missing PDF must never fail a run whose real output
 * is the audit itself.
 */

export type PdfResult =
  | { ok: true; file: string; bytes: number }
  | { ok: false; file: string; error: string }

export async function htmlToPdf(html: string, outFile: string): Promise<PdfResult> {
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch {
    return {
      ok: false,
      file: outFile,
      error:
        'the bundled browser is not installed, so no PDF was written — run `npx playwright install chromium`',
    }
  }

  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    const page = await browser.newPage()

    /**
     * Loaded as a document rather than from disk, so a PDF can be produced for
     * a file that has not been written yet — and so the embedded screenshots,
     * which are data URIs, need no file access at all.
     */
    await page.setContent(html, { waitUntil: 'load' })
    // Print styling rather than screen styling: the documents already say what
    // must not break across a page, and that only applies to print media.
    await page.emulateMedia({ media: 'print' })

    await page.pdf({
      path: outFile,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#8a8880;padding:0 12mm;' +
        'display:flex;justify-content:space-between;font-family:-apple-system,sans-serif">' +
        '<span class="title"></span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
        '</div>',
    })

    return { ok: true, file: outFile, bytes: fs.statSync(outFile).size }
  } catch (err) {
    return {
      ok: false,
      file: outFile,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
