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

## Fixing the two links afterwards

Everything the tool knows about a business is derived from two things: the
website address and the Google listing. Both are entered once when a client is
added, and both are easy to get wrong — a typo, or a listing nobody could find
that week.

**Edit links** on a client's Overview changes them, and **Inspect the business
again** re-reads the site with the corrected address. The new-client flow cannot
do this: it refuses any domain already on file, which is right when adding one
and exactly wrong when fixing the thing that was added.

Re-inspecting overwrites what was *read* — platform, API base, phone numbers,
offerings, and every Google listing figure. It leaves the name, the aliases, the
service-area towns and the business type alone. Those four are what an operator
corrects by hand when detection gets them wrong, and silently reverting someone's
corrections is a worse failure than leaving a stale reading for them to notice.

Measurements are untouched either way. Re-run `ingest` to pick up pages from a
corrected address.

## Runs

A run is the pipeline, in order, stopping at the first failure:

1. **Read the website** — every page, split into paragraphs and scored.
2. **Write the question set** — what a real customer would ask, per service and place.
3. **Ask the AI engines** — needs a browser already signed into each of them. 20–90 minutes.
4. **Research Google** — searches Google from inside the client's towns. 10–20 minutes. See below.
5. **Profile the competitors** — crawls every business the engines cited, measured on the same scale.
6. **Work out what is wrong** — ranked findings.
7. **Build the fix list** — the exact titles, copy, structured data and pages to publish.
8. **Generate the client report** — the single HTML document the client receives.

*Skip the engines* re-runs everything except steps 3 and 4 against answers already
collected. Minutes rather than hours, and no signed-in browser needed.

## Google research (replaces DataForSEO)

`npm run research -- --client=<id>` drives a real browser through Google and
Maps and reads what the paid API was going to be bought for. No login needed.

| DataForSEO endpoint | Read from |
|---|---|
| AI Overview + references | the overview and the links inside it |
| Local pack with ratings | the map pack block (ads skipped) |
| Organic top 10 | each result's printed address |
| People also ask | the block, verbatim |
| City-level targeting | Google's `uule` parameter, from `locations.dataforseo_location` |
| Keyword ideas | search-box completions + related searches |
| CPC / competition | how many "Sponsored" results a search carries |
| Business Data (reviews) | the Maps listing, reviews sorted newest first |

**Not replaced:** absolute monthly search volume. Completions are shown as
evidence of demand, never as a number.

What it searches: the business name, `<name> reviews`, `<trade|service> <town>`
per market, and the customer questions from the question set. Add your own with
`--ask="question one|question two"`. `--limit=N` (default 16), `--profiles=N`
Maps listings (default 5, `0` to skip), `--headless`.

Where it goes:

- **Findings** (`analyze`): whether the AI Overview names or links the client and
  which sites it trusts instead; map-pack and top-10 presence; the brand search;
  People-also-ask questions the site never answers; searched phrases the site
  never uses; which searches carry ads; an unclaimed listing; review pace vs rivals.
- **Blog posts** (`recommend`): PAA questions, completions and related searches join
  the keyword pool, ranked above the question set and below Search Console.
- **Review bar**: map packs and listing review counts fill it automatically.
- **Dashboard**: *Google research*.

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

## The client portal

Clients get a sign-in of their own at `/portal`, separate from the operator
console. They see one business — theirs — and four screens: where they stand,
what was found, every proposed change, and the full report. There is no client
switcher and no way to start a run.

The point of it is the approval queue. A client approves or declines each
proposed change in their own words and their own time, and the decision is
recorded against the recommendation with their email on it. Nothing is published
by approving; publishing stays on the operator's **Apply fixes** screen, where
the site credentials live.

Set a signing key once, then issue a login per client:

```bash
# .env.local
PORTAL_SECRET=<64 hex characters>

npm run portal-invite -- --client=5 --email=owner@example.com   # creates, prints a temporary password
npm run portal-invite -- --client=5 --email=owner@example.com --reset    # new password
npm run portal-invite -- --client=5 --list                      # who has access
npm run portal-invite -- --email=owner@example.com --disable    # revoke
```

The temporary password is printed once and never stored in the clear; the client
is made to change it at first sign-in. There is no sign-up form anywhere — a
portal login exists only because an operator made one.

Two properties the code holds to, both worth keeping if this is extended:

- **The client comes from the session, never from the request.** Every portal
  query takes the client off the signed-in session, and every write names it in
  the `WHERE` clause, so a tampered form naming another client's row matches
  nothing.
- **The portal has its own report route.** The console serves reports from
  `/api/report?domain=…`, which is right for an operator and would be a hole
  here. `/portal/report/file` takes no parameters and can only ever serve the
  signed-in client's own audit.

## Sending the questionnaire to the client

The questionnaire is the slowest part of onboarding: the answers are the only
thing between a list of blocked recommendations and a publishable one, and they
live in a conversation that has to be had.

### A Google Form

**Make into Google Form** turns the questionnaire into a Google Form and hands
back a link to send the business, if the OAuth setup below has been done.

Without it, build the form by hand instead — it is one form per business type,
not one per client, so twenty minutes of typing covers every client there will
ever be:

```bash
npm run questionnaire-text -- --type=local_service
npm run questionnaire-text -- --type=local_retail
npm run questionnaire-text -- --type=ecommerce
```

That prints the questions, their Google Forms answer types and their help text,
from the same definition the console reads, so a form built from it asks exactly
what the tool expects back. Answers then have to be copied into the console,
which is the real cost of the Google route either way.

```bash
npm run forms-auth                      # one-time Google authorisation
npm run forms-preview -- --client=7     # read the form without creating one
```

`forms-auth` needs an OAuth client (type: Desktop app) with the **Google Forms
API** and **Google Drive API** enabled, as `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` in `.env.local`. The Search Console client works if you
already made one — same project, same client. The Drive scope is `drive.file`,
which can only touch files this tool itself created.

### Getting the answers back

A Google Form's answers land in a Google Sheet, and that is where this route
used to end: somebody retyped fourteen answers into the console. **Paste the
answers back in**, at the bottom of the questionnaire screen, is the other half
of it.

Copy whatever came out of the sheet and paste it. Three shapes are accepted,
because there are three obvious ways to copy a response and nobody should have
to know which one the tool wanted:

- the sheet's header row and its response rows, tabbed — more than one row is
  normal, and the newest wins;
- one `question<TAB>answer` per line, from a transposed sheet;
- the question on one line and its answer underneath, as the form's own
  "individual response" view prints it.

Headings are matched against every wording a question has ever carried — the
console's, the client-facing one, and the per-business-type variants — so a
form built from `questionnaire-text` and a form built by hand from the console
both import. A heading that only nearly matches is flagged as such rather than
accepted quietly.

**Reading never writes.** The first press shows what was found, labelled `New`,
`Replaces`, `Unchanged` or `No match`, with every value editable. The second
press writes what is on screen, not what was parsed — so a mis-match costs a
correction rather than an overwritten answer.

### What both of them change

The client-facing wording lives in `src/onboard/client-questionnaire.ts`, shared
by both, because the moment each has its own copy of a label they start to
disagree about what was asked.

- **Operator wording is rewritten.** "What do they most want to be found for?"
  is the right question and the wrong pronoun when the person reading it is the
  "they", and "a warranty the business does not offer is a legal problem on
  their website" talks about the reader rather than to them.
- **`resolves` is dropped.** "Unblocks 8 recommendations" is what makes an
  operator bother to ask; to the business it is noise about someone else's tool.
- **Every question goes in, answered or not.** Answered ones used to be left
  out of a Google Form, because the API cannot seed an answer and a blank reply
  would have been indistinguishable from "it changed". The importer settled
  that: an answer that comes back changed is shown against the one on file and
  labelled as replacing it. The hosted page goes further and puts the existing
  answer in the box.

The keys and the answer types are untouched either way, so an answer typed by a
business owner and one typed by an operator are the same row in the same table
and nothing downstream can tell which it was.

One form per client. Pressing the button again returns the existing link rather
than making a second form, because two live forms for one business means two
sets of answers and no way to say which is current. **Replace it** is the
explicit way to start over.

## Auditing how a site looks, not just what it says

```bash
npm run presentation -- --client=5
```

Drives a real browser at phone width (390px) over the pages already ingested
and measures the things that only exist after CSS has applied: Core Web Vitals,
tap-target sizes, type sizes, computed colour contrast, heading order, link
wording, form fields.

**No engine ranks a button because it is a nicer colour.** What this measures is
the subset of presentation that search engines and assistants demonstrably react
to, and every finding says which of three levers it pulls:

| Lever | Means |
|---|---|
| `ranking` | A measured Google signal — Core Web Vitals, mobile usability, readability. |
| `comprehension` | Changes how an engine or assistant parses the page — headings, alt text, link wording. |
| `conversion` | Does not affect ranking. Affects whether a visitor acts — form length, a tappable phone number. |

Conversion items are often the most valuable thing on the list. They are just
not ranking factors, and a tool that blurs the two is one whose numbers stop
meaning anything.

It runs at phone width because Google indexes the mobile rendering; a desktop
measurement passes pages that are unusable on the device most local searches
happen on.

Two things it deliberately will not do. Contrast is not reported when the
backdrop is an image, a gradient, or anything the DOM walk cannot see — the
ratio varies pixel by pixel and a guess is the false positive that makes an
audit worth ignoring. And `analyze` no longer clears these findings, because
they come from a separate browser pass; each step now deletes only its own
categories.

## Command line

Every step is also a script. `npm run` : `migrate`, `add-client`, `ingest`,
`prompts`, `login`, `measure`, `research`, `competitors`, `analyze`, `recommend`, `report`,
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
