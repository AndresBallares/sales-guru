"""Smoke test proving the generated Prisma client can read and write."""

import pytest
from prisma import Prisma


@pytest.mark.asyncio
async def test_create_and_fetch_user() -> None:
    """A User row written through Prisma is readable back by email."""
    db = Prisma()
    await db.connect()
    try:
        created = await db.user.create(
            data={"email": "founder@example.com", "hashedPassword": "not-a-real-hash"}
        )

        fetched = await db.user.find_unique(where={"id": created.id})

        assert fetched is not None
        assert fetched.email == "founder@example.com"
    finally:
        await db.user.delete(where={"id": created.id})
        await db.disconnect()
