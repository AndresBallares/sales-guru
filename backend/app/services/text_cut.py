"""Cutting long text at a word boundary instead of mid-word."""

_ELLIPSIS = "…"


def cut_at_word(text: str, limit: int) -> str:
    """Shorten text to at most ``limit`` characters, ending on a whole word.

    A cut that lands inside a word backs up to the last whitespace before it, so
    a prompt never reads "...gold and ston". The cut text ends with an ellipsis
    (counted in the limit). A single unbroken run longer than the limit has no
    word boundary to back up to, so it is cut hard.

    Args:
        text: The text to shorten.
        limit: The most characters the result may have, ellipsis included.

    Returns:
        ``text`` unchanged if it fits, otherwise the cut text plus an ellipsis.
    """
    if len(text) <= limit:
        return text
    if limit <= len(_ELLIPSIS):
        return _ELLIPSIS
    head = text[: limit - len(_ELLIPSIS)]
    if not text[len(head)].isspace():
        boundary = max((i for i, ch in enumerate(head) if ch.isspace()), default=-1)
        if boundary > 0:
            head = head[:boundary]
    return head.rstrip() + _ELLIPSIS
