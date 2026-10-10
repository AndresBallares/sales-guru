"""MP4/MOV header parsing and aspect-ratio classification for product media.

Hand-rolled, like app/services/image_dimensions.py, instead of pulling in a
media library or requiring ffmpeg on the host (confirmed 2026-10-07): an
MP4/MOV (ISO base media file format / QuickTime) is a tree of length-prefixed
boxes, and everything this app needs to validate an upload — displayed size and
duration — sits in the `moov` box's `mvhd` and `tkhd` headers. Frames are never
decoded; the thumbnail is captured in the browser and validated as an image.
"""

import struct
from collections.abc import Iterator
from typing import Literal, NamedTuple

AspectClass = Literal["FEED", "STORY", "LANDSCAPE", "UNCLASSIFIED"]

# Meta's placement shapes (1:1 and 4:5 feed, 9:16 story/reels, 1.91:1
# landscape), matched within this relative tolerance so a phone's 1080x1340
# crop of a 4:5 still counts as feed.
_ASPECT_TARGETS: tuple[tuple[AspectClass, float], ...] = (
    ("FEED", 1.0),
    ("FEED", 4 / 5),
    ("STORY", 9 / 16),
    ("LANDSCAPE", 1.91),
)
ASPECT_TOLERANCE = 0.03

_TOP_LEVEL_HEADER = 8
_FIXED_16_16 = 65536


class VideoParseError(ValueError):
    """Raised when an MP4/MOV's size or duration can't be read from its bytes."""


class VideoInfo(NamedTuple):
    """What an uploaded video's headers say about it."""

    width: int
    height: int
    duration_seconds: float


def classify_aspect(width: int, height: int) -> AspectClass:
    """Which Meta placement shape a width x height falls in.

    Args:
        width: Displayed width in pixels.
        height: Displayed height in pixels.

    Returns:
        FEED (1:1 or 4:5), STORY (9:16), LANDSCAPE (1.91:1), each within
        ASPECT_TOLERANCE, otherwise UNCLASSIFIED (including a non-positive size).
    """
    if width <= 0 or height <= 0:
        return "UNCLASSIFIED"
    ratio = width / height
    for aspect_class, target in _ASPECT_TARGETS:
        if abs(ratio / target - 1) <= ASPECT_TOLERANCE:
            return aspect_class
    return "UNCLASSIFIED"


def is_square(width: int | None, height: int | None) -> bool:
    """Whether a width x height is 1:1, within ASPECT_TOLERANCE.

    FEED covers both 1:1 and 4:5, so the optional Square asset of an ad needs
    this exact check on top of the class.
    """
    if not width or not height or width <= 0 or height <= 0:
        return False
    return abs(width / height - 1) <= ASPECT_TOLERANCE


def _boxes(data: bytes, start: int, end: int) -> Iterator[tuple[bytes, int, int]]:
    """Yield (type, payload_start, box_end) for each box in data[start:end]."""
    offset = start
    while offset < end:
        if offset + _TOP_LEVEL_HEADER > end:
            raise VideoParseError("Truncated box header")
        size, box_type = struct.unpack(">I4s", data[offset : offset + 8])
        header = _TOP_LEVEL_HEADER
        if size == 1:  # 64-bit "largesize" follows the type
            if offset + 16 > end:
                raise VideoParseError("Truncated box header")
            size = struct.unpack(">Q", data[offset + 8 : offset + 16])[0]
            header = 16
        elif size == 0:  # runs to the end of the enclosing container
            size = end - offset
        if size < header or offset + size > end:
            raise VideoParseError("Box size runs past the end of the file")
        yield box_type, offset + header, offset + size
        offset += size


def _find(data: bytes, start: int, end: int, wanted: bytes) -> tuple[int, int] | None:
    for box_type, payload_start, box_end in _boxes(data, start, end):
        if box_type == wanted:
            return payload_start, box_end
    return None


def _duration_seconds(data: bytes, start: int, end: int) -> float:
    version = data[start] if start < end else 0
    if version == 1:
        fmt, offset, size = ">IQ", start + 20, 12
    else:
        fmt, offset, size = ">II", start + 12, 8
    if offset + size > end:
        raise VideoParseError("Truncated movie header")
    timescale, duration = struct.unpack(fmt, data[offset : offset + size])
    if timescale == 0:
        raise VideoParseError("Movie header has no timescale")
    return float(duration / timescale)


def _handler(data: bytes, start: int, end: int) -> bytes | None:
    mdia = _find(data, start, end, b"mdia")
    if mdia is None:
        return None
    hdlr = _find(data, *mdia, b"hdlr")
    if hdlr is None or hdlr[0] + 12 > hdlr[1]:
        return None
    return data[hdlr[0] + 8 : hdlr[0] + 12]


def _track_size(data: bytes, start: int, end: int) -> tuple[int, int] | None:
    tkhd = _find(data, start, end, b"tkhd")
    if tkhd is None:
        return None
    payload, tkhd_end = tkhd
    version = data[payload]
    matrix_at = payload + (52 if version == 1 else 40)
    if matrix_at + 44 > tkhd_end:
        raise VideoParseError("Truncated track header")
    a, b, _, c, d, *_ = struct.unpack(">9i", data[matrix_at : matrix_at + 36])
    raw_w, raw_h = struct.unpack(">II", data[matrix_at + 36 : matrix_at + 44])
    width, height = raw_w // _FIXED_16_16, raw_h // _FIXED_16_16
    if a == 0 and d == 0 and b != 0 and c != 0:  # rotated 90 or 270 degrees
        width, height = height, width
    return width, height


def read_video_info(data: bytes) -> VideoInfo:
    """Read a video's displayed size and duration from its MP4/MOV headers.

    Args:
        data: The whole uploaded file.

    Returns:
        The first video track's displayed width/height (after any rotation)
        and the movie's duration in seconds.

    Raises:
        VideoParseError: If the bytes aren't a readable MP4/MOV, have no video
            track, or the headers are truncated or inconsistent.
    """
    moov = _find(data, 0, len(data), b"moov")
    if moov is None:
        raise VideoParseError("Not a valid MP4/MOV file (no movie box)")
    moov_start, moov_end = moov
    mvhd = _find(data, moov_start, moov_end, b"mvhd")
    if mvhd is None:
        raise VideoParseError("The movie has no header")
    duration = _duration_seconds(data, *mvhd)

    for box_type, start, end in _boxes(data, moov_start, moov_end):
        if box_type != b"trak" or _handler(data, start, end) != b"vide":
            continue
        size = _track_size(data, start, end)
        if size is None or min(size) <= 0:
            raise VideoParseError("The video track has no size")
        return VideoInfo(size[0], size[1], duration)
    raise VideoParseError("The file has no video track")
