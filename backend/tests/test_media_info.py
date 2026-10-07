"""Tests for MP4/MOV header parsing and aspect-ratio classification."""

import pytest
from app.services.media_info import (
    VideoParseError,
    classify_aspect,
    read_video_info,
)

from tests.media_fixtures import box, make_mp4, mvhd


def test_reads_dimensions_and_duration_from_the_video_track() -> None:
    info = read_video_info(make_mp4(1080, 1920, 10.5))

    assert (info.width, info.height) == (1080, 1920)
    assert info.duration_seconds == pytest.approx(10.5)


def test_reads_a_64_bit_movie_header() -> None:
    info = read_video_info(make_mp4(1080, 1350, 42.0, mvhd_version=1))

    assert info.duration_seconds == pytest.approx(42.0)


def test_uses_the_movie_timescale() -> None:
    info = read_video_info(make_mp4(1080, 1080, 30.0, timescale=90000))

    assert info.duration_seconds == pytest.approx(30.0)


def test_a_rotated_video_reports_its_displayed_size() -> None:
    """Phones record landscape pixels with a 90-degree rotation matrix."""
    info = read_video_info(make_mp4(1920, 1080, 5.0, rotation=90))

    assert (info.width, info.height) == (1080, 1920)


def test_skips_a_leading_audio_track() -> None:
    info = read_video_info(make_mp4(1080, 1920, 5.0, audio_first=True))

    assert (info.width, info.height) == (1080, 1920)


def test_finds_a_moov_box_after_the_media_data() -> None:
    info = read_video_info(make_mp4(1080, 1920, 5.0, moov_first=False, padding=64))

    assert info.duration_seconds == pytest.approx(5.0)


def test_walks_past_a_64_bit_sized_box() -> None:
    info = read_video_info(
        make_mp4(1080, 1920, 5.0, moov_first=False, largesize_mdat=True, padding=64)
    )

    assert (info.width, info.height) == (1080, 1920)


def test_accepts_a_quicktime_brand() -> None:
    info = read_video_info(make_mp4(1080, 1920, 5.0, brand=b"qt  "))

    assert info.width == 1080


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"not a video at all",
        b"\x00\x00\x00\x08ftyp",  # truncated ftyp, nothing else
        make_mp4()[:40],  # cut off inside moov
    ],
)
def test_rejects_bytes_that_are_not_a_readable_video(data: bytes) -> None:
    with pytest.raises(VideoParseError):
        read_video_info(data)


def test_rejects_a_file_without_a_video_track() -> None:
    from tests.media_fixtures import ftyp_only_audio

    with pytest.raises(VideoParseError, match="video track"):
        read_video_info(ftyp_only_audio())


def test_rejects_a_movie_without_a_header() -> None:
    data = box(b"ftyp", b"isom" + bytes(8)) + box(b"moov", b"")

    with pytest.raises(VideoParseError):
        read_video_info(data)


def test_a_zero_timescale_is_rejected() -> None:
    data = make_mp4(timescale=0)

    with pytest.raises(VideoParseError):
        read_video_info(data)


def test_mvhd_helper_is_exercised() -> None:
    assert mvhd(1.0).startswith(b"\x00\x00")


@pytest.mark.parametrize(
    ("width", "height", "expected"),
    [
        (1080, 1080, "FEED"),  # 1:1
        (1080, 1350, "FEED"),  # 4:5
        (1080, 1340, "FEED"),  # within tolerance of 4:5
        (1080, 1920, "STORY"),  # 9:16
        (720, 1280, "STORY"),
        (1200, 628, "LANDSCAPE"),  # 1.91:1
        (1920, 1005, "LANDSCAPE"),
        (1000, 1500, "UNCLASSIFIED"),  # 2:3
        (1920, 1080, "UNCLASSIFIED"),  # 16:9 is not 1.91:1
        (800, 2000, "UNCLASSIFIED"),
    ],
)
def test_classifies_aspect_ratios_with_a_tolerance(
    width: int, height: int, expected: str
) -> None:
    assert classify_aspect(width, height) == expected


@pytest.mark.parametrize(("width", "height"), [(0, 100), (100, 0), (-1, 5)])
def test_classifying_a_degenerate_size_is_unclassified(width: int, height: int) -> None:
    assert classify_aspect(width, height) == "UNCLASSIFIED"
