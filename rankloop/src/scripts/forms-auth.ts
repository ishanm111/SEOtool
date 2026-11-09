import readline from 'node:readline/promises'
import { authUrl, exchangeCode } from '../engines/google-forms'
import { loadEnv } from '../lib/env'

loadEnv()

/**
 * One-time Google authorisation for turning a questionnaire into a form.
 *
 *   npm run forms-auth
 *
 * Produces a refresh token, which is the only credential stored. It can create
 * forms and share the ones it created, and nothing else: the Drive scope is
 * drive.file, which cannot see a single file this tool did not make.
 */
async function main() {
  console.log('=== Google Forms setup ===\n')
  console.log('Before this works you need an OAuth client:')
  console.log('  1. console.cloud.google.com -> APIs & Services -> Credentials')
  console.log('  2. Create Credentials -> OAuth client ID -> Application type: Desktop app')
  console.log('  3. Under Enabled APIs, enable BOTH:')
  console.log('       Google Forms API')
  console.log('       Google Drive API')
  console.log('  4. Put the client ID and secret in .env.local as:')
  console.log('       GOOGLE_CLIENT_ID=...')
  console.log('       GOOGLE_CLIENT_SECRET=...')
  console.log('     (or reuse GSC_CLIENT_ID / GSC_CLIENT_SECRET — same project, same client)\n')

  if (process.env.GOOGLE_FORMS_REFRESH_TOKEN) {
    console.log('A refresh token is already set. Delete GOOGLE_FORMS_REFRESH_TOKEN from')
    console.log('.env.local and run this again to replace it.\n')
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('Open this URL, approve access, and copy the code Google shows you:\n')
  console.log(authUrl())
  console.log('')

  const code = await rl.question('Paste the code here: ')
  const refresh = await exchangeCode(code)
  rl.close()

  console.log('\nAdd this line to .env.local:\n')
  console.log(`GOOGLE_FORMS_REFRESH_TOKEN=${refresh}\n`)
  console.log('Then restart the dev server and press "Make into Google Form" on any')
  console.log('client questionnaire.')
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
