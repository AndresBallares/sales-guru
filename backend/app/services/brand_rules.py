"""Reading a business's brand rules for the places that enforce them."""

import json

from prisma import Prisma

from app.core.db import db


async def banned_phrases_for(business_id: str, *, client: Prisma = db) -> list[str]:
    """The business's own banned phrases, empty when it has no brand rules.

    Args:
        business_id: The business whose BrandRules row to read.
        client: The database client; only tests pass their own.

    Returns:
        The phrases as the business wrote them (BrandRules.bannedPhrases).
    """
    rules = await client.brandrules.find_unique(where={"businessId": business_id})
    return [str(p) for p in json.loads(rules.bannedPhrases)] if rules else []
