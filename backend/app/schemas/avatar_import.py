"""Schemas for importing buyer avatars from a pasted research document.

The model reads the document and proposes avatar drafts; nothing is saved until
the owner reviews them and posts the ones they want to the bulk endpoint. The
field caps are the library's own (app.schemas.buyer_avatar), written into the
tool schema so the model sees them, and enforced again when its answer is read.
"""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.base import CamelCaseModel
from app.schemas.buyer_avatar import (
    MAX_BUYER_AVATARS_PER_BUSINESS,
    MAX_ITEM_LENGTH,
    MAX_ITEMS,
    MAX_NAME_LENGTH,
    MAX_WHO_LENGTH,
    BuyerAvatarCreateRequest,
    PurchaseFor,
)

MAX_DOCUMENT_LENGTH = 30_000
MAX_MODEL_WARNINGS = 10

_Item = Annotated[str, Field(max_length=MAX_ITEM_LENGTH)]


class AvatarImportRequest(CamelCaseModel):
    """The pasted research document."""

    document: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=MAX_DOCUMENT_LENGTH
        ),
    ]


class AvatarDraft(BaseModel):
    """One avatar the model found in the document.

    Every field is required (a list may be empty) so the tool schema has no
    optional properties, which keeps it inside strict mode's limits.
    """

    name: str = Field(
        min_length=1,
        max_length=MAX_NAME_LENGTH,
        description="A short descriptive label for this kind of customer.",
    )
    who: str = Field(
        min_length=1,
        max_length=MAX_WHO_LENGTH,
        description="Who they are, in a sentence or two, from the document.",
    )
    purchase_for: PurchaseFor = Field(
        description="gift if this customer buys for someone else, otherwise self."
    )
    primary_problems: list[_Item] = Field(
        max_length=MAX_ITEMS["primary_problems"],
        description="Problems the document says this customer has. Empty if none.",
    )
    unknown_problems: list[_Item] = Field(
        max_length=MAX_ITEMS["unknown_problems"],
        description="What they do not know yet and must be taught. Empty if none.",
    )
    mechanisms: list[_Item] = Field(
        max_length=MAX_ITEMS["mechanisms"],
        description="Mechanisms or features that matter to them. Empty if none.",
    )
    alternatives: list[_Item] = Field(
        max_length=MAX_ITEMS["alternatives"],
        description="What they buy or do today instead. Empty if none.",
    )
    objections: list[_Item] = Field(
        max_length=MAX_ITEMS["objections"],
        description="What holds them back from buying. Empty if none.",
    )
    hooks: list[_Item] = Field(
        max_length=MAX_ITEMS["hooks"],
        description="Messaging hooks written in the document. Empty if none.",
    )
    creative_angles: list[_Item] = Field(
        max_length=MAX_ITEMS["creative_angles"],
        description="Creative angle ideas written in the document. Empty if none.",
    )


class GeneratedAvatarDrafts(BaseModel):
    """The tool-call payload: the avatars found, and notes for the owner."""

    avatars: list[AvatarDraft] = Field(
        min_length=1,
        max_length=MAX_BUYER_AVATARS_PER_BUSINESS,
        description="Every distinct buyer avatar the document describes.",
    )
    # Optional notes: a real Sonnet 5 answer left this out (2026-10-31) and the
    # rejection cost a full retry, so a missing field means "no notes".
    warnings: list[str] = Field(
        default_factory=list,
        max_length=MAX_MODEL_WARNINGS,
        description="Short notes on gaps: fields the document does not cover.",
    )


class AvatarImportResponse(CamelCaseModel):
    """Drafts for the owner to review. Nothing here is saved."""

    drafts: list[BuyerAvatarCreateRequest]
    warnings: list[str]


class BuyerAvatarBulkRequest(CamelCaseModel):
    """Reviewed drafts to save together, all or none."""

    avatars: list[BuyerAvatarCreateRequest] = Field(
        min_length=1, max_length=MAX_BUYER_AVATARS_PER_BUSINESS
    )
