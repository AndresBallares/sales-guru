"""Advice on a creative test's conversion event.

A creative test optimizes for Purchase unless the user chooses Add to Cart for
the campaign. This module only advises: it never switches the event. The
caller shows the reasons and the user decides.
"""

from app.schemas.strategy import EventAdvice

PIXEL_WINDOW_DAYS = 30


def event_advice(
    *, price: float | None, high_ticket_threshold: float, purchase_count: int | None
) -> EventAdvice:
    """When to suggest Add to Cart instead of Purchase, with the reasons.

    Two reasons, either enough: the product's price is at or above the
    high-ticket line (purchases will be rare on a test budget), or the Pixel
    recorded no Purchase events in the last 30 days (Meta has no purchase
    history to optimize for).

    Args:
        price: The product's price, if on file.
        high_ticket_threshold: The price at or above which a product is high-ticket.
        purchase_count: The Pixel's Purchase events over the last
            PIXEL_WINDOW_DAYS days, or None when they could not be read (no
            Pixel, or Meta failed). None never counts as zero.

    Returns:
        The advice; `recommended` is None when no reason applies.
    """
    reasons: list[str] = []
    if price is not None and price >= high_ticket_threshold:
        reasons.append(
            f"This product costs ${price:,.0f}, at or above the "
            f"${high_ticket_threshold:,.0f} high-ticket line. Purchases will be "
            "rare on a test budget, so Meta may not get enough of them to learn "
            "from. Add to Cart gives it more signal to work with."
        )
    if purchase_count == 0:
        reasons.append(
            f"This Pixel recorded 0 Purchase events in the last {PIXEL_WINDOW_DAYS} "
            "days, so Meta has no purchase history to optimize for. Add to Cart "
            "is easier for it to find."
        )
    return EventAdvice(
        recommended="ADD_TO_CART" if reasons else None,
        reasons=reasons,
        pixel_checked=purchase_count is not None,
    )
