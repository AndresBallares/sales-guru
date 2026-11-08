import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

// The database the backend under test serves (DATABASE_URL=file:./e2e.db, relative to
// backend/prisma). Specs that need rows the fake Meta flow never produces (stored
// snapshots, an expiring token, a recorded failure) write them straight into it.
const E2E_DB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'backend',
  'prisma',
  'e2e.db',
)

export const DAY_MS = 86_400_000

export function cuid(): string {
  return `c${randomBytes(11).toString('hex')}`
}

export function withE2eDb(work: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(E2E_DB)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    work(db)
  } finally {
    db.close()
  }
}
