"""Lookups over a business's buyer avatar library.

Two questions are answered differently on purpose. Which avatars may a new
angle use? Only active, not-deleted ones (``assignable_avatars``). Which avatar
does an existing angle or result belong to? Any of the business's avatars,
deleted or inactive included (``avatars_by_id``), so history keeps its label
after an avatar is removed.
"""

from collections.abc import Sequence

from prisma import Prisma
from prisma.models import BuyerAvatar

from app.core.db import db


async def assignable_avatars(
    business_id: str, *, client: Prisma = db
) -> list[BuyerAvatar]:
    """The avatars a new angle may be assigned: active and not deleted.

    Args:
        business_id: The business whose library to read.
        client: The database client; only tests pass their own.

    Returns:
        The avatars, by sort order then creation time.
    """
    return await client.buyeravatar.find_many(
        where={"businessId": business_id, "isActive": True, "deletedAt": None},
        order=[{"sortOrder": "asc"}, {"createdAt": "asc"}],
    )


async def avatars_by_id(
    business_id: str, avatar_ids: Sequence[str], *, client: Prisma = db
) -> dict[str, BuyerAvatar]:
    """Resolve avatar ids to avatars for labeling, deleted and inactive ones too.

    Args:
        business_id: The business the ids belong to; others are not resolved.
        avatar_ids: The ids to look up (an angle's ``buyerAvatarId`` values).
        client: The database client; only tests pass their own.

    Returns:
        The avatars found, keyed by id; an unknown id is simply absent.
    """
    if not avatar_ids:
        return {}
    found = await client.buyeravatar.find_many(
        where={"businessId": business_id, "id": {"in": list(avatar_ids)}}
    )
    return {a.id: a for a in found}
