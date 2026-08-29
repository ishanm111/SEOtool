import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import type { ChatEngineConfig, EngineResult } from './types'
import { MIN_ANSWER_CHARS } from '../config'

/**
 * Which browser binary to drive.
 *
 *  - `chrome` (default) uses your real Chrome. Best fingerprint, but macOS
 *    refuses to start a second Chrome session, so your normal Chrome must be
 *    QUIT before running.
 *  - `chromium` uses Playwright's own bundled build. Completely independent of
 *    your Chrome, so you can keep browsing while it works — but it needs its own
 *    one-time login, because macOS Keychain will not share saved cookies between
 *    two different browser binaries.
 */
const CHANNEL = process.env.RANKLOOP_BROWSER === 'chromium' ? undefined : 'chrome'

const PROFILE_DIR = path.resolve(CHANNEL ? '.chrome-profile' : '.chromium-profile')
export const SHOTS_DIR = path.resolve('screenshots')

export function ensureDirs() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
}

export function browserLabel() {
  return CHANNEL ? 'your real Chrome (quit Chrome first)' : 'bundled Chromium (independent)'
}

/**
 * A persistent browser profile. Logins survive between runs, which is the whole
 * point — we are driving the consumer chat apps, not their APIs.
 *
 * Headed on purpose: headless browsers are far easier to fingerprint.
 */
export async function openBrowser(headless = false): Promise<BrowserContext> {
  ensureDirs()
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: CHANNEL,
      headless,
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      args: ['--disable-blink-features=AutomationControlled'],
    })
  } catch (err) {
    if (String(err).includes('existing browser session')) {
      throw new Error(
        'Your normal Chrome is running, and macOS will not start a second Chrome session.\n' +
          '  Either: quit Chrome completely (Cmd+Q) and run this again,\n' +
          '  Or:     run with RANKLOOP_BROWSER=chromium to use an independent browser\n' +
          '          (needs one login of its own: RANKLOOP_BROWSER=chromium npx tsx src/scripts/login.ts)',
      )
    }
    throw err
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Human-ish gap between questions. Pacing is what avoids bot detection. */
export function pacingDelay(minSec = 45, maxSec = 90): number {
  return Math.round((minSec + Math.random() * (maxSec - minSec)) * 1000)
}

async function findFirst(page: Page, selectors: string[], timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first()
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return loc
    }
    await sleep(500)
  }
  return null
}

/**
 * Reads the answer by polling until the text stops growing. This is deliberately
 * selector-light: these apps rewrite their DOM constantly, but "the text stopped
 * changing" is stable across redesigns.
 */
async function waitForStableAnswer(
  page: Page,
  selectors: string[],
  { maxWaitMs = 120000, stableForMs = 4000, minChars = MIN_ANSWER_CHARS } = {},
): Promise<string> {
  const deadline = Date.now() + maxWaitMs
  let last = ''
  let lastChange = Date.now()

  while (Date.now() < deadline) {
    let current = ''
    for (const sel of selectors) {
      const blocks = page.locator(sel)
      const n = await blocks.count().catch(() => 0)
      if (n > 0) {
        current = (await blocks.nth(n - 1).innerText().catch(() => '')) ?? ''
        if (current.trim()) break
      }
    }

    if (current !== last) {
      last = current
      lastChange = Date.now()
    } else if (last.trim().length >= minChars && Date.now() - lastChange >= stableForMs) {
      // minChars guards against locking onto a placeholder or an accessibility
      // label ("Gemini said") that is stable but is not the answer.
      return last.trim()
    }

    await sleep(1000)
  }
  return last.trim()
}

/**
 * Links that are page furniture, not sources the engine actually cited.
 *
 * The engines' own nav and settings links are obvious. The map tiles are not:
 * Perplexity embeds a live map next to local results, and its Mapbox and
 * OpenStreetMap attribution links were being counted as citations — they were
 * the two most "cited" domains in the first run, which is nonsense.
 */
const IGNORED_CITATION_HOSTS =
  /openai\.com|chatgpt\.com|gemini\.google|perplexity\.ai|google\.com\/(?:search|url|maps)|myactivity\.google\.com|accounts\.google|policies\.google|support\.google|mapbox\.com|openstreetmap\.org|maps\.google|gstatic\.com|googleusercontent\.com/

async function extractCitations(page: Page, selectors: string[]) {
  const urls = new Set<string>()
  for (const sel of selectors) {
    const links = page.locator(`${sel} a[href^="http"]`)
    const n = await links.count().catch(() => 0)
    for (let i = 0; i < n; i++) {
      const href = await links.nth(i).getAttribute('href').catch(() => null)
      if (!href) continue
      if (IGNORED_CITATION_HOSTS.test(href)) continue
      urls.add(href)
    }
    if (urls.size > 0) break
  }
  return [...urls].map((url, i) => ({ url, position: i + 1 }))
}

/**
 * Asks one question on one chat engine and returns the answer, citations and a
 * screenshot. Never throws — a failure comes back as `ok: false` so a bad run is
 * visible in the dashboard rather than silently missing.
 */
export async function askChatEngine(
  context: BrowserContext,
  cfg: ChatEngineConfig,
  question: string,
  shotName: string,
): Promise<EngineResult> {
  const page = await context.newPage()
  try {
    // Heavy SPAs (Gemini especially) can blow past domcontentloaded while being
    // perfectly usable. Fall back to 'commit' — the input poll below is the real gate.
    try {
      await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    } catch {
      await page.goto(cfg.url, { waitUntil: 'commit', timeout: 45000 }).catch(() => {})
    }
    await sleep(2500 + Math.random() * 2000)

    // Clear anything sitting on top of the input: feature tours, cookie banners.
    for (const sel of cfg.dismissSelectors ?? []) {
      const el = page.locator(sel).first()
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 3000 }).catch(() => {})
        await sleep(500)
      }
    }
    await page.keyboard.press('Escape').catch(() => {})

    const input = await findFirst(page, cfg.inputSelectors)
    if (!input) {
      throw new Error(
        `no input box found. Selectors tried: ${cfg.inputSelectors.join(' | ')}. ` +
          `Are you logged in? Run: npx tsx src/scripts/login.ts`,
      )
    }

    try {
      await input.click({ timeout: 8000 })
    } catch {
      // An overlay is intercepting pointer events. Escape it and click through.
      await page.keyboard.press('Escape').catch(() => {})
      await sleep(500)
      await input.click({ timeout: 8000, force: true })
    }
    // Type at a human cadence rather than pasting the string in one go.
    await input.pressSequentially(question, { delay: 18 + Math.random() * 25 })
    await sleep(400 + Math.random() * 600)

    if (cfg.submitSelectors?.length) {
      const btn = await findFirst(page, cfg.submitSelectors, 5000)
      if (btn) await btn.click()
      else await page.keyboard.press('Enter')
    } else {
      await page.keyboard.press('Enter')
    }

    const answerText = await waitForStableAnswer(page, cfg.answerSelectors)
    const citations = await extractCitations(page, cfg.citationSelectors ?? cfg.answerSelectors)

    const screenshotPath = path.join(SHOTS_DIR, `${shotName}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {})

    if (answerText.length < MIN_ANSWER_CHARS) {
      throw new Error(
        `answer too short to be real (${answerText.length} chars: ${JSON.stringify(answerText.slice(0, 40))}) — ` +
          'timed out, blocked, or the selector matched a placeholder',
      )
    }

    return {
      engine: cfg.name,
      answerText,
      citations,
      screenshotPath: path.relative(process.cwd(), screenshotPath),
      ok: true,
    }
  } catch (err) {
    const screenshotPath = path.join(SHOTS_DIR, `${shotName}_error.png`)
    await page.screenshot({ path: screenshotPath }).catch(() => {})
    return {
      engine: cfg.name,
      answerText: '',
      citations: [],
      screenshotPath: fs.existsSync(screenshotPath)
        ? path.relative(process.cwd(), screenshotPath)
        : undefined,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await page.close().catch(() => {})
  }
}
