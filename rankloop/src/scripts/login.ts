import readline from 'node:readline/promises'
import { openBrowser } from '../engines/browser'
import { CHAT_ENGINES } from '../engines/chat-engines'

/**
 * One-time setup. Opens a real Chrome window with a tab per engine so you can
 * log in by hand. The profile is saved to ./.chrome-profile and reused by every
 * later run, so this only has to happen once (until a session expires).
 *
 * Use throwaway accounts, not personal ones.
 */
async function main() {
  const context = await openBrowser(false)

  for (const engine of CHAT_ENGINES) {
    const page = await context.newPage()
    await page.goto(engine.url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    console.log(`opened ${engine.name} -> ${engine.url}`)
  }

  console.log('\n──────────────────────────────────────────────')
  console.log('Log into each tab now. Use throwaway accounts.')
  console.log('Dismiss any popups or cookie banners while you are there.')
  console.log('──────────────────────────────────────────────\n')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await rl.question('Press Enter here once you are logged into all three... ')
  rl.close()

  await context.close()
  console.log('\nprofile saved to .chrome-profile — logins will persist')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
