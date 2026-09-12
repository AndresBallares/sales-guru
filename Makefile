.PHONY: seed backup-dev

# Seed the local dev database (backend/prisma/dev.db — DATABASE_URL=
# file:./dev.db in backend/.env resolves relative to schema.prisma's own
# directory, not backend/ itself; there's also a stale, empty, unused
# backend/dev.db left over from early on, easy to confuse with the real
# one) with a demo business, ready to look at without manually clicking
# through onboarding first. Safe to run more than once — see
# backend/app/seed.py's own docstring.
seed:
	cd backend && uv run python -m app.seed

# Snapshot backend/prisma/dev.db before doing anything to it you're not
# 100% sure about (confirmed worth having 2026-09-12, after an accidental
# `prisma db push --force-reset` run against the wrong DATABASE_URL wiped
# it with no way back). *.db.bak* is gitignored — these are local-only
# safety nets, not something to commit.
backup-dev:
	@ts=$$(date +%Y%m%d%H%M%S); \
	cp backend/prisma/dev.db backend/prisma/dev.db.bak.$$ts; \
	echo "Backed up backend/prisma/dev.db -> backend/prisma/dev.db.bak.$$ts"
