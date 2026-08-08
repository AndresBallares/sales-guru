"""Shared Prisma client instance, connected via app lifespan (see app.main)."""

from prisma import Prisma

db = Prisma()
