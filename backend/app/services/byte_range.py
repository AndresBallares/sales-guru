"""HTTP byte-range (RFC 9110 section 14) parsing for served media.

Safari will not play a <video> unless the server answers Range requests with
206 Partial Content, so the public media route needs this.
"""

from typing import NamedTuple


class ByteRange(NamedTuple):
    """An inclusive, already-clamped byte range of a body of known length."""

    first: int
    last: int


class RangeNotSatisfiableError(ValueError):
    """The requested range starts at or past the end of the body (416)."""


def parse_range(header: str | None, length: int) -> ByteRange | None:
    """Resolve a Range header against a body of `length` bytes.

    Only a single `bytes=` range is honoured. Anything unparseable or
    unsupported (another unit, several ranges, reversed or empty ranges) is
    ignored, which makes the caller serve the whole body as RFC 9110 requires.

    Args:
        header: The raw Range header, or None.
        length: The body's size in bytes.

    Returns:
        The inclusive range to serve, or None to serve the whole body.

    Raises:
        RangeNotSatisfiableError: If the range starts at or past the end.
    """
    if not header or not header.startswith("bytes=") or "," in header:
        return None
    spec = header[len("bytes=") :].strip()
    first_text, dash, last_text = spec.partition("-")
    if not dash or not (
        first_text.isdigit() or (not first_text and last_text.isdigit())
    ):
        return None
    if not first_text:  # suffix: the last N bytes
        suffix = int(last_text)
        if suffix == 0:
            return None
        if length == 0:
            raise RangeNotSatisfiableError
        return ByteRange(max(length - suffix, 0), length - 1)
    first = int(first_text)
    if last_text and not last_text.isdigit():
        return None
    if last_text and int(last_text) < first:
        return None
    if first >= length:
        raise RangeNotSatisfiableError
    last = int(last_text) if last_text else length - 1
    return ByteRange(first, min(last, length - 1))
