'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { inspectSite, saveClient, type OnboardState } from '../../_actions/clients'
import { QuestionnaireFields } from '../../_components/questionnaire-fields'
import { TownsField } from '../../_components/towns-field'
import { questionsFor } from '@/onboard/questionnaire'
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, type BusinessType } from '@/config'
import { factsFromProfile } from '@/onboard/gbp-facts'
import { StatePicker } from '../../_components/state-picker'

/**
 * Adding a client: paste a website, paste a Google listing, confirm what was
 * found.
 *
 * Nothing is written until the second screen is submitted. Detection is shown in
 * full — including what it could not work out — because the operator is the
 * check on it, and a field that quietly filled itself with a guess is one nobody
 * looks at twice.
 */

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />
      )}
      {pending ? busy : idle}
    </button>
  )
}

function InspectingNote() {
  const { pending } = useFormStatus()
  if (!pending) return null
  return (
    <p className="text-sm text-ink-3">
      Reading the sitemap, the pages and the Google listing. On a large site this takes up to a
      minute.
    </p>
  )
}

export default function NewClientPage() {
  const [state, action] = useActionState<OnboardState, FormData>(inspectSite, { phase: 'idle' })

  /**
   * Held in state rather than left to the DOM.
   *
   * React resets an uncontrolled field once a form action finishes, so a
   * rejected Google link used to take the website address down with it — and
   * retyping a URL you already typed, because the *other* box was wrong, is a
   * miserable way to be told about a mistake.
   */
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [googleProfileUrl, setGoogleProfileUrl] = useState('')

  if (state.phase === 'review') return <Review state={state} />

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <Link href="/clients" className="text-sm text-ink-3 hover:text-ink">
          ← Clients
        </Link>
        <h1 className="display mt-2 text-3xl">Add a client</h1>
        <p className="mt-2 text-sm text-ink-2">
          Give it the two links a customer would use to find the business. Everything else — the
          platform, the services, the places, the name variants the engines have to match — is read
          off those.
        </p>
      </div>

      <form action={action} className="card space-y-5 p-6">
        <div>
          <label htmlFor="websiteUrl" className="field-label">
            Website address
          </label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            className="field"
            placeholder="example.com"
            autoComplete="off"
            autoFocus
            required
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-ink-3">
            The homepage. WordPress and Shopify are read through their own APIs; anything else is
            crawled.
          </p>
        </div>

        <div>
          <label htmlFor="googleProfileUrl" className="field-label">
            Google Business Profile <span className="normal-case">(recommended)</span>
          </label>
          <input
            id="googleProfileUrl"
            name="googleProfileUrl"
            className="field"
            placeholder="https://maps.app.goo.gl/… or https://share.google/…"
            autoComplete="off"
            value={googleProfileUrl}
            onChange={(e) => setGoogleProfileUrl(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-ink-3">
            A Google Maps link or a share.google link both work. The star rating is what decides
            whether an engine will recommend the business at all — without it the audit cannot say
            why a business is being skipped.
          </p>
        </div>

        <fieldset>
          <legend className="field-label">What kind of business is this?</legend>
          <p className="mb-2 text-xs text-ink-3">
            It decides what gets asked — of the client, and of the engines. A shop is found by
            &ldquo;where can I buy X near me&rdquo; and judged on a map pack; a store is found by
            &ldquo;where do I buy X&rdquo; and judged on product markup and postage. Asking one the
            other&rsquo;s questions measures the wrong contest.
          </p>
          <div className="space-y-1">
            {BUSINESS_TYPES.map((type) => (
              <label
                key={type}
                className="flex cursor-pointer gap-2 rounded-lg p-2 text-sm hover:bg-sink"
              >
                <input type="radio" name="businessKind" value={type} className="mt-1" />
                <span>
                  <span className="font-semibold">{BUSINESS_TYPE_LABELS[type].label}</span>
                  <span className="block text-xs text-ink-3">{BUSINESS_TYPE_LABELS[type].help}</span>
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-sm hover:bg-sink">
              <input type="radio" name="businessKind" value="" defaultChecked className="mt-1" />
              <span>
                <span className="font-semibold">Not sure — work it out from the site</span>
                <span className="block text-xs text-ink-3">
                  Detection guesses, shows its reasoning, and you confirm it on the next screen.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {state.phase === 'error' && (
          <div className="rounded-xl border border-rose/25 bg-rose-soft p-4 text-sm text-rose">
            {state.message}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-line pt-5">
          <SubmitButton idle="Inspect this business" busy="Inspecting…" />
          <InspectingNote />
        </div>
      </form>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  )
}

function Review({ state }: { state: Extract<OnboardState, { phase: 'review' }> }) {
  const { detection: d, gbp, draft } = state
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <Link href="/clients/new" className="text-sm text-ink-3 hover:text-ink">
          ← Start over
        </Link>
        <h1 className="display mt-2 text-3xl">{draft.name}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {d.domain} · {d.platform} · {d.pageCount} pages found
        </p>
      </div>

      <section className="card mb-6 p-6">
        <h2 className="display text-lg">What was read off the site</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Fact label="Platform" value={d.platform + (d.apiBase ? ' (API available)' : '')} />
          <Fact label="Business type" value={d.businessTypeConfidence} />
          <Fact label="Phone numbers" value={d.phones.length ? d.phones.join(' · ') : 'none found'} />
          <Fact
            label="Structured data"
            value={d.schemaTypes.length ? d.schemaTypes.join(', ') : 'none — this is a finding'}
          />
          <div className="sm:col-span-2">
            <dt className="eyebrow">
              {d.businessType === 'local_service' ? 'Services' : 'Product categories'} (
              {d.offerings.length})
            </dt>
            <dd className="mt-0.5 text-sm text-ink-2">
              {d.offerings.length ? d.offerings.slice(0, 24).join(', ') : 'none found'}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="eyebrow">
              Name variants used to match AI answers ({draft.aliases.length})
            </dt>
            <dd className="mt-0.5 text-sm text-ink-2">{draft.aliases.join(' · ')}</dd>
            <dd className="mt-1 text-xs text-ink-3">
              Rebuilt from the name confirmed below, plus anything the site called itself. A
              mention the engines write in a form that is not on this list is scored as no mention
              at all, so check the business&rsquo;s real name is here.
            </dd>
          </div>
        </dl>

        {d.warnings.length > 0 && (
          <div className="mt-5 rounded-xl border border-amber/25 bg-amber-soft p-4">
            <p className="text-sm font-semibold text-amber">Worth knowing before you run this</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {d.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {gbp && (
        <section className="card mb-6 p-6">
          <h2 className="display text-lg">Google Business Profile</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact label="Listed as" value={gbp.name ?? 'not read'} />
            <Fact label="Category" value={gbp.category ?? (gbp.readListing ? '—' : 'not read')} />
            <Fact
              label="Address"
              value={gbp.address ?? gbp.serviceArea ?? (gbp.readListing ? '—' : 'not read')}
            />
            <Fact
              label="Opening hours"
              value={
                gbp.hours ??
                (gbp.readListing
                  ? 'not served to an automated read — the warnings below say what was seen'
                  : 'not read')
              }
            />
            <Fact
              label="Price bracket"
              value={gbp.priceLevel ?? (gbp.readListing ? 'none shown' : 'not read')}
            />
            <Fact
              label="Website on the listing"
              value={
                gbp.website ? (
                  <a
                    href={gbp.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-pine underline"
                  >
                    {gbp.website}
                  </a>
                ) : gbp.readListing ? (
                  'none — the engines have nowhere to send a customer'
                ) : (
                  'not read — this link did not open the listing'
                )
              }
            />
          </dl>
          {gbp.warnings.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber">
              {gbp.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <SaveForm state={state} />
    </div>
  )
}

function SaveForm({ state }: { state: Extract<OnboardState, { phase: 'review' }> }) {
  const { detection: d, draft, gbp } = state

  /**
   * Whatever the Google listing already answers, answered.
   *
   * Anything typed on a rejected attempt wins over it — an operator who
   * corrected Google's opening hours and then hit a validation error must not
   * be handed Google's version back.
   */
  const prefilled = factsFromProfile(gbp)
  const [saveState, action] = useActionState<OnboardState, FormData>(saveClient, { phase: 'idle' })

  /**
   * After a rejection the fields are rebuilt around what was typed, not around
   * the original suggestions. React clears an uncontrolled field once a form
   * action finishes, so without this a single missing state would silently undo
   * every correction and every questionnaire answer on the screen.
   *
   * Keyed on the attempt so React remounts the fields rather than reusing nodes
   * whose values it has already reset.
   */
  const submitted = saveState.phase === 'error' ? (saveState.values ?? {}) : {}
  const keep = (name: string, fallback: string) => submitted[name] ?? fallback
  const attemptKey = saveState.phase === 'error' ? saveState.attempt ?? 0 : 0

  /**
   * Held in state, because changing it changes the questions below it.
   *
   * An operator who corrects the kind here is telling the tool the business is
   * something else; leaving a plumber's response-time question on screen for a
   * shop would be showing them a form for a business they just said this is
   * not.
   */
  const [businessType, setBusinessType] = useState<BusinessType>(
    (keep('businessType', draft.businessType) as BusinessType) ?? draft.businessType,
  )
  return (
    <form action={action} className="card space-y-6 p-6">
      <input type="hidden" name="detection" value={JSON.stringify(d)} />

      <div>
        <h2 className="display text-lg">Confirm before saving</h2>
        <p className="mt-1 text-sm text-ink-2">
          The service area is the one thing detection cannot decide. It sets which place names count
          as wrong-geography, so a mistake here changes every finding that follows.
        </p>
      </div>

      <div key={attemptKey} className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className="field-label">
            Business name
          </label>
          <input id="name" name="name" className="field" defaultValue={keep('name', draft.name)} required />
        </div>

        <div>
          <label htmlFor="businessType" className="field-label">
            Business type
          </label>
          <select
            id="businessType"
            name="businessType"
            className="field"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value as BusinessType)}
          >
            {BUSINESS_TYPES.map((type) => (
              <option key={type} value={type}>
                {BUSINESS_TYPE_LABELS[type].label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-ink-3">
            {businessType === d.businessType
              ? BUSINESS_TYPE_LABELS[businessType].help
              : `You said ${BUSINESS_TYPE_LABELS[businessType].label.toLowerCase()}; the site reads as ${BUSINESS_TYPE_LABELS[d.businessType].label.toLowerCase()}. Yours is being used — the questions below are the ones for it.`}
          </p>
        </div>

        <div>
          <label htmlFor="primaryPhone" className="field-label">
            Main phone number
          </label>
          <input
            id="primaryPhone"
            name="primaryPhone"
            className="field"
            defaultValue={keep('primaryPhone', draft.primaryPhone ?? '')}
            placeholder="none found"
          />
        </div>

        <div className="sm:col-span-2">
          <span className="field-label">States actually served</span>
          <StatePicker
            name="states"
            defaultValue={keep('states', draft.states.join(', '))}
            suggestions={d.states}
          />
          <p className="mt-1.5 text-xs text-ink-3">
            Pick every state the business genuinely works in. It decides which place names on the
            site count as wrong-geography, so a state added here that they do not serve hides a
            real finding.
            {d.states.length === 0 && ' No states were mentioned on the site.'}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="towns" className="field-label">
            Towns served
          </label>
          <TownsField
            id="towns"
            name="towns"
            defaultValue={keep('towns', draft.towns.join(', '))}
          />
          <p className="mt-1.5 text-xs text-ink-3">
            Comma-separated, as town names or as ZIP codes — a ZIP is looked up and replaced by its
            town, because that is what the engines are asked about. Add the state after a town when
            they differ. Each one becomes its own contest: the questions are asked per town, and
            the results are never averaged across them.
          </p>
        </div>
      </div>

      <fieldset key={`gbp-${attemptKey}`} className="grid gap-5 border-t border-line pt-6 sm:grid-cols-3">
        <legend className="eyebrow">Google listing</legend>
        <div className="sm:col-span-3">
          <label htmlFor="gbpUrl" className="field-label">
            Profile link
          </label>
          <input id="gbpUrl" name="gbpUrl" className="field" defaultValue={keep('gbpUrl', draft.gbpUrl ?? '')} />
        </div>
        <div>
          <label htmlFor="gbpRating" className="field-label">
            Star rating
          </label>
          <input
            id="gbpRating"
            name="gbpRating"
            className="field"
            inputMode="decimal"
            defaultValue={keep('gbpRating', String(draft.gbpRating ?? ''))}
            placeholder="4.6"
          />
        </div>
        <div>
          <label htmlFor="gbpReviewCount" className="field-label">
            Review count
          </label>
          <input
            id="gbpReviewCount"
            name="gbpReviewCount"
            className="field"
            inputMode="numeric"
            defaultValue={keep('gbpReviewCount', String(draft.gbpReviewCount ?? ''))}
            placeholder="type it in"
          />
        </div>
        <div>
          <label htmlFor="gbpHasWebsite" className="field-label">
            Website attached
          </label>
          <select
            id="gbpHasWebsite"
            name="gbpHasWebsite"
            className="field"
            defaultValue={keep('gbpHasWebsite', draft.gbpHasWebsite === null ? '' : draft.gbpHasWebsite ? 'yes' : 'no')}
          >
            <option value="">Not known</option>
            <option value="yes">Yes, this site</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="gbpServiceArea" className="field-label">
            Service area shown on the listing
          </label>
          <input
            id="gbpServiceArea"
            name="gbpServiceArea"
            className="field"
            defaultValue={keep('gbpServiceArea', draft.gbpServiceArea ?? '')}
            placeholder="leave blank for a business with a shopfront"
          />
        </div>
      </fieldset>

      <div className="border-t border-line pt-6">
        <h3 className="display text-lg">A few things only the business can tell you</h3>
        <p className="mt-1 mb-6 text-sm text-ink-2">
          All optional, and all answerable later. They matter because the tool never invents a
          price, a warranty, a response time or a credential — it writes a visible placeholder
          instead, and a placeholder blocks the change from being published. Most of a fix list
          ends up waiting on the handful of facts below.
          {Object.keys(prefilled.answers).length > 0 && (
            <>
              {' '}
              {Object.keys(prefilled.answers).length} of them were read off the Google listing and
              are marked as such — they are still worth a look, because a listing goes out of date
              like anything else.
            </>
          )}
        </p>
        <QuestionnaireFields
          key={`intake-${attemptKey}`}
          groups={questionsFor(businessType)}
          answers={{
            ...prefilled.answers,
            ...Object.fromEntries(
              Object.entries(submitted)
                .filter(([k]) => k.startsWith('fact_'))
                .map(([k, v]) => [k.slice('fact_'.length), v]),
            ),
          }}
          sources={prefilled.sources}
        />
      </div>

      {saveState.phase === 'error' && (
        <div className="rounded-xl border border-rose/25 bg-rose-soft p-4 text-sm text-rose">
          {saveState.message}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-line pt-5">
        <SubmitButton idle="Save client" busy="Saving…" />
        <Link href="/clients" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  )
}
