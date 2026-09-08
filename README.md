# RankLoop

Measures whether a business gets recommended by AI assistants — ChatGPT, Gemini,
Perplexity and Google's AI Overview — then works out why not, and writes the
changes that fix it.

Point it at a URL. It figures out the rest.

```bash
npm run add-client https://example.com   # detects platform, business type, places, offerings
npm run ingest                           # reads every page
npm run prompts                          # writes the questions a customer would ask
npm run market                           # groups the places served into markets (multi-branch clients)
npm run login                            # one-time: log into the AI assistants
npm run measure                          # asks every engine, screenshots every answer
npm run competitors                      # crawls whoever AI recommends instead
npm run analyze                          # scores everything, builds the findings
npm run recommend                        # produces the changes to make
npm run report                           # a client-ready HTML audit
npm run dev                              # dashboard at localhost:3000
```

## Why this exists

Consumer use of AI to find local businesses went from 6% to 45% in a year, and
ChatGPT recommends roughly 1.2% of local businesses. Most owners have no idea
whether they are in that 1.2%.

Around ten tools now **measure** AI visibility. Almost none **fix** it, and none
work at city level for a single-location business. That gap is the product.

## What it does

**Detects** — platform (WordPress, Shopify, Webflow, Squarespace, Wix, custom),
business type (local service or online store), the places served, the services
or product categories, every phone number, and any place the site mentions that
it does *not* serve.

**Measures** — asks each AI engine a generated question set through a real
browser, saving the full answer text and a screenshot of every one. Extracts
which businesses were named, in what order, and which sources were cited.

**Compares** — crawls the exact pages the engines cited and scores competitors on
the same scale as the client: page counts, location pages, FAQ blocks,
statistics density, readability, structured data.

**Recommends** — titles, meta descriptions, copy rewrites, JSON-LD, whole
pages the site is missing, and the blog posts that answer the questions it
never does. Never design; only words, metadata and structure.

Blog topics are not invented. They are clustered out of every search term the
tool holds for a client — real Search Console queries where the property is
owned, the questions put to the AI engines, and the client's own offerings —
then filtered down to the ones no existing page answers.

## The research it is built on

Every scoring rule traces to the GEO paper (arXiv 2311.09735) rather than
opinion:

| Change | Measured effect on AI visibility |
|---|---|
| Add statistics and cited sources | **+40%** — the largest single lever |
| Improve readability and fluency | **+15–30%** |
| Add superlatives ("best", "#1") | **Neutral to negative** |

Two further findings shape the tool: ChatGPT, Copilot and Meta AI retrieve
through Bing's index rather than Google's, and `llms.txt` is measurably ignored
by every major crawler.

## Businesses in more than one place

A business with branches in two places is in two separate contests: different
competitors, a different map pack, a different set of answers. Reported as one
percentage, a strong market hides a weak one and the owner fixes the wrong thing.

So places are grouped into **markets**, and every measurement splits on them:

- The question set is generated **per market** — each gets its own core subset,
  anchored on its own town, rather than one town taking every high-intent
  question and the rest a passing mention.
- `npm run measure -- --market="Northern Virginia"` runs one market at a time,
  which keeps a session to a sane length when the core set has multiplied.
- Findings, the dashboard and the client report all carry a per-market rate
  alongside the combined one. A market with no answers is reported as
  *unmeasured*, never as fine.

Markets default to the state, which is right for branches in two states. For two
metros inside one state, group them by hand — no rule derived from a place name
can tell Richmond from Northern Virginia:

```bash
npm run market -- --client=1                                             # show the current grouping
npm run market -- --client=1 --location=6,7,8 --market="Northern Virginia"
npm run prompts -- --client=1                                            # regenerate so each market gets its own set
```

## The rule that matters most

**Nothing unverifiable is ever invented.** Prices, warranties, response times,
licensing and review counts are emitted as visible `[[FILL: …]]` placeholders
that block publication until a human confirms them.

A rewrite that reads beautifully and states a price the business does not charge
is worse than no rewrite. On a client's live site, a wrong claim is a legal
problem, not a style one.

## Architecture

```
src/
  onboard/     detection — URL in, client record out
  ingest/      adapters (wordpress, shopify, generic) + content scoring
  prompts/     question generation, per business type
  engines/     browser automation, Google, DataForSEO, Search Console
  analysis/    answer parsing, findings, competitor crawling
  recommend/   meta, copy, schema, new pages, blog posts from the keyword pool
  report/      the client-facing audit
  app/         dashboard
```

Nothing client-specific may live in code. Business names, places, industries and
phone numbers are all database rows, populated by detection.

## Data sources

| Source | Cost | Used for |
|---|---|---|
| Browser automation | Free | ChatGPT, Gemini, Perplexity, Google AI Overview + map pack |
| Google Search Console | Free | Real search queries for sites you own |
| Manual competitive bar | Free | Top three map-pack businesses, typed in |
| DataForSEO | $50 min | Optional. Only genuinely needed for clients in cities you are not in. |

Google's map pack — including competitor ratings and review counts — is captured
through the browser, so the paid API is optional rather than required.

## Setup

```bash
npm install
npm run migrate
```

Playwright drives your real Chrome, which must be **quit** before a measurement
run (macOS refuses a second session). Set `RANKLOOP_BROWSER=chromium` to use an
independent browser instead.

Optional credentials in `.env.local`:

```
DATAFORSEO_LOGIN=        # optional — city-level Google targeting
DATAFORSEO_PASSWORD=
GSC_CLIENT_ID=           # optional — free Search Console query data
GSC_CLIENT_SECRET=
GSC_REFRESH_TOKEN=       # from: npm run gsc-auth
```

## A note on the browser automation

Driving the consumer chat apps is against their terms of service. Use throwaway
accounts, keep the pacing slow, and understand the risk before running it at
volume.
