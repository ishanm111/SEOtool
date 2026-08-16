import readline from 'node:readline/promises'
import { authUrl, exchangeCode, listSites } from '../engines/search-console'
import { loadEnv } from '../lib/env'

loadEnv()

/**
 * One-time Google Search Console authorisation.
 *
 *   npx tsx src/scripts/search-console-auth.ts
 *
 * Produces a refresh token, which is the only credential the tool stores. It is
 * read-only (webmasters.readonly) and can be revoked at any time from the Google
 * account's security settings.
 */
async function main() {
  console.log('=== Google Search Console setup ===\n')
  console.log('Before this works you need an OAuth client:')
  console.log('  1. console.cloud.google.com -> APIs & Services -> Credentials')
  console.log('  2. Create Credentials -> OAuth client ID -> Application type: Desktop app')
  console.log('  3. Enable the "Google Search Console API" under Enabled APIs')
  console.log('  4. Put the client ID and secret in .env.local as:')
  console.log('       GSC_CLIENT_ID=...')
  console.log('       GSC_CLIENT_SECRET=...\n')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  if (process.env.GSC_REFRESH_TOKEN) {
    console.log('A refresh token is already set. Checking what it can read…\n')
    try {
      const sites = await listSites()
      if (sites.length === 0) {
        console.log('  Authorised, but this account has no Search Console properties.')
      } else {
        for (const s of sites) console.log(`  ${s.siteUrl}  (${s.permissionLevel})`)
      }
      rl.close()
      return
    } catch (err) {
      console.log(`  Existing token did not work: ${err instanceof Error ? err.message : err}`)
      console.log('  Re-authorising.\n')
    }
  }

  console.log('Open this URL, approve access, and copy the code Google shows you:\n')
  console.log(authUrl())
  console.log('')

  const code = await rl.question('Paste the code here: ')
  const refresh = await exchangeCode(code)
  rl.close()

  console.log('\nAdd this line to .env.local:\n')
  console.log(`GSC_REFRESH_TOKEN=${refresh}\n`)
  console.log('Then run this script again to confirm it works, and:')
  console.log('  npx tsx src/scripts/fetch-search-console.ts')
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
