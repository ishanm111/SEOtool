/**
 * Command-line argument parsing, shared by every script.
 *
 * Split out because each script had its own copy doing `split('=')[1]`, which
 * silently truncates any value containing an equals sign — so
 * `--add=domain.com=Business Name` quietly became `domain.com` and the rest was
 * dropped with no error. Failing invisibly is the worst kind of failure for a
 * tool whose whole job is producing accurate numbers.
 */

export function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit?.slice(prefix.length)
}

export const flag = (name: string) => process.argv.includes(`--${name}`)
