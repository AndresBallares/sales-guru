"""Builders for minimal, structurally valid MP4/MOV files used by media tests.

Real header layout (ISO base media file format: ftyp + moov{mvhd, trak{tkhd,
mdia{hdlr}}} + mdat), fake sample data — enough for app/services/media_info.py
to read, not to play.
"""

import struct


def box(box_type: bytes, payload: bytes = b"") -> bytes:
    """One ISO BMFF box: 32-bit size, 4-char type, payload."""
    return struct.pack(">I4s", 8 + len(payload), box_type) + payload


def _fixed_16_16(value: int) -> bytes:
    return struct.pack(">I", value << 16)


_IDENTITY = struct.pack(">9i", 0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
_ROTATE_90 = struct.pack(">9i", 0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000)


def mvhd(duration_seconds: float, timescale: int = 1000, version: int = 0) -> bytes:
    ticks = round(duration_seconds * timescale)
    if version == 1:
        head = struct.pack(">B3xQQIQ", 1, 0, 0, timescale, ticks)
    else:
        head = struct.pack(">B3xIIII", 0, 0, 0, timescale, ticks)
    tail = struct.pack(">IH10x", 0x10000, 0x0100) + _IDENTITY + bytes(24)
    return box(b"mvhd", head + tail + struct.pack(">I", 2))


def tkhd(width: int, height: int, rotation: int = 0) -> bytes:
    matrix = _ROTATE_90 if rotation == 90 else _IDENTITY
    payload = (
        struct.pack(">B3x", 0)
        + struct.pack(">IIIII", 0, 0, 1, 0, 0)  # created, modified, id, rsvd, dur
        + bytes(8)
        + struct.pack(">hhhh", 0, 0, 0, 0)  # layer, alt group, volume, rsvd
        + matrix
        + _fixed_16_16(width)
        + _fixed_16_16(height)
    )
    return box(b"tkhd", payload)


def hdlr(handler: bytes) -> bytes:
    return box(b"hdlr", struct.pack(">B3xI", 0, 0) + handler + bytes(12) + b"\x00")


def trak(handler: bytes, width: int = 0, height: int = 0, rotation: int = 0) -> bytes:
    return box(b"trak", tkhd(width, height, rotation) + box(b"mdia", hdlr(handler)))


def make_mp4(
    width: int = 1080,
    height: int = 1920,
    duration_seconds: float = 10.0,
    *,
    timescale: int = 1000,
    mvhd_version: int = 0,
    rotation: int = 0,
    brand: bytes = b"isom",
    audio_first: bool = False,
    moov_first: bool = True,
    largesize_mdat: bool = False,
    padding: int = 0,
) -> bytes:
    """A minimal MP4/MOV with one video track (and optionally an audio track)."""
    video = trak(b"vide", width, height, rotation)
    audio = trak(b"soun")
    tracks = audio + video if audio_first else video + audio
    moov = box(b"moov", mvhd(duration_seconds, timescale, mvhd_version) + tracks)
    ftyp = box(b"ftyp", brand + bytes(4) + brand)
    body = b"\x00" * padding
    if largesize_mdat:
        mdat = struct.pack(">I4sQ", 1, b"mdat", 16 + len(body)) + body
    else:
        mdat = box(b"mdat", body)
    return ftyp + (moov + mdat if moov_first else mdat + moov)


def ftyp_only_audio() -> bytes:
    """A valid container whose only track is audio."""
    moov = box(b"moov", mvhd(5.0) + trak(b"soun"))
    return box(b"ftyp", b"isom" + bytes(8)) + moov
