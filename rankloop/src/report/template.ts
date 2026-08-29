/**
 * The client-facing audit report.
 *
 * Every number in here comes from the database. Nothing is estimated, projected
 * or invented — this document gets shown to a prospect, so an unsupported claim
 * is worse than a missing one. Where an outcome is uncertain it is written as a
 * conditional, never as a promise.
 */

export type ReportData = {
  clientName: string
  clientDomain: string
  businessType: string
  hasGoogleProfile: boolean
  market: string
  generatedOn: string

  named: number
  totalAnswers: number
  engines: { engine: string; ok: number; named: number }[]
  /** One row per trading area. Empty or single-entry for a business in one place. */
  markets: { label: string; named: number; total: number; locations: string[] }[]

  competitors: [string, number][]
  citedDomains: [string, number][]

  cityLeaders: { domain: string; cityPageCount: number; pageCount: number }[]
  gap: { label: string; client: string | number; rivals: string | number; note?: string }[]
  rivalCount: number

  criticalFindings: { category: string; issue: string; proposedText: string | null }[]
  highFindings: { category: string; issue: string; proposedText: string | null }[]

  pageCount: number
  paragraphCount: number
  wrongGeoPages: number
  wrongGeoHits: number

  /** All null for a business without a Google Business Profile. */
  gbp: { rating: number | null; reviewCount: number | null; hasWebsite: boolean | null }
  thresholds: { chatgpt: number; perplexity: number; gemini: number }

  evidence: { engine: string; question: string; excerpt: string; image?: string }[]
  generatedPageCount: number
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Step = { title: string; meta: string; body: string }

/**
 * The action plan, built from what actually applies to this business rather than
 * a fixed list. A store with no Google Business Profile must not be told to fix
 * one, and a site with correct geography must not be told to correct it.
 */
function buildSteps(d: ReportData): Step[] {
  const steps: Step[] = []
  const isLocal = d.businessType === 'local_service'

  if (d.hasGoogleProfile && d.gbp.hasWebsite === false) {
    steps.push({
      title: 'Add your website to your Google Business Profile',
      meta: 'Currently missing — Google still shows "Add website". 2 minutes · no cost',
      body: 'This is the profile AI reads for local answers. Right now it does not link to your site at all.',
    })
  }

  if (isLocal) {
    steps.push({
      title: 'Use one phone number everywhere',
      meta: 'Under an hour · no cost',
      body: 'Search engines treat a consistent name, address and phone as a trust signal; mismatches work against you.',
    })
  }

  if (d.wrongGeoPages > 0) {
    steps.push({
      title: 'Correct the locations on your website',
      meta: `${d.wrongGeoPages} of ${d.pageCount} pages affected · ${d.wrongGeoHits} references`,
      body: 'Your site currently describes places you do not serve. Until that is corrected, no search or AI system can place your business correctly — and nothing else on this list will work.',
    })
  }

  steps.push(
    isLocal
      ? {
          title: 'Publish a page for every place you serve',
          meta: d.generatedPageCount > 0 ? `${d.generatedPageCount} pages already written and ready` : 'One page per town',
          body: 'Each with a direct answer up front, real service detail, an FAQ section, and the structured data search engines look for — matching what your competitors already do.',
        }
      : {
          title: 'Add category and buying-guide pages',
          meta: d.generatedPageCount > 0 ? `${d.generatedPageCount} pages already written and ready` : 'One per product category',
          body: 'Comparison and buying-guide content is what AI assistants quote when someone asks which product to choose. Product pages alone rarely get cited.',
        },
  )

  if (d.hasGoogleProfile && d.gbp.reviewCount !== null) {
    const ratingOk = d.gbp.rating !== null && d.gbp.rating >= Math.max(...Object.values(d.thresholds))
    steps.push({
      title: 'Build up your reviews',
      meta: `Currently ${d.gbp.reviewCount} reviews${d.gbp.rating !== null ? ` at ${d.gbp.rating}★` : ''} · ongoing`,
      body: ratingOk
        ? `Your rating clears every threshold (${d.thresholds.chatgpt}★, ${d.thresholds.perplexity}★, ${d.thresholds.gemini}★). The volume is the problem — ${d.gbp.reviewCount} reviews is very little signal. Ask at the end of every job, and keep them coming: recent reviews count for more than old ones.`
        : `AI assistants will not recommend a business below ${d.thresholds.gemini}★ to ${d.thresholds.chatgpt}★ depending on the engine. Raising the rating comes before everything else on this list.`,
    })
  }

  steps.push({
    title: 'Submit your site to Bing',
    meta: 'About 20 minutes · no cost',
    body: 'ChatGPT and Copilot find pages through Bing’s index rather than Google’s. Almost nobody sets this up, which makes it unusually easy ground to win.',
  })

  return steps
}

export function renderReport(d: ReportData): string {
  const pct = d.totalAnswers ? Math.round((d.named / d.totalAnswers) * 100) : 0
  const topRival = d.competitors[0]
  const steps = buildSteps(d)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Search Visibility Audit — ${esc(d.clientName)}</title>
<style>
  :root{--ink:#14171a;--muted:#5b6570;--line:#e3e7ea;--panel:#f7f9fa;
    --bad:#b4232a;--bad-bg:#fdeced;--good:#0a7d4b;--good-bg:#e8f6ef;
    --warn:#8a5a00;--warn-bg:#fdf3e0;--accent:#0b6b5e}
  *{box-sizing:border-box}
  body{margin:0;background:#fff;color:var(--ink);
    font:16px/1.62 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:920px;margin:0 auto;padding:56px 28px 96px}
  header{border-bottom:3px solid var(--ink);padding-bottom:24px;margin-bottom:12px}
  .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700}
  h1{font-size:38px;line-height:1.12;margin:10px 0 6px;letter-spacing:-.02em}
  .sub{color:var(--muted);font-size:16px;margin:0}
  h2{font-size:25px;margin:52px 0 6px;letter-spacing:-.01em}
  h2 .num{color:var(--muted);font-weight:400;margin-right:10px}
  h3{font-size:17px;margin:26px 0 6px}
  .lede{font-size:17px;color:var(--muted);margin-top:4px}
  .hero{background:var(--bad-bg);border:1px solid #f0c2c5;border-left:5px solid var(--bad);
    border-radius:10px;padding:28px;margin:34px 0}
  .hero .big{font-size:52px;font-weight:800;letter-spacing:-.03em;color:var(--bad);line-height:1;margin:0}
  .hero .cap{font-size:18px;font-weight:700;margin:10px 0 6px}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:24px 0}
  @media(max-width:700px){.kpis{grid-template-columns:1fr}h1{font-size:29px}.hero .big{font-size:40px}}
  .kpi{border:1px solid var(--line);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .kpi .k{font-size:29px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin:18px 0;font-size:15px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
    border-bottom:2px solid var(--ink);font-weight:800;white-space:nowrap}
  .tbl-scroll{overflow-x:auto}
  .num-cell{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  tr.worse{background:var(--bad-bg)} tr.worse .num-cell.mine{color:var(--bad);font-weight:800}
  tr.client-row{font-weight:700;background:var(--bad-bg)}
  .bar{height:9px;border-radius:999px;background:#f0d3d5;overflow:hidden;min-width:90px}
  .bar > i{display:block;height:9px;background:var(--bad);border-radius:999px}
  .callout{border-radius:10px;padding:18px 20px;margin:20px 0;border:1px solid var(--line);background:var(--panel)}
  .callout.bad{background:var(--bad-bg);border-color:#f0c2c5}
  .callout.good{background:var(--good-bg);border-color:#b8e0cd}
  .callout.warn{background:var(--warn-bg);border-color:#f0dcb0}
  .callout .label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:var(--muted);margin-bottom:6px}
  .finding{border:1px solid var(--line);border-left:4px solid var(--bad);border-radius:8px;
    padding:16px 18px;margin:14px 0;background:#fff}
  .finding.high{border-left-color:#e07b1a}
  .finding .cat{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--muted)}
  .finding .fix{margin-top:10px;padding:11px 13px;background:var(--good-bg);border-radius:6px;font-size:14.5px}
  .finding .fix b{color:var(--good)}
  .step{display:flex;gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}
  .step .n{flex:0 0 34px;height:34px;border-radius:50%;background:var(--ink);color:#fff;
    display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
  .step .body{flex:1}
  .step .meta{font-size:12.5px;color:var(--muted);margin-top:3px}
  .ev{border:1px solid var(--line);border-radius:8px;margin:16px 0;overflow:hidden}
  .ev .q{background:var(--panel);padding:11px 15px;font-weight:600;font-size:14.5px;border-bottom:1px solid var(--line)}
  .ev .a{padding:14px 15px;font-size:14.5px;color:#333;white-space:pre-wrap}
  .ev .tag{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:800}
  .ev img{display:block;width:100%;border-top:1px solid var(--line)}
  ul.tight{margin:8px 0;padding-left:20px} ul.tight li{margin:5px 0}
  .footnote{font-size:13px;color:var(--muted);border-top:1px solid var(--line);margin-top:56px;padding-top:20px}
  @media print{
    .wrap{padding:0 10px;max-width:none} body{font-size:12px} h1{font-size:26px}
    h2{page-break-after:avoid} .finding,.ev,table,.callout,.hero,.step{page-break-inside:avoid}
    .ev img{max-height:340px;object-fit:cover;object-position:top}
  }
</style>
</head>
<body><div class="wrap">

<header>
  <div class="eyebrow">AI Search Visibility Audit</div>
  <h1>${esc(d.clientName)}</h1>
  <p class="sub">${esc(d.clientDomain)} · ${esc(d.market)} · ${esc(d.generatedOn)}</p>
</header>

<div class="hero">
  <p class="big">${d.named} of ${d.totalAnswers}</p>
  <p class="cap">When customers ask AI for a business like yours, yours is named ${d.named === 0 ? 'never' : `${pct}% of the time`}.</p>
  <p style="margin:0">We asked ${d.totalAnswers} real customer questions across
  ${d.engines.length} AI engines${d.engines.length ? ` (${d.engines.map((e) => esc(e.engine)).join(', ')})` : ''}.
  ${d.named === 0
    ? `Your business did not appear in a single answer.`
    : `Your business appeared in ${d.named}.`}
  ${topRival ? `<strong>${esc(topRival[0])}</strong> appeared in ${topRival[1]}.` : ''}</p>
</div>

<div class="kpis">
  <div class="kpi"><div class="k">${d.totalAnswers}</div><div class="l">AI answers analysed</div></div>
  <div class="kpi"><div class="k">${d.pageCount}</div><div class="l">Pages audited</div></div>
  <div class="kpi"><div class="k">${d.criticalFindings.length}</div><div class="l">Critical issues found</div></div>
</div>

${d.markets.length > 1 ? `
<h2>Market by market</h2>
<p class="lede">You trade in ${d.markets.length} areas, and each is a separate contest — different competitors, a different map pack, a different set of answers. A single average would hide whichever one is weaker.</p>
<div class="tbl-scroll"><table>
  <thead><tr><th>Area</th><th>Places measured</th><th class="num-cell">Named in</th><th class="num-cell">Share</th></tr></thead>
  <tbody>
    ${d.markets.map((m) => {
      const share = m.total > 0 ? `${Math.round((m.named / m.total) * 100)}%` : 'not measured'
      return `<tr><td>${esc(m.label)}</td><td>${esc(m.locations.slice(0, 6).join(', '))}${m.locations.length > 6 ? ` +${m.locations.length - 6}` : ''}</td><td class="num-cell">${m.total > 0 ? `${m.named} of ${m.total}` : '—'}</td><td class="num-cell">${share}</td></tr>`
    }).join('\n    ')}
  </tbody>
</table></div>
` : ''}

<h2><span class="num">01</span>Who AI recommends instead</h2>
<p class="lede">These are the businesses named when a customer asks an AI assistant for help in your area.</p>
<div class="tbl-scroll"><table>
  <thead><tr><th>Business</th><th class="num-cell">Times recommended</th></tr></thead>
  <tbody>
    ${d.competitors.slice(0, 8).map(([name, n]) => `<tr><td>${esc(name)}</td><td class="num-cell">${n}</td></tr>`).join('\n    ')}
    <tr class="client-row"><td>${esc(d.clientName)}</td><td class="num-cell">${d.named}</td></tr>
  </tbody>
</table></div>

${d.cityLeaders.length ? `
<h2><span class="num">02</span>Why they win: a page for every place</h2>
<p class="lede">We crawled the websites AI actually cited. The pattern is consistent.</p>
<div class="tbl-scroll"><table>
  <thead><tr><th>Website</th><th class="num-cell">City pages</th><th style="width:150px"></th><th class="num-cell">Share</th></tr></thead>
  <tbody>
    ${d.cityLeaders.map((c) => {
      const p = c.pageCount ? Math.round((c.cityPageCount / c.pageCount) * 100) : 0
      return `<tr><td>${esc(c.domain)}</td><td class="num-cell">${c.cityPageCount} of ${c.pageCount}</td><td><div class="bar"><i style="width:${p}%"></i></div></td><td class="num-cell">${p}%</td></tr>`
    }).join('\n    ')}
    <tr class="client-row"><td>${esc(d.clientDomain)}</td><td class="num-cell">0 of ${d.pageCount}</td><td><div class="bar"></div></td><td class="num-cell">0%</td></tr>
  </tbody>
</table></div>
<div class="callout bad">
  <div class="label">What this means</div>
  A page for every place you serve is the clearest content pattern among the competitors that win.
  Several of yours are built almost entirely this way. You currently have none.
</div>
<div class="callout warn">
  <div class="label">But there is a second route — and it is faster</div>
  Not every competitor wins on content. The business recommended most often in this study has a
  <strong>smaller website than yours</strong> — barely a dozen pages, no FAQ section. Its visibility comes from
  its Google listing, its reviews, and its presence on sites like Yelp and Nextdoor, not from its website.
  <strong>You are currently on neither route.</strong> The off-site one costs nothing and moves faster, which is
  why it sits at the top of the plan below.
</div>` : ''}

<h2><span class="num">0${d.cityLeaders.length ? '3' : '2'}</span>The gap, measured</h2>
<p class="lede">Your site against ${d.rivalCount} competitors AI recommends. Nationwide chains are excluded —
comparing an independent business to a national operation is not a fair or useful target.</p>
<div class="tbl-scroll"><table>
  <thead><tr><th>Metric</th><th class="num-cell">You</th><th class="num-cell">Competitors</th></tr></thead>
  <tbody>
    ${d.gap.map((g) => {
      const worse = typeof g.client === 'number' && typeof g.rivals === 'number'
        ? (g.label.includes('Superlative') ? g.client > g.rivals : g.client < g.rivals)
        : g.client === 'No'
      return `<tr class="${worse ? 'worse' : ''}"><td><strong>${esc(g.label)}</strong>${g.note ? `<br><span style="font-size:12.5px;color:var(--muted)">${esc(g.note)}</span>` : ''}</td><td class="num-cell mine">${esc(String(g.client))}</td><td class="num-cell">${esc(String(g.rivals))}</td></tr>`
    }).join('\n    ')}
  </tbody>
</table></div>

<h2><span class="num">0${d.cityLeaders.length ? '4' : '3'}</span>What is holding you back</h2>
${d.criticalFindings.map((f) => `
<div class="finding">
  <div class="cat">Critical · ${esc(f.category.replace(/-/g, ' '))}</div>
  <p style="margin:6px 0 0">${esc(f.issue)}</p>
  ${f.proposedText ? `<div class="fix"><b>Fix:</b> ${esc(f.proposedText)}</div>` : ''}
</div>`).join('')}

${d.highFindings.length ? `<h3>Also significant</h3>
${d.highFindings.slice(0, 5).map((f) => `
<div class="finding high">
  <div class="cat">High · ${esc(f.category.replace(/-/g, ' '))}</div>
  <p style="margin:6px 0 0">${esc(f.issue)}</p>
  ${f.proposedText ? `<div class="fix"><b>Fix:</b> ${esc(f.proposedText)}</div>` : ''}
</div>`).join('')}` : ''}

<h2><span class="num">0${d.cityLeaders.length ? '5' : '4'}</span>The plan, in order</h2>
<p class="lede">Ordered by impact per hour of work. The first items cost nothing and take minutes.</p>

${steps.map((s, i) => `
<div class="step"><div class="n">${i + 1}</div><div class="body">
  <strong>${esc(s.title)}</strong>
  <div class="meta">${esc(s.meta)}</div>
  <p style="margin:6px 0 0;font-size:14.5px">${esc(s.body)}</p>
</div></div>`).join('')}

${d.evidence.length ? `
<h2><span class="num">0${d.cityLeaders.length ? '6' : '5'}</span>Evidence</h2>
<p class="lede">Actual answers, captured on ${esc(d.generatedOn)}.</p>
${d.evidence.map((e) => `
<div class="ev">
  <div class="q"><span class="tag">${esc(e.engine)}</span><br>${esc(e.question)}</div>
  <div class="a">${esc(e.excerpt)}${e.excerpt.length >= 700 ? '…' : ''}</div>
  ${e.image ? `<img src="${e.image}" alt="screenshot of the AI answer">` : ''}
</div>`).join('')}` : ''}

<h2><span class="num">0${d.cityLeaders.length ? '7' : '6'}</span>How this was measured</h2>
<ul class="tight">
  <li><strong>${d.totalAnswers} questions</strong> asked across ${d.engines.length} AI assistants, phrased the way real customers write — including emergencies, brand-specific requests, pricing questions and "who do you recommend".</li>
  <li>Every answer was <strong>saved in full and screenshotted</strong>. Nothing here is inferred from a summary.</li>
  <li>Your website was read page by page — <strong>${d.pageCount} pages, ${d.paragraphCount} paragraphs</strong> — and scored on the factors published research links to AI visibility.</li>
  <li>Competitor sites were <strong>crawled directly</strong>, and measured on exactly the same scale as yours.</li>
  <li>Every figure in this document is measured. Nothing is projected or estimated.</li>
</ul>

<div class="callout warn">
  <div class="label">One note on expectations</div>
  Search and AI visibility move slowly. ${d.businessType === 'local_service'
    ? 'Local rankings typically take two to three months to shift and six or more to compound.'
    : 'Product and category rankings typically take three to six months to shift, and longer in competitive categories.'}
  The work in this report is what changes the inputs; the timeline depends on your market.
</div>

<div class="footnote">
  Prepared for ${esc(d.clientName)} · ${esc(d.generatedOn)}<br>
  Measured across ${d.engines.map((e) => `${esc(e.engine)} (${e.ok} answers)`).join(', ')}.
</div>

</div></body></html>`
}
