"""Proposal to move an AddToCart creative test to Purchase (creative-first rework).

**What this does:** a creative test for an expensive product optimizes for
AddToCart, because purchases are too rare at a test budget to learn from.
Once the test has recorded about 25 purchases there is enough signal for Meta
to optimize for Purchase itself. The Optimizer then proposes the switch, once
per campaign. It is only ever a proposal: the user approves it, and it is never
applied on its own.

**Why a new ad set:** Meta doesn't document an ad set's optimization event
(`promoted_object`) as editable after creation, so the switch means a new ad
set that optimizes for Purchase, not an edit of the running one.

**Status:** approving the proposal today raises SwitchToPurchaseNotBuiltError,
the way a retargeting proposal does: creating the new ad set isn't built yet,
so the approval is recorded as interest only and nothing changes on Meta.
"""

from app.schemas.strategy import SWITCH_TO_PURCHASE_MIN_PURCHASES
from app.services.proposals import ProposalNotBuiltError


class SwitchToPurchaseNotBuiltError(ProposalNotBuiltError):
    """Raised when a switch is approved: creating the Purchase ad set isn't built."""


def switch_ready(purchases: int) -> bool:
    """Whether an AddToCart test has enough purchases to propose the switch."""
    return purchases >= SWITCH_TO_PURCHASE_MIN_PURCHASES


def proposal_reasoning(purchases: int) -> str:
    """The plain-language case for the switch, shown with the proposal."""
    return (
        f"This test has recorded {purchases} purchases while optimizing for "
        f"add-to-cart (the switch is proposed at about "
        f"{SWITCH_TO_PURCHASE_MIN_PURCHASES}). That is enough signal for Meta "
        "to optimize for purchases directly. Proposed: add a new ad set that "
        "optimizes for Purchase with the winning ads; an existing ad set's "
        "optimization event can't be changed. Nothing changes until you approve."
    )
