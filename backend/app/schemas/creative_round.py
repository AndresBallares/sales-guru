"""Schemas for follow-up creative rounds (see prisma CreativeRound)."""

from datetime import datetime
from typing import Literal

from app.schemas.base import CamelCaseModel
from app.schemas.creative import CreativeResponse
from app.schemas.strategy import GeneratedCreativeAngle

# OPEN: the user is still choosing which of its ads to publish. CLOSED: that
# choice is final (set when a round is published, which is a later step).
CreativeRoundStatus = Literal["OPEN", "CLOSED"]


class CreativeRoundResponse(CamelCaseModel):
    """A follow-up round with its angles and ads."""

    id: str
    campaign_id: str
    # Round 1 is the campaign's first batch and has no row; rounds start at 2.
    number: int
    status: CreativeRoundStatus
    generated_count: int
    selected_count: int
    angles: list[GeneratedCreativeAngle]
    creatives: list[CreativeResponse]
    created_at: datetime
