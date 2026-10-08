"""Tests for the pixel-level brightness check on uploaded video thumbnails."""

import pytest
from app.services.thumbnail_brightness import (
    NEAR_BLACK_MEAN_LUMINANCE,
    is_nearly_black,
    mean_luminance,
)

from tests.thumbnail_fixtures import (
    BLACK_JPEG,
    DARK_JPEG,
    GRAD_JPEG,
    WHITE_JPEG,
    make_png,
)


def test_a_black_jpeg_has_no_brightness() -> None:
    assert mean_luminance(BLACK_JPEG, "image/jpeg") == pytest.approx(0, abs=1)


def test_a_white_jpeg_is_fully_bright() -> None:
    assert mean_luminance(WHITE_JPEG, "image/jpeg") == pytest.approx(255, abs=2)


def test_a_dark_but_real_jpeg_reads_its_actual_level() -> None:
    assert mean_luminance(DARK_JPEG, "image/jpeg") == pytest.approx(20, abs=3)


def test_a_gradient_jpeg_reads_its_average() -> None:
    assert mean_luminance(GRAD_JPEG, "image/jpeg") == pytest.approx(126, abs=8)


def test_only_a_solid_black_frame_counts_as_nearly_black() -> None:
    assert is_nearly_black(BLACK_JPEG, "image/jpeg") is True
    assert is_nearly_black(DARK_JPEG, "image/jpeg") is False  # a dark night scene
    assert is_nearly_black(WHITE_JPEG, "image/jpeg") is False
    assert 0 < NEAR_BLACK_MEAN_LUMINANCE < 20


@pytest.mark.parametrize("filter_type", [0, 1, 2, 3, 4])
def test_a_black_png_is_black_under_every_png_filter(filter_type: int) -> None:
    png = make_png(32, 24, lambda x, y: (0, 0, 0), filter_type=filter_type)

    assert mean_luminance(png, "image/png") == pytest.approx(0, abs=0.5)


@pytest.mark.parametrize("filter_type", [0, 1, 2, 3, 4])
def test_png_filters_are_undone_correctly(filter_type: int) -> None:
    png = make_png(32, 24, lambda x, y: (x * 8, x * 8, x * 8), filter_type=filter_type)

    assert mean_luminance(png, "image/png") == pytest.approx(124, abs=1)


def test_png_color_types_are_all_supported() -> None:
    gray = make_png(8, 8, lambda x, y: (100,), color_type=0)
    gray_alpha = make_png(8, 8, lambda x, y: (100, 255), color_type=4)
    rgba = make_png(8, 8, lambda x, y: (100, 100, 100, 255), color_type=6)

    for png in (gray, gray_alpha, rgba):
        assert mean_luminance(png, "image/png") == pytest.approx(100, abs=1)


def test_png_luminance_weights_green_most() -> None:
    green = make_png(8, 8, lambda x, y: (0, 255, 0))
    blue = make_png(8, 8, lambda x, y: (0, 0, 255))

    green_level = mean_luminance(green, "image/png")
    blue_level = mean_luminance(blue, "image/png")
    assert green_level is not None and blue_level is not None
    assert green_level > blue_level


@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        (b"", "image/jpeg"),
        (b"junk", "image/png"),
        (BLACK_JPEG[:60], "image/jpeg"),  # truncated before the scan
        (BLACK_JPEG[:-40], "image/jpeg"),  # truncated scan data
        (make_png(8, 8, lambda x, y: (0, 0, 0), interlace=1), "image/png"),
        (
            b"\xff\xd8\xff\xc2\x00\x0b\x08\x00\x10\x00\x10\x01\x01\x11\x00\xff\xd9",
            "image/jpeg",
        ),
        (b"RIFFxxxxWEBP", "image/webp"),
    ],
)
def test_an_image_it_cannot_decode_is_unknown_not_black(
    data: bytes, content_type: str
) -> None:
    """When in doubt the check stays silent — it must never reject a good thumbnail."""
    assert mean_luminance(data, content_type) is None
    assert is_nearly_black(data, content_type) is False


def test_a_header_only_fake_jpeg_is_unknown() -> None:
    from tests.test_product_image import _valid_jpeg

    assert mean_luminance(_valid_jpeg(360, 640), "image/jpeg") is None


def test_an_oversized_png_is_left_unchecked() -> None:
    png = make_png(1400, 1200, lambda x, y: (0, 0, 0))

    assert mean_luminance(png, "image/png") is None
