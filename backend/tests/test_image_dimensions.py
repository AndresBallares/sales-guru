"""Tests for the hand-rolled PNG/JPEG dimension parser.

Uses hand-built minimal headers, not real Pillow-generated files — the
parser only ever reads header bytes, never pixel data, so a structurally
valid header is all either format needs here.
"""

import struct

import pytest
from app.services.image_dimensions import (
    ImageDimensionError,
    get_image_dimensions,
)


def _fake_png(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x06\x00\x00\x00"
        + b"\x00\x00\x00\x00"
    )


def _fake_jpeg(width: int, height: int) -> bytes:
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 11)
        + bytes([8])
        + struct.pack(">HH", height, width)
        + bytes([1])
        + bytes([1, 0x11, 0])
        + b"\xff\xd9"
    )


def test_reads_png_dimensions() -> None:
    width, height = get_image_dimensions(_fake_png(1200, 900), "image/png")

    assert (width, height) == (1200, 900)


def test_reads_jpeg_dimensions() -> None:
    width, height = get_image_dimensions(_fake_jpeg(1200, 900), "image/jpeg")

    assert (width, height) == (1200, 900)


def test_jpeg_skips_non_sof_markers_before_the_frame_header() -> None:
    """A real JPEG has APP0/other segments before SOF0 — the parser must
    skip past them by their own length field, not assume SOF0 is first."""
    app0 = b"\xff\xe0" + struct.pack(">H", 6) + b"\x00\x00\x00\x00"
    jpeg = b"\xff\xd8" + app0 + _fake_jpeg(640, 480)[2:]

    width, height = get_image_dimensions(jpeg, "image/jpeg")

    assert (width, height) == (640, 480)


def test_png_raises_on_garbage_bytes() -> None:
    with pytest.raises(ImageDimensionError, match="Not a valid PNG"):
        get_image_dimensions(b"not a png at all", "image/png")


def test_jpeg_raises_on_garbage_bytes() -> None:
    with pytest.raises(ImageDimensionError, match="Not a valid JPEG"):
        get_image_dimensions(b"not a jpeg at all", "image/jpeg")


def test_jpeg_raises_when_no_sof_marker_present() -> None:
    jpeg_with_no_frame = b"\xff\xd8\xff\xd9"

    with pytest.raises(ImageDimensionError, match="Could not find JPEG dimensions"):
        get_image_dimensions(jpeg_with_no_frame, "image/jpeg")


def test_jpeg_skips_a_no_length_marker_like_a_restart() -> None:
    """RST markers (and SOI/EOI) carry no length field of their own —
    the parser must step over them by exactly 2 bytes, not try to read
    a length that doesn't exist."""
    restart_marker = b"\xff\xd0"
    jpeg = b"\xff\xd8" + restart_marker + _fake_jpeg(320, 240)[2:]

    width, height = get_image_dimensions(jpeg, "image/jpeg")

    assert (width, height) == (320, 240)


def test_jpeg_raises_on_a_non_ff_byte_where_a_marker_is_expected() -> None:
    jpeg = b"\xff\xd8" + b"\x00\x01\x02\x03"

    with pytest.raises(ImageDimensionError, match="Malformed JPEG marker"):
        get_image_dimensions(jpeg, "image/jpeg")


def test_jpeg_raises_when_sof_header_is_truncated() -> None:
    """The SOF marker is found, but the file is cut off before its
    height/width bytes — not enough data to read the frame header."""
    truncated = b"\xff\xd8" + b"\xff\xc0" + struct.pack(">H", 11) + bytes([8])

    with pytest.raises(ImageDimensionError, match="Could not find JPEG dimensions"):
        get_image_dimensions(truncated, "image/jpeg")


def test_raises_on_unsupported_content_type() -> None:
    with pytest.raises(ValueError, match="Unsupported content type"):
        get_image_dimensions(b"anything", "image/webp")
