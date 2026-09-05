import Database from 'better-sqlite3'

/**
 * Opens the SQLite file and makes sure it is left complete.
 *
 * WAL mode keeps recent writes in a side file (`data.db-wal`) until SQLite
 * folds them back in. That fold happens on a clean close — and the scripts here
 * never closed: they finish, or get Ctrl-C'd part way through a measurement
 * run, and the process exits with the write-ahead log still holding the newest
 * rows. The database stays correct, because SQLite replays the log on the next
 * open, but `data.db` on its own is not the database. Copying it as a backup
 * quietly leaves behind everything since the last automatic checkpoint — 4 MB
 * of measurements, in the state this was found in.
 *
 * So every connection checkpoints and closes on the way out, and a Ctrl-C is
 * handled rather than left to kill the process before that can happen.
 */
export function openSqlite(
  file: string,
  { handleSignals = false }: { handleSignals?: boolean } = {},
): Database.Database {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')

  /**
   * Wait for a busy database rather than failing on it.
   *
   * Several clients can be run at once, and each pipeline step is its own
   * process with its own connection. WAL lets them all read while one writes,
   * but the writer lock is still exclusive, and SQLite's default behaviour on
   * meeting it is to give up instantly — which would turn "two clients running
   * together" into random SQLITE_BUSY failures in whichever step happened to
   * write second. Thirty seconds is far longer than any write here takes.
   */
  sqlite.pragma('busy_timeout = 30000')

  let closed = false
  const shutdown = () => {
    if (closed) return
    closed = true
    try {
      // TRUNCATE rather than PASSIVE: it waits for the fold to finish and then
      // empties the log, which is the whole point — a PASSIVE checkpoint can
      // give up quietly and leave the log exactly as it was.
      sqlite.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      // A checkpoint can fail if another process holds a read lock. The data is
      // safe either way, so this must never turn into a crash on exit.
    }
    try {
      sqlite.close()
    } catch {
      // Already closed, or closed by another handler.
    }
  }

  process.on('exit', shutdown)

  /**
   * Signals are opt-in because Node runs no exit handler for an unhandled
   * SIGINT, and a measurement run is the thing most likely to be interrupted.
   * The Next server does its own shutdown, so it does not take these over.
   */
  if (handleSignals) {
    for (const [signal, code] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      process.on(signal, () => {
        shutdown()
        process.exit(code)
      })
    }
  }

  return sqlite
}
