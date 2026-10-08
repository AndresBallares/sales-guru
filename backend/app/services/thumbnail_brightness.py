"""Pixel-level brightness check for a video's uploaded thumbnail.

A browser can hand back a solid black frame for a video it can't actually render
(iPhone HDR/HEVC in Safari is the known case). The server has no image library,
so this decodes just enough to average the brightness (confirmed 2026-10-07):
for a JPEG it Huffman-decodes the scan and reads only each luma block's DC
coefficient (the block's mean); for a PNG it undoes the row filters. Anything it
can't decode (progressive or arithmetic JPEG, interlaced or palette PNG, a
truncated file, a very large PNG) comes back as unknown — the check stays silent
rather than ever rejecting a thumbnail it can't read.
"""

import struct
import zlib

# Mean luma (0-255) below this is "solid black". A real dark scene sits well
# above it; a failed HDR/HEVC capture is exactly 0.
NEAR_BLACK_MEAN_LUMINANCE = 5.0

# PNG unfiltering is pure Python, so very large PNGs (only ever a manual
# upload; the browser's own capture is a JPEG capped at 1280px) are skipped.
_MAX_PNG_PIXELS = 1_500_000
_MAX_JPEG_PIXELS = 4_000_000

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}


class _UndecodableError(Exception):
    """The image is something this module doesn't decode."""


def mean_luminance(data: bytes, content_type: str) -> float | None:
    """Average brightness (0 black - 255 white) of a JPEG or PNG.

    Args:
        data: The image bytes.
        content_type: image/jpeg or image/png.

    Returns:
        The mean luma, or None when the image can't be decoded here.
    """
    try:
        if content_type == "image/jpeg":
            return _jpeg_mean(data)
        if content_type == "image/png":
            return _png_mean(data)
    except (
        _UndecodableError,
        IndexError,
        KeyError,
        ValueError,
        struct.error,
        zlib.error,
    ):
        return None
    return None


def is_nearly_black(data: bytes, content_type: str) -> bool:
    """Whether the image is decodable and a solid (near-)black frame."""
    brightness = mean_luminance(data, content_type)
    return brightness is not None and brightness < NEAR_BLACK_MEAN_LUMINANCE


# ── PNG ───────────────────────────────────────────────────────────────────


def _png_mean(data: bytes) -> float:
    if data[:8] != _PNG_SIGNATURE:
        raise _UndecodableError
    offset = 8
    header: tuple[int, int, int, int] | None = None
    idat = bytearray()
    while offset + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[offset : offset + 8])
        body = data[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(
                ">IIBBBBB", body
            )
            if depth != 8 or color not in _PNG_CHANNELS or interlace != 0:
                raise _UndecodableError
            if width * height > _MAX_PNG_PIXELS:
                raise _UndecodableError
            header = (width, height, color, _PNG_CHANNELS[color])
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        offset += 12 + length
    if header is None:
        raise _UndecodableError
    width, height, color, channels = header
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    if len(raw) != height * (stride + 1):
        raise _UndecodableError
    pixels = _unfilter(raw, width, height, channels)
    return _png_luma(pixels, color, channels)


def _unfilter(raw: bytes, width: int, height: int, channels: int) -> bytes:
    stride = width * channels
    out = bytearray(height * stride)
    for y in range(height):
        filter_type = raw[y * (stride + 1)]
        line = raw[y * (stride + 1) + 1 : (y + 1) * (stride + 1)]
        start = y * stride
        if filter_type == 0:
            out[start : start + stride] = line
            continue
        for i in range(stride):
            left = out[start + i - channels] if i >= channels else 0
            up = out[start - stride + i] if y else 0
            up_left = out[start - stride + i - channels] if y and i >= channels else 0
            if filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = up
            elif filter_type == 3:
                predictor = (left + up) // 2
            elif filter_type == 4:
                p = left + up - up_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - up_left)
                predictor = (
                    left if pa <= pb and pa <= pc else up if pb <= pc else up_left
                )
            else:
                raise _UndecodableError
            out[start + i] = (line[i] + predictor) & 0xFF
    return bytes(out)


def _png_luma(pixels: bytes, color: int, channels: int) -> float:
    count = len(pixels) // channels
    if color in (0, 4):  # gray (+ alpha)
        return sum(pixels[0::channels]) / count
    red = sum(pixels[0::channels])
    green = sum(pixels[1::channels])
    blue = sum(pixels[2::channels])
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / count


# ── JPEG (baseline, sequential Huffman) ──────────────────────────────────


class _Component:
    def __init__(self, ident: int, h: int, v: int, quant: int) -> None:
        self.ident, self.h, self.v, self.quant = ident, h, v, quant
        self.dc_table = 0
        self.ac_table = 0


class _Bits:
    """Entropy-coded segment reader: undoes 0xFF00 stuffing, handles RSTn."""

    def __init__(self, data: bytes, pos: int) -> None:
        self.data, self.pos = data, pos
        self.buffer = 0
        self.count = 0

    def bit(self) -> int:
        if self.count == 0:
            byte = self.data[self.pos]
            self.pos += 1
            if byte == 0xFF:
                nxt = self.data[self.pos]
                if nxt != 0:
                    raise _UndecodableError  # a marker mid-scan we didn't expect
                self.pos += 1
            self.buffer, self.count = byte, 8
        self.count -= 1
        return (self.buffer >> self.count) & 1

    def bits(self, n: int) -> int:
        value = 0
        for _ in range(n):
            value = (value << 1) | self.bit()
        return value

    def restart(self) -> None:
        self.count = 0
        if self.data[self.pos] != 0xFF or not 0xD0 <= self.data[self.pos + 1] <= 0xD7:
            raise _UndecodableError
        self.pos += 2


def _build_huffman(counts: bytes, symbols: bytes) -> dict[tuple[int, int], int]:
    table: dict[tuple[int, int], int] = {}
    code = index = 0
    for length in range(1, 17):
        for _ in range(counts[length - 1]):
            table[(length, code)] = symbols[index]
            code += 1
            index += 1
        code <<= 1
    return table


def _decode_symbol(bits: _Bits, table: dict[tuple[int, int], int]) -> int:
    code = 0
    for length in range(1, 17):
        code = (code << 1) | bits.bit()
        if (length, code) in table:
            return table[(length, code)]
    raise _UndecodableError


def _extend(value: int, size: int) -> int:
    return value if value >= (1 << (size - 1)) else value - (1 << size) + 1


def _jpeg_mean(data: bytes) -> float:
    if data[:2] != b"\xff\xd8":
        raise _UndecodableError
    quant: dict[int, int] = {}  # table id -> DC quantizer
    huffman: dict[tuple[int, int], dict[tuple[int, int], int]] = {}
    restart_interval = 0
    frame: tuple[int, int, list[_Component]] | None = None
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            raise _UndecodableError
        marker = data[pos + 1]
        length = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
        body = data[pos + 4 : pos + 2 + length]
        if marker == 0xDB:  # quantization tables
            at = 0
            while at < len(body):
                precision, ident = body[at] >> 4, body[at] & 15
                size = 128 if precision else 64
                quant[ident] = (
                    struct.unpack(">H", body[at + 1 : at + 3])[0]
                    if precision
                    else body[at + 1]
                )
                at += 1 + size
        elif marker in (0xC0, 0xC1):  # baseline / extended sequential, Huffman
            if body[0] != 8:
                raise _UndecodableError
            height, width, count = struct.unpack(">HHB", body[1:6])
            if width * height > _MAX_JPEG_PIXELS or count not in (1, 3):
                raise _UndecodableError
            components = [
                _Component(
                    body[6 + 3 * i],
                    body[7 + 3 * i] >> 4,
                    body[7 + 3 * i] & 15,
                    body[8 + 3 * i],
                )
                for i in range(count)
            ]
            frame = (width, height, components)
        elif marker in (
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        ):
            raise _UndecodableError  # progressive, lossless, arithmetic
        elif marker == 0xC4:  # Huffman tables
            at = 0
            while at < len(body):
                kind, ident = body[at] >> 4, body[at] & 15
                counts = body[at + 1 : at + 17]
                total = sum(counts)
                huffman[(kind, ident)] = _build_huffman(
                    counts, body[at + 17 : at + 17 + total]
                )
                at += 17 + total
        elif marker == 0xDD:
            restart_interval = struct.unpack(">H", body[:2])[0]
        elif marker == 0xDA:  # start of scan
            if frame is None:
                raise _UndecodableError
            width, height, components = frame
            if body[0] != len(components):
                raise _UndecodableError  # a non-interleaved, multi-scan image
            for i, component in enumerate(components):
                tables = body[2 + 2 * i]
                component.dc_table, component.ac_table = tables >> 4, tables & 15
            return _decode_scan(
                _Bits(data, pos + 2 + length),
                width,
                height,
                components,
                quant,
                huffman,
                restart_interval,
            )
        pos += 2 + length
    raise _UndecodableError


def _decode_scan(
    bits: _Bits,
    width: int,
    height: int,
    components: list[_Component],
    quant: dict[int, int],
    huffman: dict[tuple[int, int], dict[tuple[int, int], int]],
    restart_interval: int,
) -> float:
    h_max = max(c.h for c in components)
    v_max = max(c.v for c in components)
    mcus = -(-width // (8 * h_max)) * -(-height // (8 * v_max))
    predictors = [0] * len(components)
    luma_total = 0.0
    luma_blocks = 0
    luma = components[0]
    for mcu in range(mcus):
        if restart_interval and mcu and mcu % restart_interval == 0:
            bits.restart()
            predictors = [0] * len(components)
        for index, component in enumerate(components):
            for _ in range(component.h * component.v):
                size = _decode_symbol(bits, huffman[(0, component.dc_table)])
                diff = _extend(bits.bits(size), size) if size else 0
                predictors[index] += diff
                _skip_ac(bits, huffman[(1, component.ac_table)])
                if component is luma:
                    level = predictors[index] * quant[luma.quant] / 8 + 128
                    luma_total += min(255.0, max(0.0, level))
                    luma_blocks += 1
    return luma_total / luma_blocks


def _skip_ac(bits: _Bits, table: dict[tuple[int, int], int]) -> None:
    k = 1
    while k < 64:
        symbol = _decode_symbol(bits, table)
        run, size = symbol >> 4, symbol & 15
        if size == 0:
            if run != 15:
                return  # end of block
            k += 16
            continue
        k += run
        bits.bits(size)
        k += 1
