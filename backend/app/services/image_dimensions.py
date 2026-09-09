"""Minimal image dimension reading for upload validation.

Hand-rolled instead of pulling in Pillow — the only two formats this app
accepts (JPEG, PNG; app/schemas/product_image.py's
ALLOWED_CONTENT_TYPES) each have a simple, well-documented header
layout, so a small parser here avoids a new dependency for a narrow need
(confirmed 2026-09-09).
"""

import struct

# Start-of-frame markers (baseline/extended/progressive JPEG) carry the
# dimensions; every other 0xFFCx marker in this range is something else
# (0xC4 DHT, 0xC8 JPG extension, 0xCC DAC) and must be skipped like any
# other segment, not read as a frame header.
_JPEG_SOF_MARKERS = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}
# Markers with no length field / segment body of their own.
_JPEG_NO_LENGTH_MARKERS = frozenset({0xD8, 0xD9}) | set(range(0xD0, 0xD8))


class ImageDimensionError(ValueError):
    """Raised when an image's dimensions can't be determined from its bytes."""


def _png_dimensions(data: bytes) -> tuple[int, int]:
    """Read width/height from a PNG's IHDR chunk (always the first chunk)."""
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise ImageDimensionError("Not a valid PNG file")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Walk JPEG marker segments until a start-of-frame marker gives the size."""
    if len(data) < 4 or data[0:2] != b"\xff\xd8":
        raise ImageDimensionError("Not a valid JPEG file")
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            raise ImageDimensionError("Malformed JPEG marker")
        marker = data[offset + 1]
        if marker in _JPEG_NO_LENGTH_MARKERS:
            offset += 2
            continue
        length = struct.unpack(">H", data[offset + 2 : offset + 4])[0]
        if marker in _JPEG_SOF_MARKERS:
            if offset + 9 > len(data):
                break
            height, width = struct.unpack(">HH", data[offset + 5 : offset + 9])
            return width, height
        offset += 2 + length
    raise ImageDimensionError("Could not find JPEG dimensions")


def get_image_dimensions(data: bytes, content_type: str) -> tuple[int, int]:
    """Read an image's (width, height) in pixels straight from its bytes.

    Args:
        data: The raw image bytes.
        content_type: One of app/schemas/product_image.py's
            ALLOWED_CONTENT_TYPES — the only two formats this parses.

    Returns:
        (width, height) in pixels.

    Raises:
        ImageDimensionError: If the bytes don't look like a valid image
            of the given content type.
        ValueError: If content_type isn't jpeg or png.
    """
    if content_type == "image/png":
        return _png_dimensions(data)
    if content_type == "image/jpeg":
        return _jpeg_dimensions(data)
    raise ValueError(
        f"Unsupported content type for dimension reading: {content_type!r}"
    )
