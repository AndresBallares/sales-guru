"""Buyer avatar library endpoints, scoped to a business.

The Strategist and Creative Agents will read a business's active avatars
instead of inventing a persona; this module only stores and serves them. Every
route goes through get_owned_business, so another user's business is a 404.
"""

import json
from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from prisma.models import Business, BuyerAvatar
from prisma.types import BuyerAvatarUpdateInput, BuyerAvatarWhereInput

from app.core.authz import get_owned_business
from app.core.db import db
from app.schemas.buyer_avatar import (
    MAX_BUYER_AVATARS_PER_BUSINESS,
    MAX_ITEMS,
    BuyerAvatarCreateRequest,
    BuyerAvatarResponse,
    BuyerAvatarUpdateRequest,
)

router = APIRouter(prefix="/businesses/{business_id}/avatars", tags=["avatars"])

_NOT_FOUND = "Avatar not found"

# camelCase column name of each list field.
_LIST_COLUMNS = {
    "primary_problems": "primaryProblems",
    "unknown_problems": "unknownProblems",
    "mechanisms": "mechanisms",
    "alternatives": "alternatives",
    "objections": "objections",
    "hooks": "hooks",
    "creative_angles": "creativeAngles",
}
assert set(_LIST_COLUMNS) == set(MAX_ITEMS)


def _to_response(avatar: BuyerAvatar) -> BuyerAvatarResponse:
    """Map a Prisma BuyerAvatar to its response, parsing the stored JSON lists."""
    lists = {
        field: json.loads(getattr(avatar, column))
        for field, column in _LIST_COLUMNS.items()
    }
    return BuyerAvatarResponse(
        id=avatar.id,
        business_id=avatar.businessId,
        name=avatar.name,
        who=avatar.who,
        is_active=avatar.isActive,
        sort_order=avatar.sortOrder,
        deleted_at=avatar.deletedAt,
        **lists,
    )


async def _find_avatar(
    business: Business, avatar_id: str, *, include_deleted: bool = False
) -> BuyerAvatar:
    """The business's avatar with this id, or a 404 (a deleted one counts as gone)."""
    where: BuyerAvatarWhereInput = {"id": avatar_id, "businessId": business.id}
    if not include_deleted:
        where["deletedAt"] = None
    avatar = await db.buyeravatar.find_first(where=where)
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return avatar


@router.post(
    "", response_model=BuyerAvatarResponse, status_code=status.HTTP_201_CREATED
)
async def create_avatar(
    payload: BuyerAvatarCreateRequest,
    business: Business = Depends(get_owned_business),
) -> BuyerAvatarResponse:
    """Add an avatar to a business's library.

    Args:
        payload: The avatar; only name and who are required.
        business: The business, resolved and ownership-checked.

    Returns:
        The created avatar.

    Raises:
        HTTPException: 409 if the business already holds the maximum.
    """
    existing = await db.buyeravatar.find_many(
        where={"businessId": business.id, "deletedAt": None}
    )
    if len(existing) >= MAX_BUYER_AVATARS_PER_BUSINESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A business can hold at most {MAX_BUYER_AVATARS_PER_BUSINESS} "
                "avatars — delete one first"
            ),
        )
    sort_order = payload.sort_order
    if sort_order is None:
        sort_order = max((a.sortOrder for a in existing), default=-1) + 1
    data: dict[str, Any] = {
        "businessId": business.id,
        "name": payload.name,
        "who": payload.who,
        "isActive": payload.is_active,
        "sortOrder": sort_order,
    }
    for field, column in _LIST_COLUMNS.items():
        data[column] = json.dumps(getattr(payload, field))
    avatar = await db.buyeravatar.create(data=cast(Any, data))
    return _to_response(avatar)


@router.get("", response_model=list[BuyerAvatarResponse])
async def list_avatars(
    active: bool | None = None,
    include_deleted: bool = Query(default=False, alias="includeDeleted"),
    business: Business = Depends(get_owned_business),
) -> list[BuyerAvatarResponse]:
    """List a business's avatars in sort order.

    Args:
        active: True for active avatars only, False for inactive only, absent
            for all.
        include_deleted: Also return deleted avatars, marked by ``deletedAt``,
            so old angles and results can be labeled.
        business: The business, resolved and ownership-checked.

    Returns:
        The avatars, by sort order then creation time.
    """
    where: BuyerAvatarWhereInput = {"businessId": business.id}
    if not include_deleted:
        where["deletedAt"] = None
    if active is not None:
        where["isActive"] = active
    avatars = await db.buyeravatar.find_many(
        where=where, order=[{"sortOrder": "asc"}, {"createdAt": "asc"}]
    )
    return [_to_response(a) for a in avatars]


@router.get("/{avatar_id}", response_model=BuyerAvatarResponse)
async def get_avatar(
    avatar_id: str,
    include_deleted: bool = Query(default=False, alias="includeDeleted"),
    business: Business = Depends(get_owned_business),
) -> BuyerAvatarResponse:
    """Fetch one avatar.

    Args:
        avatar_id: The avatar's id.
        include_deleted: Also find a deleted avatar, marked by ``deletedAt``.
        business: The business, resolved and ownership-checked.

    Returns:
        The avatar.
    """
    return _to_response(
        await _find_avatar(business, avatar_id, include_deleted=include_deleted)
    )


@router.patch("/{avatar_id}", response_model=BuyerAvatarResponse)
async def update_avatar(
    avatar_id: str,
    payload: BuyerAvatarUpdateRequest,
    business: Business = Depends(get_owned_business),
) -> BuyerAvatarResponse:
    """Change some fields of an avatar.

    Args:
        avatar_id: The avatar's id.
        payload: The fields to change; absent or null ones stay as they are.
        business: The business, resolved and ownership-checked.

    Returns:
        The updated avatar.
    """
    avatar = await _find_avatar(business, avatar_id)
    sent = payload.model_dump(exclude_unset=True)
    data: dict[str, Any] = {}
    for field, value in sent.items():
        if value is None:
            continue
        if field in _LIST_COLUMNS:
            data[_LIST_COLUMNS[field]] = json.dumps(value)
        elif field == "is_active":
            data["isActive"] = value
        elif field == "sort_order":
            data["sortOrder"] = value
        else:
            data[field] = value
    if not data:
        return _to_response(avatar)
    updated = await db.buyeravatar.update(
        where={"id": avatar.id}, data=cast(BuyerAvatarUpdateInput, data)
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    return _to_response(updated)


@router.delete("/{avatar_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_avatar(
    avatar_id: str, business: Business = Depends(get_owned_business)
) -> Response:
    """Delete an avatar (soft: the row stays, marked with ``deletedAt``).

    A deleted avatar disappears from lists and edits and cannot be assigned to
    new angles, but angles and results that already name it still resolve it
    (``?includeDeleted=true``).

    Args:
        avatar_id: The avatar's id.
        business: The business, resolved and ownership-checked.

    Returns:
        An empty 204.
    """
    avatar = await _find_avatar(business, avatar_id)
    await db.buyeravatar.update(
        where={"id": avatar.id}, data={"deletedAt": datetime.now(UTC)}
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
