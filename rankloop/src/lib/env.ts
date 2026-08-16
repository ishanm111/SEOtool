/** Loads .env.local for plain tsx scripts. Next.js does this itself for the app. */
export function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file)
    } catch {
      // file absent — fine
    }
  }
}
