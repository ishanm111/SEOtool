import type { ReportData, ReportFix } from './template'

/**
 * Every change, in full, for a site nobody can publish to from here.
 *
 * The console writes fixes straight into WordPress and Shopify. Everything else
 * — a site in a git repository, a hand-built template, a platform with no write
 * API — has no path, and the fix list then lives inside a dashboard nobody can
 * work from. This is that list as a document: each change with the page it
 * belongs to, the exact text it replaces, and the exact text to put there.
 *
 * It is a working document rather than a client-facing one, so it is dense on
 * purpose: no charts, no narrative, nothing summarised. Anything summarised
 * would have to be looked up again before it could be applied.
 *
 * The report and this share a data source, so the two can never describe
 * different work.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const KIND_LABEL: Record<string, string> = {
  meta_title: 'Page title',
  meta_description: 'Search description',
  copy: 'Body copy',
  schema: 'Structured data (JSON-LD)',
  new_page: 'New page',
  blog_post: 'New blog post',
}

/** What a person has to do with each kind, since none of these are published from here. */
const KIND_HOW: Record<string, string> = {
  meta_title: 'Replace the page title in the template, the front matter, or the SEO plugin field.',
  meta_description: 'Replace the meta description the page emits.',
  copy: 'Find the text under "Replaces" exactly as written and swap it for the new text. If it cannot be found exactly, leave it and say so — a fuzzy match on a live page is not worth the risk.',
  schema: 'Add as a <script type="application/ld+json"> block in the page template. Do not merge it into an existing block by hand; replace the block or add a second one.',
  new_page: 'Create the page at the slug given, paste the body, and link it from the navigation.',
  blog_post:
    'Publish as a post at the slug given. Fill in every highlighted gap first — a post is the easiest place to publish a number nobody checked. Link it from the service or collection page it is about.',
}

const ORDER = ['meta_title', 'meta_description', 'copy', 'schema', 'new_page', 'blog_post']

function fixBlock(fix: ReportFix, index: number): string {
  return `
<article class="fix${fix.placeholderCount > 0 ? ' blocked' : ''}">
  <div class="head">
    <span class="n">${index}</span>
    <span class="kind">${esc(KIND_LABEL[fix.kind] ?? fix.kind)}</span>
    ${fix.placeholderCount > 0 ? `<span class="flag">${fix.placeholderCount} value${fix.placeholderCount === 1 ? '' : 's'} to confirm first</span>` : ''}
  </div>
  <div class="where">${esc(fix.url ?? fix.target ?? 'site-wide')}</div>
  ${fix.reason ? `<p class="why">${esc(fix.reason)}</p>` : ''}
  ${
    fix.currentValue
      ? `<div class="label">Replaces — must match exactly</div><pre class="old">${esc(fix.currentValue)}</pre>`
      : '<div class="label">Nothing to replace — this is new</div>'
  }
  <div class="label">New value</div><pre class="new">${esc(fix.proposedValue)}</pre>
  <p class="how">${esc(KIND_HOW[fix.kind] ?? '')}</p>
</article>`
}

export function renderFixPack(d: ReportData): string {
  const blocked = d.fixes.filter((f) => f.placeholderCount > 0)
  const kinds = ORDER.filter((k) => d.fixes.some((f) => f.kind === k))
  let n = 0

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.clientName)} — fix pack</title>
<style>
  :root{--ink:#1a1a19;--muted:#6b6a63;--line:#e4e0d6;--good:#2f6b4f;--good-bg:#f0f6f1;
    --warn:#b26a12;--warn-bg:#fdf5e9;--code:#f6f4ef}
  *{box-sizing:border-box}
  body{margin:0;background:#fff;color:var(--ink);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  .wrap{max-width:900px;margin:0 auto;padding:40px 32px 64px}
  h1{font-size:27px;margin:0 0 4px;letter-spacing:-.02em}
  h2{font-size:18px;margin:34px 0 10px;padding-top:14px;border-top:2px solid var(--ink)}
  .sub{color:var(--muted);margin:0 0 22px;font-size:14px}
  .counts{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}
  .count{border:1px solid var(--line);border-radius:8px;padding:9px 13px;font-size:13px}
  .count b{display:block;font-size:20px;letter-spacing:-.02em}
  .note{border:1px solid var(--line);border-left:4px solid var(--warn);background:var(--warn-bg);
    border-radius:8px;padding:13px 15px;margin:16px 0;font-size:14px}
  .fix{border:1px solid var(--line);border-radius:9px;padding:15px 17px;margin:14px 0}
  .fix.blocked{border-left:4px solid var(--warn)}
  .fix .head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .fix .n{background:var(--ink);color:#fff;border-radius:5px;font-size:12px;font-weight:700;
    padding:2px 7px}
  .fix .kind{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;
    color:var(--muted)}
  .fix .flag{font-size:11.5px;font-weight:700;color:var(--warn)}
  .fix .where{margin-top:6px;font-size:13px;color:var(--muted);word-break:break-all}
  .fix .why{margin:9px 0 0;font-size:13.5px;color:#444}
  .label{margin-top:12px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;
    font-weight:800;color:var(--muted)}
  pre{margin:5px 0 0;padding:11px 13px;border-radius:6px;background:var(--code);
    font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;
    word-break:break-word;border:1px solid var(--line)}
  pre.new{background:var(--good-bg);border-color:#cfe3d5}
  .how{margin:10px 0 0;font-size:12.5px;color:var(--muted)}
  .footnote{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);
    font-size:12px;color:var(--muted)}
  @media print{
    .wrap{max-width:none;padding:0}
    .fix{page-break-inside:avoid}
    h2{page-break-after:avoid}
  }
</style></head>
<body><div class="wrap">

<h1>${esc(d.clientName)} — fix pack</h1>
<p class="sub">${esc(d.clientDomain)} · ${esc(d.generatedOn)} · every change in full, for applying by hand or in the repository.</p>

<div class="counts">
  <div class="count"><b>${d.fixes.length}</b>changes in total</div>
  <div class="count"><b>${d.fixes.length - blocked.length}</b>ready as written</div>
  <div class="count"><b>${blocked.length}</b>need a value confirmed</div>
</div>

${
  blocked.length > 0
    ? `<div class="note"><strong>${blocked.length} change${blocked.length === 1 ? '' : 's'} contain a <code>[[FILL: …]]</code> marker.</strong>
  That is a price, a warranty, a response time or a credential the tool refuses to invent. Publishing one as it stands puts a claim on the site that nobody verified, so fill it in first or leave that change out.</div>`
    : ''
}

<div class="note" style="border-left-color:var(--good);background:var(--good-bg)">
  <strong>Applying these by hand.</strong> Every "Replaces" block is the exact text on the page today. Match it exactly; if it has changed since this was generated, stop and re-run the audit rather than guessing at the nearest paragraph.
</div>

${kinds
  .map((kind) => {
    const group = d.fixes.filter((f) => f.kind === kind)
    return `
<h2>${esc(KIND_LABEL[kind] ?? kind)} — ${group.length}</h2>
${group.map((f) => fixBlock(f, ++n)).join('')}`
  })
  .join('')}

${d.fixes.length === 0 ? '<p class="sub">No changes have been generated for this client yet. Run the recommendations step.</p>' : ''}

<div class="footnote">
  ${esc(d.clientName)} · ${esc(d.clientDomain)} · generated ${esc(d.generatedOn)}.
  Every value here is produced from what the audit read; nothing in it is invented, and anything that would have been is a <code>[[FILL: …]]</code> marker instead.
</div>

</div></body></html>`
}
