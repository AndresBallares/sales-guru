#!/usr/bin/env bash
# Guarded wrapper around `prisma db push --force-reset` — irreversibly
# wipes whatever database DATABASE_URL points at (confirmed the hard way
# 2026-09-12: a bare `prisma db push --force-reset` run against the
# ambient shell's real DATABASE_URL wiped the local dev database instead
# of the intended test one). This script is now the only supported way to
# force-reset a database in this repo — see CLAUDE.md's destructive-
# command rule.
#
# Always resets the TEST database defined in backend/.env.test, never
# whatever the calling shell's own environment or backend/.env currently
# points at, and refuses to run at all if that value doesn't look like a
# test database. Extra arguments (e.g. --skip-generate) are passed
# through to `prisma db push` unchanged.
set -euo pipefail

cd "$(dirname "$0")/.."  # backend/

resolved_url="$(grep -E '^DATABASE_URL=' .env.test | tail -1 | cut -d= -f2- | tr -d '"')"
echo "Resolved DATABASE_URL (from .env.test): ${resolved_url:-<unset>}"

case "$resolved_url" in
  *test.db*) ;;
  *)
    echo "Refusing to run: DATABASE_URL does not contain 'test.db' (got: '$resolved_url')." >&2
    echo "This script only ever resets the test database — fix .env.test if this is wrong." >&2
    echo "Never run 'prisma db push --force-reset' or 'migrate reset' directly." >&2
    exit 1
    ;;
esac

echo "Resetting $resolved_url ..."
DATABASE_URL="$resolved_url" uv run prisma db push --force-reset "$@"
