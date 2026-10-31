"""Buyer avatar library endpoints, scoped to a business.

The Strategist and Creative Agents will read a business's active avatars
instead of inventing a persona; this module only stores and serves them. Every
route goes through get_owned_business, so another user's business is a 404.
"""

import json
import secrets
from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from prisma.models import Business, BuyerAvatar
from prisma.types import (
    BuyerAvatarCreateInput,
    BuyerAvatarUpdateInput,
    BuyerAvatarWhereInput,
)

from app.core.authz import get_owned_business
from app.core.config import get_settings
from app.core.db import db
from app.schemas.avatar_import import (
    AvatarImportRequest,
    AvatarImportResponse,
    BuyerAvatarBulkRequest,
)
from app.schemas.buyer_avatar import (
    MAX_BUYER_AVATARS_PER_BUSINESS,
    MAX_ITEMS,
    BuyerAvatarCreateRequest,
    BuyerAvatarResponse,
    BuyerAvatarUpdateRequest,
    PurchaseFor,
)
from app.services.avatar_import import AvatarImportError, generate_avatar_drafts

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
        purchase_for=cast(PurchaseFor, avatar.purchaseFor),
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
    avatar = await db.buyeravatar.create(
        data=_create_data(business.id, payload, sort_order)
    )
    return _to_response(avatar)


def _new_id() -> str:
    """A fresh row id shaped like a Prisma cuid (25 characters, 'c' first)."""
    return "c" + secrets.token_hex(12)


def _create_data(
    business_id: str, payload: BuyerAvatarCreateRequest, sort_order: int
) -> BuyerAvatarCreateInput:
    """The row to insert for a new avatar, its lists stored as JSON strings."""
    data: dict[str, Any] = {
        "businessId": business_id,
        "name": payload.name,
        "who": payload.who,
        "purchaseFor": payload.purchase_for,
        "isActive": payload.is_active,
        "sortOrder": sort_order,
    }
    for field, column in _LIST_COLUMNS.items():
        data[column] = json.dumps(getattr(payload, field))
    return cast(BuyerAvatarCreateInput, data)


@router.post("/import", response_model=AvatarImportResponse)
async def import_avatars(
    payload: AvatarImportRequest,
    business: Business = Depends(get_owned_business),
) -> AvatarImportResponse:
    """Read a pasted research document into avatar drafts. Saves nothing.

    Args:
        payload: The pasted document.
        business: The business, resolved and ownership-checked.

    Returns:
        Drafts to review, and warnings (gaps, and names already in the library).

    Raises:
        HTTPException: 404 if import is switched off, 502 if the model's answer
            could not be used.
    """
    settings = get_settings()
    if not (settings.avatar_import_enabled or settings.fake_llm_enabled):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Avatar import is not enabled"
        )
    try:
        result = await generate_avatar_drafts(payload.document)
    except AvatarImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc

    existing = await db.buyeravatar.find_many(
        where={"businessId": business.id, "deletedAt": None}
    )
    taken = {a.name.casefold() for a in existing}
    warnings = list(result.warnings)
    for draft in result.drafts:
        if draft.name.casefold() in taken:
            warnings.append(f'"{draft.name}" is already in your library')
    return AvatarImportResponse(drafts=result.drafts, warnings=warnings)


@router.post(
    "/bulk",
    response_model=list[BuyerAvatarResponse],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_avatars(
    payload: BuyerAvatarBulkRequest,
    business: Business = Depends(get_owned_business),
) -> list[BuyerAvatarResponse]:
    """Save reviewed drafts together: all of them, or none.

    Args:
        payload: The avatars to add, after the business's existing ones unless
            they carry a sort order.
        business: The business, resolved and ownership-checked.

    Returns:
        The created avatars, in the order sent.

    Raises:
        HTTPException: 409 if they would not all fit under the library's limit.
    """
    existing = await db.buyeravatar.find_many(
        where={"businessId": business.id, "deletedAt": None}
    )
    if len(existing) + len(payload.avatars) > MAX_BUYER_AVATARS_PER_BUSINESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A business can hold at most {MAX_BUYER_AVATARS_PER_BUSINESS} "
                f"avatars — it has {len(existing)}, so {len(payload.avatars)} "
                "more will not fit"
            ),
        )
    next_order = max((a.sortOrder for a in existing), default=-1) + 1
    ids = [_new_id() for _ in payload.avatars]
    rows = [
        {
            **_create_data(
                business.id,
                item,
                item.sort_order if item.sort_order is not None else next_order + n,
            ),
            "id": ids[n],
        }
        for n, item in enumerate(payload.avatars)
    ]
    # One batch is a single write that commits or fails as a whole. An interactive
    # transaction held open across these reads and writes expired whenever SQLite
    # was busy (a full e2e run), and its commit then failed with a 500.
    async with db.batch_() as batcher:
        for row in rows:
            batcher.buyeravatar.create(data=cast(BuyerAvatarCreateInput, row))
    created = await db.buyeravatar.find_many(where={"id": {"in": ids}})
    by_id = {a.id: a for a in created}
    return [_to_response(by_id[avatar_id]) for avatar_id in ids]


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
        elif field == "purchase_for":
            data["purchaseFor"] = value
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
