"""Schemas for the per-business buyer avatar library.

A buyer avatar is a researched description of one kind of customer: who they
are, what they struggle with, what they don't know yet, which mechanisms matter
to them, what they buy today, what holds them back and which hooks work on
them. The caps below keep every field small enough to sit in a prompt; the
Strategist and Creative Agents pick single entries (one problem, one mechanism,
one objection, a few hooks) rather than pasting a whole avatar.

Named BuyerAvatar because ``app.schemas.strategy.Avatar`` already means the two
fixed buyers (self_purchaser, gift_buyer) that feed ad names and UTM parameters.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, ValidationInfo, field_validator

from app.schemas.base import CamelCaseModel

MAX_NAME_LENGTH = 60
MAX_WHO_LENGTH = 600
MAX_ITEM_LENGTH = 200
MAX_BUYER_AVATARS_PER_BUSINESS = 12

# Most entries each list may hold, by field. Hooks are 5-8 approved lines.
MAX_ITEMS: dict[str, int] = {
    "primary_problems": 8,
    "unknown_problems": 8,
    "mechanisms": 6,
    "alternatives": 8,
    "objections": 8,
    "hooks": 8,
    "creative_angles": 10,
}

# Who the avatar buys for. The Strategist derives an angle's fixed avatar
# (self_purchaser or gift_buyer) from this, so the two never disagree.
PurchaseFor = Literal["self", "gift"]

_Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH),
]
_Who = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_WHO_LENGTH),
]

_LIST_FIELDS = tuple(MAX_ITEMS)


def _clean_items(value: list[str] | None, info: ValidationInfo) -> list[str] | None:
    """Trim a list's entries, drop blank ones and enforce the field's caps.

    Args:
        value: The list as sent, or None when the field was left out of a patch.
        info: Validation info, for the field's name.

    Returns:
        The cleaned list, or None when value was None.

    Raises:
        ValueError: If an entry is too long or the list holds too many entries.
    """
    if value is None:
        return None
    field = str(info.field_name)
    cleaned = [item.strip() for item in value if item.strip()]
    for item in cleaned:
        if len(item) > MAX_ITEM_LENGTH:
            raise ValueError(
                f"Each entry must be at most {MAX_ITEM_LENGTH} characters "
                f"(got {len(item)}): {item[:40]!r}..."
            )
    if len(cleaned) > MAX_ITEMS[field]:
        raise ValueError(f"At most {MAX_ITEMS[field]} entries (got {len(cleaned)})")
    return cleaned


class BuyerAvatarCreateRequest(CamelCaseModel):
    """Payload for creating a buyer avatar; only name and who are required."""

    name: _Name
    who: _Who
    primary_problems: list[str] = Field(default_factory=list)
    unknown_problems: list[str] = Field(default_factory=list)
    mechanisms: list[str] = Field(default_factory=list)
    alternatives: list[str] = Field(default_factory=list)
    objections: list[str] = Field(default_factory=list)
    hooks: list[str] = Field(default_factory=list)
    creative_angles: list[str] = Field(default_factory=list)
    purchase_for: PurchaseFor = "self"
    is_active: bool = True
    # None puts the avatar after the business's others.
    sort_order: int | None = None

    @field_validator(*_LIST_FIELDS)
    @classmethod
    def _clean(cls, value: list[str], info: ValidationInfo) -> list[str]:
        cleaned = _clean_items(value, info)
        assert cleaned is not None
        return cleaned


class BuyerAvatarUpdateRequest(CamelCaseModel):
    """Payload for PATCH: every field optional, null or absent leaves it alone.

    A list that is sent replaces the stored one whole; an empty list clears it.
    """

    name: _Name | None = None
    who: _Who | None = None
    primary_problems: list[str] | None = None
    unknown_problems: list[str] | None = None
    mechanisms: list[str] | None = None
    alternatives: list[str] | None = None
    objections: list[str] | None = None
    hooks: list[str] | None = None
    creative_angles: list[str] | None = None
    purchase_for: PurchaseFor | None = None
    is_active: bool | None = None
    sort_order: int | None = None

    @field_validator(*_LIST_FIELDS)
    @classmethod
    def _clean(cls, value: list[str] | None, info: ValidationInfo) -> list[str] | None:
        return _clean_items(value, info)


class BuyerAvatarResponse(CamelCaseModel):
    """Public-facing representation of a BuyerAvatar."""

    id: str
    business_id: str
    name: str
    who: str
    primary_problems: list[str]
    unknown_problems: list[str]
    mechanisms: list[str]
    alternatives: list[str]
    objections: list[str]
    hooks: list[str]
    creative_angles: list[str]
    purchase_for: PurchaseFor
    is_active: bool
    sort_order: int
    # Set once the avatar is deleted; old angles and results still resolve it.
    deleted_at: datetime | None = None
