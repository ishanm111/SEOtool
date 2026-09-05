# SEOmyze

Measures whether the AI engines name a business when a customer asks for one, works
out why they do not, and publishes the fixes to that business's own website.

Everything is driven from the web console. The command line still works and is
still supported — the console spawns the same scripts rather than a second
implementation of them — but nothing has to be typed to run a client.

```bash
npm install
npm run migrate
npm run dev          # http://localhost:3000
```

## The console

| Screen | What it is for |
|---|---|
| **Clients** | Every business tracked, with the two numbers that decide who needs attention. One button per client starts a run. |
| **Add a client** | Paste a website and a Google Business Profile link. Detection proposes every field; nothing is written until it is confirmed. |
| **Runs** | What the machine is doing right now, and the log of each step as it produces it. |
| **Overview → Client report** | The measurement, unchanged: AI answers, competitors, findings, recommendations, site audit, review bar, report. |
| **Apply fixes** | Approved changes written to the client's own site through WordPress or Shopify, each one recording what was there before it. |
| **History** | What every run measured, frozen at the moment it finished, with the movement between runs. |

## Adding a client

Two links: the homepage, and the Google listing. From those it works out the
platform, the business type, the services or product categories, the places
served, the phone numbers, the structured data, and the name variants an AI
answer has to be matched against.

The service area is the one thing it will not decide on its own. It sets which
place names count as wrong-geography, so a mistake there changes every finding
that follows — the form asks rather than assumes.

The Google listing's review count is often withheld from an automated read. When
that happens the field is left empty and says so, rather than being filled with a
guess that would flow straight into the competitive comparison.

## Runs

A run is the pipeline, in order, stopping at the first failure:

1. **Read the website** — every page, split into paragraphs and scored.
2. **Write the question set** — what a real customer would ask, per service and place.
3. **Ask the AI engines** — needs a browser already signed into each of them. 20–90 minutes.
4. **Profile the competitors** — crawls every business the engines cited, measured on the same scale.
5. **Work out what is wrong** — ranked findings.
6. **Build the fix list** — the exact titles, copy, structured data and pages to publish.
7. **Generate the client report** — the single HTML document the client receives.

*Skip the engines* re-runs everything except step 3 against answers already
collected. Minutes rather than hours, and no signed-in browser needed.

## Publishing fixes

Connect a site on **Apply fixes** with an application password (WordPress) or an
Admin API token from a custom app (Shopify). Never the client's own login — both
can be revoked from the client's side without touching anything else they own.

Three rules hold for every edit:

- **Read before writing.** The previous value is stored, so any change can be put back.
- **Verify after writing.** A 200 response is not proof — SEO plugins routinely accept a field and drop it. The value is read back and compared, and a change that did not stick is reported as a failure.
- **Refuse rather than guess.** If the original wording is not in the page source exactly once, the edit is declined with a reason instead of a fuzzy match against a live website.

Recommendations still carrying a `[[FILL: …]]` marker cannot be published at all.
Those are prices, warranties, response times and credentials — facts only the
business can confirm, and never invented.

## Command line

Every step is also a script. `npm run` : `migrate`, `add-client`, `ingest`,
`prompts`, `login`, `measure`, `competitors`, `analyze`, `recommend`, `report`,
`gsc-auth`, `gsc`. Each takes `--client=<id|domain>`.

`npm run login` is the one thing the console cannot do for you: it opens a
browser so you can sign into ChatGPT, Perplexity and Gemini once. The profile is
reused by every measurement run afterwards.

## Search Console (optional, free)

Real search queries instead of paid volume estimates. Create an OAuth client of
type *Desktop app*, enable the Google Search Console API, put `GSC_CLIENT_ID` and
`GSC_CLIENT_SECRET` in `.env.local`, then `npm run gsc-auth`.

## Nothing is hardcoded to a client

No business name, city, phone number or industry term may live in code. It all
comes from the `clients` and `locations` tables, filled by detection. If a
constant would not be true for a completely different client, it belongs in the
database.
